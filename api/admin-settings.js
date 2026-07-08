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
import { resetAllGroupsData, resetSingleGroupData } from '../server/group-reset.js';
import { getVkUserInfo, hasVkGroupToken } from '../server/vk.js';

const DEFAULT_SUPER_ADMIN_IDS = ['139346496'];

function buildIssuedPaidUntil(days) {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + Math.max(1, Number(days) || 30));
  return nextDate.toISOString();
}

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

async function enrichAdminSettingsResponse(settings) {
  if (!settings?.managerVkId || !settings?.managerVkConfirmedAt) {
    return settings;
  }

  let managerProfile = {
    id: Number(settings.managerVkId),
    firstName: '',
    lastName: '',
    screenName: '',
    photoUrl: '',
  };

  if (hasVkGroupToken()) {
    try {
      const user = await getVkUserInfo(settings.managerVkId);
      managerProfile = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        screenName: user.screenName,
        photoUrl: user.photoUrl,
      };
    } catch {
      // Keep fallback profile shape when VK lookup is temporarily unavailable.
    }
  }

  return {
    ...settings,
    managerProfile,
  };
}

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);

    if (request.method === 'GET') {
      const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
      if (!auth) {
        return undefined;
      }

      const settings = await getServerAdminSettings(groupId);
      return sendJson(response, 200, { ok: true, data: await enrichAdminSettingsResponse(settings) });
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
        const targetPlan =
          requestedPlan === 'free' || requestedPlan === 'start' || requestedPlan === 'pro'
            ? requestedPlan
            : 'pro';
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
        const nextPaidUntil = days === 30 ? buildNextPaidUntil('') : buildIssuedPaidUntil(days);
        const quotaStartedAt = new Date().toISOString();
        const isFreePlan = nextPlan.id === 'free';

        const settings = await saveServerAdminSettings(
          {
            ...currentSettings,
            subscription: {
              ...baseSubscription,
              plan: nextPlan.id,
              priceRub: nextPlan.monthlyPriceRub,
              status: isFreePlan ? 'inactive' : 'active',
              provider: isFreePlan ? '' : 'super-admin',
              externalPaymentId: '',
              paidUntil: isFreePlan ? '' : nextPaidUntil,
              quotaStartedAt,
              quotaMonthlyUsage: {},
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

      if (action === 'reset-group') {
        const auth = requireTrustedViewerContext(request, response);
        if (!auth) {
          return undefined;
        }

        const viewerId = String(auth.viewerId || '').trim();
        if (!isSuperAdmin(viewerId)) {
          return sendJson(response, 403, { ok: false, error: 'Super admin access required' });
        }

        const targetGroupId = parseGroupId(incomingSettings.targetGroupId);
        const confirmation = String(incomingSettings.confirmation || '').trim().toLowerCase();
        const expectedConfirmation = `reset group ${targetGroupId}`;

        if (!targetGroupId) {
          return sendJson(response, 400, { ok: false, error: 'targetGroupId is required' });
        }

        if (confirmation !== expectedConfirmation) {
          return sendJson(response, 400, {
            ok: false,
            error: `Confirmation phrase must be "${expectedConfirmation}"`,
          });
        }

        const result = await resetSingleGroupData(targetGroupId);
        return sendJson(response, 200, { ok: true, data: result });
      }

      const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
      if (!auth) {
        return undefined;
      }

      const currentSettings = await getServerAdminSettings(groupId);
      const incomingManagerVkId =
        incomingSettings.managerVkId === undefined
          ? undefined
          : String(incomingSettings.managerVkId || '')
              .split(/[,\s;]+/)
              .map((value) => value.trim())
              .find(Boolean) || '';
      const shouldResetManagerConfirmation =
        incomingManagerVkId !== undefined && incomingManagerVkId !== currentSettings.managerVkId;
      const settings = await saveServerAdminSettings(
        {
          ...currentSettings,
          managerVkId: incomingManagerVkId ?? currentSettings.managerVkId,
          managerVkConfirmedAt: shouldResetManagerConfirmation
            ? ''
            : currentSettings.managerVkConfirmedAt,
          billingReminderVkId:
            incomingSettings.billingReminderVkId ?? currentSettings.billingReminderVkId,
          billingReminderConfirmedAt:
            incomingSettings.billingReminderConfirmedAt ?? currentSettings.billingReminderConfirmedAt,
          googleSheetsWebhookUrl:
            incomingSettings.googleSheetsWebhookUrl ?? currentSettings.googleSheetsWebhookUrl,
          googleSheetsLastExportAt:
            incomingSettings.googleSheetsLastExportAt ?? currentSettings.googleSheetsLastExportAt,
          subscription: currentSettings.subscription,
        },
        groupId,
      );
      return sendJson(response, 200, { ok: true, data: await enrichAdminSettingsResponse(settings) });
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
