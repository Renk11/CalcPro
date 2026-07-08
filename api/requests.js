import { sendJson } from '../server/http.js';
import {
  getTrustedViewerContext,
  requireTrustedViewerContext,
  sendTrustedViewerContextError,
} from '../server/request-auth.js';
import { getViewerCommunities } from '../server/community-store.js';
import {
  addServerRequest,
  deleteServerRequest,
  getServerRequests,
  mergeServerRequests,
  updateServerRequest,
} from '../server/request-store.js';
import { getServerAdminSettings, saveServerAdminSettings } from '../server/settings-store.js';
import {
  getEffectiveSubscriptionPlan,
  getSubscriptionQuotaCycleId,
} from '../server/subscription-config.js';
import { sendRequestsToGoogleSheets } from '../server/google-sheets.js';
import { hasVkGroupToken, sendVkMessage } from '../server/vk.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function parseManagerIds(rawValue) {
  return [
    ...new Set(
      String(rawValue || '')
        .split(/[,\s;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parseRequestPatch(rawValue) {
  const patch = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const nextPatch = {};

  if ('name' in patch) {
    nextPatch.name = String(patch.name || '');
  }

  if ('phone' in patch) {
    nextPatch.phone = String(patch.phone || '');
  }

  if ('comment' in patch) {
    nextPatch.comment = String(patch.comment || '');
  }

  if ('amount' in patch) {
    nextPatch.amount = Number(patch.amount) || 0;
  }

  if ('status' in patch) {
    nextPatch.status =
      patch.status === 'in_progress' ||
      patch.status === 'done' ||
      patch.status === 'rejected' ||
      patch.status === 'new'
        ? patch.status
        : 'new';
  }

  if ('assignedTo' in patch) {
    nextPatch.assignedTo = String(patch.assignedTo || '');
  }

  if ('updatedAt' in patch) {
    nextPatch.updatedAt = String(patch.updatedAt || new Date().toISOString());
  }

  if ('internalComments' in patch && Array.isArray(patch.internalComments)) {
    nextPatch.internalComments = patch.internalComments;
  }

  if ('history' in patch && Array.isArray(patch.history)) {
    nextPatch.history = patch.history;
  }

  return nextPatch;
}

function formatRequestValue(value) {
  if (Array.isArray(value)) {
    return (
      value
        .map((item) =>
          typeof item === 'object' && item !== null && 'name' in item ? String(item.name) : String(item),
        )
        .join(', ') || '-'
    );
  }

  if (typeof value === 'boolean') {
    return value ? 'Да' : 'Нет';
  }

  if (value && typeof value === 'object') {
    if ('label' in value) {
      const label = String(value.label || '');
      const surcharge = Number('surcharge' in value ? value.surcharge : 0);
      return surcharge > 0 ? `${label} (+${surcharge} ₽)` : label || '-';
    }

    return JSON.stringify(value);
  }

  return String(value || '-');
}

function buildMessage(request) {
  const details = (
    Array.isArray(request?.details) && request.details.length > 0
      ? request.details.map((item) => `${item.label}: ${item.value}`)
      : Object.entries(request?.values || {}).map(([key, value]) => `${key}: ${formatRequestValue(value)}`)
  )
    .map((item) => `• ${item}`)
    .join('\n');

  return [
    'Новая заявка',
    `Калькулятор: ${request?.templateTitle || 'Калькулятор'}`,
    `Имя: ${request?.name || '-'}`,
    `Телефон: ${request?.phone || '-'}`,
    `Комментарий: ${request?.comment || 'Без комментария'}`,
    `Сумма: ${Number(request?.amount) || 0} ₽`,
    details ? `\nДетали:\n${details}` : '',
  ].join('\n');
}

function getMonthlyUsageFromSubscription(subscription, date = new Date()) {
  const usage = subscription?.quotaMonthlyUsage;
  if (!usage || typeof usage !== 'object') {
    return 0;
  }

  const cycleId = getSubscriptionQuotaCycleId(date);
  const rawValue = usage[cycleId];
  return Number.isFinite(rawValue) ? Math.max(0, Math.trunc(rawValue)) : 0;
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

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);

    if (request.method === 'GET') {
      const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
      if (!auth) {
        return undefined;
      }

      const requests = await getServerRequests(groupId);
      return sendJson(response, 200, { ok: true, data: requests });
    }

    if (request.method === 'POST') {
      const action = String(request.query?.action || request.body?.action || '').toLowerCase();

      if (action === 'sync') {
        const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
        if (!auth) {
          return undefined;
        }

        const incomingRequests = Array.isArray(request.body?.requests) ? request.body.requests : [];
        const requests = await mergeServerRequests(incomingRequests, groupId);
        return sendJson(response, 200, { ok: true, data: requests });
      }

      if (action === 'update') {
        const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
        if (!auth) {
          return undefined;
        }

        const requestId = String(request.body?.requestId || '').trim();
        if (!requestId) {
          return sendJson(response, 400, { ok: false, error: 'requestId is required' });
        }

        const requests = await updateServerRequest(requestId, parseRequestPatch(request.body?.patch), groupId);
        return sendJson(response, 200, { ok: true, data: requests });
      }

      if (action === 'delete') {
        const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
        if (!auth) {
          return undefined;
        }

        const requestId = String(request.body?.requestId || '').trim();
        if (!requestId) {
          return sendJson(response, 400, { ok: false, error: 'requestId is required' });
        }

        const requests = await deleteServerRequest(requestId, groupId);
        return sendJson(response, 200, { ok: true, data: requests });
      }

      if (action === 'export-google-sheets') {
        const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
        if (!auth) {
          return undefined;
        }

        const settings = await getServerAdminSettings(groupId);
        if (!settings.googleSheetsWebhookUrl) {
          return sendJson(response, 400, {
            ok: false,
            error: 'Google Sheets webhook URL is not configured',
          });
        }

        const requests = await getServerRequests(groupId);
        const exportResult = await sendRequestsToGoogleSheets({
          webhookUrl: settings.googleSheetsWebhookUrl,
          groupId,
          mode: 'replace',
          requests,
        });

        const nextSettings = await saveServerAdminSettings(
          {
            ...settings,
            googleSheetsLastExportAt: exportResult.exportedAt,
          },
          groupId,
        );

        return sendJson(response, 200, {
          ok: true,
          data: requests,
          settings: nextSettings,
          message: `В Google Sheets выгружено ${requests.length} заявок.`,
        });
      }

      const auth = requireTrustedViewerContext(request, response);
      if (!auth) {
        return undefined;
      }

      if (groupId <= 0 || auth.groupId <= 0 || auth.groupId !== groupId) {
        return sendJson(response, 403, {
          ok: false,
          error: 'Requests can be submitted only from the current VK community context',
        });
      }

      const requestPayload = request.body || {};
      const settings = await getServerAdminSettings(groupId);
      const currentPlan = getEffectiveSubscriptionPlan(settings.subscription);
      const requestLimit = currentPlan.monthlyRequestLimit;
      const usedRequests = getMonthlyUsageFromSubscription(settings.subscription);

      if (requestLimit != null && usedRequests >= requestLimit) {
        return sendJson(response, 200, {
          ok: false,
          error: 'MONTHLY_REQUEST_LIMIT_REACHED',
          message: `Лимит заявок на этот месяц исчерпан: ${usedRequests} из ${requestLimit}.`,
        });
      }

      let savedRequests = [];

      try {
        savedRequests = await addServerRequest(requestPayload, groupId);
      } catch {
        savedRequests = [];
      }

      if (settings.googleSheetsWebhookUrl) {
        sendRequestsToGoogleSheets({
          webhookUrl: settings.googleSheetsWebhookUrl,
          groupId,
          mode: 'append',
          requests: [requestPayload],
        })
          .then(async (exportResult) => {
            try {
              await saveServerAdminSettings(
                {
                  ...settings,
                  googleSheetsLastExportAt: exportResult.exportedAt,
                },
                groupId,
              );
            } catch {
              // Ignore export status persistence failures.
            }
          })
          .catch(() => {
            // Google Sheets export must not block request processing.
          });
      }

      if (requestLimit != null) {
        const cycleId = getSubscriptionQuotaCycleId();
        await saveServerAdminSettings(
          {
            ...settings,
            subscription: {
              ...settings.subscription,
              quotaMonthlyUsage: {
                ...(settings.subscription.quotaMonthlyUsage || {}),
                [cycleId]: usedRequests + 1,
              },
            },
          },
          groupId,
        );
      }

      const managerIds = parseManagerIds(settings.managerVkId);

      if (managerIds.length === 0) {
        return sendJson(response, 200, {
          ok: true,
          message: 'Заявка сохранена. Менеджер VK ID пока не настроен.',
          data: savedRequests,
        });
      }

      if (!settings.managerVkConfirmedAt) {
        return sendJson(response, 200, {
          ok: true,
          message:
            'Р—Р°СЏРІРєР° СЃРѕС…СЂР°РЅРµРЅР°. РњРµРЅРµРґР¶РµСЂ РµС‰С‘ РЅРµ РїРѕРґС‚РІРµСЂРґРёР» РґРёР°Р»РѕРі СЃ CalcPro.',
          data: savedRequests,
        });
      }

      if (!hasVkGroupToken()) {
        return sendJson(response, 200, {
          ok: true,
          message: 'Заявка сохранена. Токен группы для отправки сообщений не настроен.',
          data: savedRequests,
        });
      }

      const message = buildMessage(requestPayload);
      const results = [];

      for (const managerId of managerIds) {
        try {
          const vkResponse = await sendVkMessage(managerId, message);
          results.push({ managerId, vkResponse, ok: true });
        } catch (error) {
          results.push({
            managerId,
            ok: false,
            error: error instanceof Error ? error.message : 'VK send failed',
          });
        }
      }

      const deliveredCount = results.filter((item) => item.ok).length;
      const failedCount = results.length - deliveredCount;

      return sendJson(response, 200, {
        ok: true,
        message:
          failedCount === 0
            ? `Заявка отправлена ${deliveredCount} менеджер(ам).`
            : `Заявка сохранена. Успешно отправлено: ${deliveredCount}, ошибок: ${failedCount}.`,
        data: savedRequests,
        notifications: results,
      });
    }

    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('requests api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Failed to send request',
    });
  }
}
