import { sendJson } from '../server/http.js';
import {
  getTrustedViewerContext,
  requireTrustedViewerContext,
  sendTrustedViewerContextError,
} from '../server/request-auth.js';
import {
  getServerAdminSettings,
  listServerAdminSettings,
  saveServerAdminSettings,
  updateServerBroadcastSubscription,
} from '../server/settings-store.js';
import {
  buildNextPaidUntil,
  createDefaultSubscriptionSettings,
  getSubscriptionPlanConfig,
} from '../server/subscription-config.js';
import {
  getViewerCommunities,
  listAllConnectedCommunities,
} from '../server/community-store.js';
import { resetAllGroupsData, resetSingleGroupData } from '../server/group-reset.js';
import { getVkUserInfo, hasVkGroupToken, sendVkMessage, sendVkMessageWithOptions } from '../server/vk.js';

const DEFAULT_SUPER_ADMIN_IDS = ['139346496'];
const MOSCOW_UTC_OFFSET = '+03:00';
const MOSCOW_YMD_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function buildIssuedPaidUntil(days) {
  const issuedAt = new Date();
  issuedAt.setDate(issuedAt.getDate() + Math.max(1, Number(days) || 30));
  return issuedAt.toISOString();
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
    if (auth.groupId <= 0 || auth.groupId !== groupId) {
      sendJson(response, 403, {
        ok: false,
        error: 'The requested group does not match the current VK context',
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

async function resolveApplicationName(viewerId, groupId) {
  if (!viewerId || !groupId) {
    return 'CalcPro';
  }

  try {
    const communities = await getViewerCommunities(viewerId);
    const matchedCommunity = communities.find((community) => community.groupId === groupId);
    return matchedCommunity?.name || 'CalcPro';
  } catch {
    return 'CalcPro';
  }
}

function isPaidSubscription(settings) {
  return settings?.subscription?.status === 'active' && settings?.subscription?.plan !== 'free';
}

function buildBroadcastUnsubscribeKeyboard(groupId) {
  return {
    one_time: true,
    buttons: [
      [
        {
          action: {
            type: 'text',
            label: `Стоп обновления ${groupId}`,
          },
          color: 'secondary',
        },
      ],
    ],
  };
}

function buildBroadcastUnsubscribeKeyboardWithPayload(groupId) {
  return {
    one_time: true,
    buttons: [
      [
        {
          action: {
            type: 'text',
            label: `Стоп обновления ${groupId}`,
            payload: {
              command: 'unsubscribe_updates',
              groupId,
            },
          },
          color: 'secondary',
        },
      ],
    ],
  };
}

function buildBroadcastActionKeyboard(groupId) {
  return {
    one_time: true,
    buttons: [
      [
        {
          action: {
            type: 'text',
            label: 'Отписаться от рассылки',
            payload: {
              command: 'unsubscribe_updates',
              groupId,
            },
          },
          color: 'negative',
        },
      ],
    ],
  };
}

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);

    if (request.method === 'GET') {
      const action = String(request.query?.action || request.body?.action || '').toLowerCase();

      if (action === 'superadmin-communities') {
        const auth = requireTrustedViewerContext(request, response);
        if (!auth) {
          return undefined;
        }

        const viewerId = String(auth.viewerId || '').trim();
        if (!isSuperAdmin(viewerId)) {
          return sendJson(response, 403, { ok: false, error: 'Super admin access required' });
        }

        const [communities, settingsList] = await Promise.all([
          listAllConnectedCommunities(),
          listServerAdminSettings(),
        ]);
        const settingsByGroupId = new Map(
          settingsList.map((item) => [item.groupId, item.settings]),
        );
        const data = communities.map((community) => {
          const settings = settingsByGroupId.get(community.groupId);
          return {
            ...community,
            subscriptionPlan: settings?.subscription?.plan || 'free',
            subscriptionStatus: settings?.subscription?.status || 'inactive',
            paidUntil: settings?.subscription?.paidUntil || '',
          };
        });

        return sendJson(response, 200, { ok: true, data });
      }

      if (action === 'superadmin-broadcast-recipients') {
        const auth = requireTrustedViewerContext(request, response);
        if (!auth) {
          return undefined;
        }

        const viewerId = String(auth.viewerId || '').trim();
        if (!isSuperAdmin(viewerId)) {
          return sendJson(response, 403, { ok: false, error: 'Super admin access required' });
        }

        const [communities, settingsList] = await Promise.all([
          listAllConnectedCommunities(),
          listServerAdminSettings(),
        ]);
        const communityMap = new Map(communities.map((community) => [community.groupId, community]));
        const recipientsMap = new Map();

        settingsList.forEach(({ groupId: currentGroupId, settings }) => {
          if (!isPaidSubscription(settings)) {
            return;
          }

          const userId = Number(settings.billingReminderVkId || 0);
          if (!userId || !settings.billingReminderConfirmedAt) {
            return;
          }

          const existingRecipient = recipientsMap.get(userId);
          const community = communityMap.get(currentGroupId);
          const communityEntry = {
            groupId: currentGroupId,
            name: community?.name || `РЎРѕРѕР±С‰РµСЃС‚РІРѕ ${currentGroupId}`,
            subscriptionPlan: settings.subscription.plan,
            paidUntil: settings.subscription.paidUntil || '',
          };

          if (!existingRecipient) {
            recipientsMap.set(userId, {
              userId,
              confirmedAt: settings.billingReminderConfirmedAt,
              unsubscribedAt: settings.updatesBroadcastUnsubscribedAt || '',
              isSubscribed: !settings.updatesBroadcastUnsubscribedAt,
              communities: [communityEntry],
            });
            return;
          }

          recipientsMap.set(userId, {
            ...existingRecipient,
            confirmedAt:
              Date.parse(existingRecipient.confirmedAt || '') <=
              Date.parse(settings.billingReminderConfirmedAt || '')
                ? existingRecipient.confirmedAt
                : settings.billingReminderConfirmedAt,
            unsubscribedAt:
              existingRecipient.unsubscribedAt || settings.updatesBroadcastUnsubscribedAt || '',
            isSubscribed:
              existingRecipient.isSubscribed && !settings.updatesBroadcastUnsubscribedAt,
            communities: [...existingRecipient.communities, communityEntry],
          });
        });

        const data = [...recipientsMap.values()].sort(
          (left, right) => right.communities.length - left.communities.length || left.userId - right.userId,
        );

        return sendJson(response, 200, { ok: true, data });
      }

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

      if (action === 'send-updates-broadcast') {
        const auth = requireTrustedViewerContext(request, response);
        if (!auth) {
          return undefined;
        }

        const viewerId = String(auth.viewerId || '').trim();
        if (!isSuperAdmin(viewerId)) {
          return sendJson(response, 403, { ok: false, error: 'Super admin access required' });
        }

        const messageText = String(incomingSettings.message || '').trim();
        const isTestOnly = incomingSettings.testOnly === true;
        const requestedRecipientIds = Array.isArray(incomingSettings.recipientIds)
          ? [...new Set(
              incomingSettings.recipientIds
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value > 0),
            )]
          : [];
        if (!messageText) {
          return sendJson(response, 400, { ok: false, error: 'message is required' });
        }

        if (isTestOnly) {
          try {
            await sendVkMessage(Number(auth.viewerId), `Тест обновления CalcPro\n\n${messageText}`);
            return sendJson(response, 200, {
              ok: true,
              message: `Тестовое сообщение отправлено на VK ID ${auth.viewerId}.`,
            });
          } catch (error) {
            return sendJson(response, 502, {
              ok: false,
              error: error?.message || 'Не удалось отправить тестовое сообщение в VK.',
            });
          }
        }

        const settingsList = await listServerAdminSettings();
        const recipientsMap = new Map();
        let sentCount = 0;
        const failedRecipients = [];
        for (const { groupId: currentGroupId, settings } of settingsList) {
          if (!isPaidSubscription(settings)) {
            continue;
          }

          const recipientId = Number(settings.billingReminderVkId || 0);
          if (!recipientId || !settings.billingReminderConfirmedAt) {
            continue;
          }

          const existing = recipientsMap.get(recipientId);
          if (!existing) {
            recipientsMap.set(recipientId, {
              groupId: currentGroupId,
              isSubscribed: !settings.updatesBroadcastUnsubscribedAt,
            });
            continue;
          }

          recipientsMap.set(recipientId, {
            groupId: existing.groupId,
            isSubscribed: existing.isSubscribed && !settings.updatesBroadcastUnsubscribedAt,
          });
        }

        for (const [recipientId, recipient] of recipientsMap.entries()) {
          if (requestedRecipientIds.length > 0 && !requestedRecipientIds.includes(recipientId)) {
            continue;
          }

          if (!recipient.isSubscribed) {
            continue;
          }

          try {
            await sendVkMessageWithOptions(recipientId, `Обновление CalcPro\n\n${messageText}`, {
              keyboard: buildBroadcastActionKeyboard(recipient.groupId),
            });
            sentCount += 1;
          } catch (error) {
            failedRecipients.push(`VK ID ${recipientId}: ${error?.message || 'ошибка доставки'}`);
          }
        }

        if (!sentCount && failedRecipients.length > 0) {
          return sendJson(response, 502, {
            ok: false,
            error: `VK не доставил рассылку. ${failedRecipients.join('; ')}`,
          });
        }

        return sendJson(response, 200, {
          ok: true,
          message: sentCount
            ? failedRecipients.length
              ? `Рассылка отправлена ${sentCount} подписчикам. Не доставлено: ${failedRecipients.join('; ')}`
              : `Рассылка отправлена ${sentCount} подписчикам.`
            : 'Нет активных подписчиков для рассылки.',
        });
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
          integrations: incomingSettings.integrations ?? currentSettings.integrations,
          googleSheetsWebhookUrl:
            incomingSettings.googleSheetsWebhookUrl ?? currentSettings.googleSheetsWebhookUrl,
          googleSheetsLastExportAt:
            incomingSettings.googleSheetsLastExportAt ?? currentSettings.googleSheetsLastExportAt,
          subscription: currentSettings.subscription,
        },
        groupId,
      );

      if (
        incomingManagerVkId !== undefined &&
        !incomingManagerVkId &&
        currentSettings.managerVkId
      ) {
        const applicationName = await resolveApplicationName(auth.viewerId, groupId);
        const removedManagerId = Number(currentSettings.managerVkId);
        const adminId = Number(auth.viewerId);

        await Promise.all([
          Number.isInteger(removedManagerId) && removedManagerId > 0
            ? sendVkMessage(
                removedManagerId,
                `Р’С‹ Р±РѕР»СЊС€Рµ РЅРµ СЏРІР»СЏРµС‚РµСЃСЊ РјРµРЅРµРґР¶РµСЂРѕРј РїСЂРёР»РѕР¶РµРЅРёСЏ В«${applicationName}В».`,
              ).catch(() => undefined)
            : Promise.resolve(),
          Number.isInteger(adminId) && adminId > 0
            ? sendVkMessage(
                adminId,
                `РњРµРЅРµРґР¶РµСЂ РІР°С€РµРіРѕ РїСЂРёР»РѕР¶РµРЅРёСЏ В«${applicationName}В» РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚. Р”РѕР±Р°РІСЊС‚Рµ РµРіРѕ, С‡С‚РѕР±С‹ РѕР±СЂР°Р±Р°С‚С‹РІР°С‚СЊ Р·Р°СЏРІРєРё.`,
              ).catch(() => undefined)
            : Promise.resolve(),
        ]);
      }

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
