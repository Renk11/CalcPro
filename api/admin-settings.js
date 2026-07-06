import { sendJson } from '../server/http.js';
import {
  getTrustedViewerContext,
  requireTrustedViewerContext,
  sendTrustedViewerContextError,
} from '../server/request-auth.js';
import { getServerAdminSettings, saveServerAdminSettings } from '../server/settings-store.js';
import {
  buildNextPaidUntil,
  createDefaultSubscriptionSettings,
  getSubscriptionPlanConfig,
} from '../server/subscription-config.js';
import { getViewerCommunities } from '../server/community-store.js';
import { resetAllGroupsData } from '../server/group-reset.js';

const DEFAULT_SUPER_ADMIN_IDS = ['139346496'];

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function isSuperAdmin(viewerId) {
  const configuredIds = String(process.env.SUPER_ADMIN_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set([...DEFAULT_SUPER_ADMIN_IDS, ...configuredIds]).has(
    String(viewerId || '').trim(),
  );
}

async function resolveAvailableGroupIds(auth) {
  const availableGroupIds = new Set();

  if (auth?.groupId > 0) {
    availableGroupIds.add(auth.groupId);
  }

  if (auth?.viewerId > 0) {
    const connectedCommunities = await getViewerCommunities(auth.viewerId);
    connectedCommunities.forEach((community) => {
      const communityGroupId = parseGroupId(community.groupId);
      if (communityGroupId > 0) {
        availableGroupIds.add(communityGroupId);
      }
    });
  }

  return availableGroupIds;
}

async function requireWorkspaceCommunityAdmin(request, response, groupId) {
  const auth = getTrustedViewerContext(request);
  if (!auth) {
    sendTrustedViewerContextError(request, response);
    return null;
  }

  if (!auth.isCommunityAdmin) {
    sendJson(response, 403, {
      ok: false,
      error: 'Community admin access required',
    });
    return null;
  }

  if (groupId > 0) {
    const availableGroupIds = await resolveAvailableGroupIds(auth);
    if (!availableGroupIds.has(groupId)) {
      sendJson(response, 403, {
        ok: false,
        error: 'The requested group is not connected to the current workspace',
      });
      return null;
    }
  }

  return auth;
}

async function requireCommunitySettingsReadAccess(request, response, groupId) {
  const auth = getTrustedViewerContext(request);
  if (!auth) {
    sendTrustedViewerContextError(request, response);
    return null;
  }

  if (auth.isCommunityAdmin) {
    if (groupId > 0) {
      const availableGroupIds = await resolveAvailableGroupIds(auth);
      if (!availableGroupIds.has(groupId)) {
        sendJson(response, 403, {
          ok: false,
          error: 'The requested group is not connected to the current workspace',
        });
        return null;
      }
    }

    return auth;
  }

  if (groupId > 0 && auth.groupId === groupId) {
    return auth;
  }

  sendJson(response, 403, {
    ok: false,
    error: 'Community access required',
  });
  return null;
}

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);

    if (request.method === 'GET') {
      const auth = await requireCommunitySettingsReadAccess(request, response, groupId);
      if (!auth) {
        return undefined;
      }

      const settings = await getServerAdminSettings(groupId);
      return sendJson(response, 200, { ok: true, data: settings });
    }

    if (request.method === 'POST') {
      const action = String(request.query?.action || request.body?.action || '').toLowerCase();
      const incomingSettings = request.body || {};

      if (action === 'grant-pro') {
        const auth = requireTrustedViewerContext(request, response);
        if (!auth) {
          return undefined;
        }

        const viewerId = String(auth.viewerId || '').trim();
        const targetGroupId = parseGroupId(incomingSettings.targetGroupId);
        const requestedPlan = String(incomingSettings.plan || 'pro').toLowerCase();
        const targetPlan = requestedPlan === 'start' ? 'start' : 'pro';
        const days = Math.max(1, Number(incomingSettings.days) || 30);

        if (!isSuperAdmin(viewerId)) {
          return sendJson(response, 403, { ok: false, error: 'Super admin access required' });
        }

        if (!targetGroupId) {
          return sendJson(response, 400, { ok: false, error: 'targetGroupId is required' });
        }

        const currentSettings = await getServerAdminSettings(targetGroupId);
        const nextPlan = getSubscriptionPlanConfig(targetPlan);
        const baseSubscription = {
          ...createDefaultSubscriptionSettings(),
          ...currentSettings.subscription,
          plan: nextPlan.id,
          priceRub: nextPlan.monthlyPriceRub,
        };
        const paidUntil = buildNextPaidUntil(
          baseSubscription.status === 'active' ? baseSubscription.paidUntil : '',
        );

        let nextPaidUntil = paidUntil;
        if (days !== 30) {
          const currentPaidUntil = Date.parse(
            baseSubscription.status === 'active' ? baseSubscription.paidUntil || '' : '',
          );
          const baseTime =
            Number.isFinite(currentPaidUntil) && currentPaidUntil > Date.now()
              ? currentPaidUntil
              : Date.now();
          const nextDate = new Date(baseTime);
          nextDate.setDate(nextDate.getDate() + days);
          nextPaidUntil = nextDate.toISOString();
        }

        const settings = await saveServerAdminSettings(
          {
            ...currentSettings,
            subscription: {
              ...baseSubscription,
              plan: nextPlan.id,
              priceRub: nextPlan.monthlyPriceRub,
              status: 'active',
              provider: 'super-admin',
              externalPaymentId: '',
              paidUntil: nextPaidUntil,
            },
          },
          targetGroupId,
        );

        return sendJson(response, 200, { ok: true, data: settings });
      }

      if (action === 'reset-all-groups') {
        const auth = requireTrustedViewerContext(request, response);
        if (!auth) {
          return undefined;
        }

        const viewerId = String(auth.viewerId || '').trim();
        if (!isSuperAdmin(viewerId)) {
          return sendJson(response, 403, { ok: false, error: 'Super admin access required' });
        }

        const confirmation = String(incomingSettings.confirmation || '').trim().toLowerCase();
        if (confirmation !== 'reset all groups') {
          return sendJson(response, 400, {
            ok: false,
            error: 'Confirmation phrase must be "reset all groups"',
          });
        }

        const result = await resetAllGroupsData();
        return sendJson(response, 200, { ok: true, data: result });
      }

      const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
      if (!auth) {
        return undefined;
      }

      const currentSettings = await getServerAdminSettings(groupId);
      const settings = await saveServerAdminSettings(
        {
          ...currentSettings,
          managerVkId: incomingSettings.managerVkId ?? currentSettings.managerVkId,
          billingReminderVkId:
            incomingSettings.billingReminderVkId ?? currentSettings.billingReminderVkId,
          billingReminderConfirmedAt:
            incomingSettings.billingReminderConfirmedAt ?? currentSettings.billingReminderConfirmedAt,
          subscription: currentSettings.subscription,
        },
        groupId,
      );
      return sendJson(response, 200, { ok: true, data: settings });
    }

    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('admin-settings api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Failed to process admin settings',
    });
  }
}
