import { sendJson } from '../server/http.js';
import { getServerAdminSettings, saveServerAdminSettings } from '../server/settings-store.js';
import {
  buildNextPaidUntil,
  createDefaultSubscriptionSettings,
  getSubscriptionPlanConfig,
} from '../server/subscription-config.js';

const DEFAULT_SUPER_ADMIN_IDS = ['139346496'];

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function resolveSuperAdminIds() {
  return new Set(
    String(process.env.SUPER_ADMIN_IDS || DEFAULT_SUPER_ADMIN_IDS.join(','))
      .split(/[,\s;]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function isSuperAdmin(viewerId) {
  return resolveSuperAdminIds().has(String(viewerId || '').trim());
}

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);

    if (request.method === 'GET') {
      const settings = await getServerAdminSettings(groupId);
      return sendJson(response, 200, { ok: true, data: settings });
    }

    if (request.method === 'POST') {
      const action = String(request.query?.action || request.body?.action || '').toLowerCase();
      const incomingSettings = request.body || {};

      if (action === 'grant-pro') {
        const viewerId = String(incomingSettings.viewerId || '').trim();
        const targetGroupId = parseGroupId(incomingSettings.targetGroupId);
        const days = Math.max(1, Number(incomingSettings.days) || 30);

        if (!isSuperAdmin(viewerId)) {
          return sendJson(response, 403, { ok: false, error: 'Super admin access required' });
        }

        if (!targetGroupId) {
          return sendJson(response, 400, { ok: false, error: 'targetGroupId is required' });
        }

        const currentSettings = await getServerAdminSettings(targetGroupId);
        const proPlan = getSubscriptionPlanConfig('pro');
        const baseSubscription = {
          ...createDefaultSubscriptionSettings(),
          ...currentSettings.subscription,
          plan: proPlan.id,
          priceRub: proPlan.monthlyPriceRub,
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
              plan: proPlan.id,
              priceRub: proPlan.monthlyPriceRub,
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

      const currentSettings = await getServerAdminSettings(groupId);
      const settings = await saveServerAdminSettings(
        {
          ...currentSettings,
          managerVkId: incomingSettings.managerVkId ?? currentSettings.managerVkId,
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
