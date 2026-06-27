import { sendJson } from '../server/http.js';
import { getTrustedViewerContext } from '../server/request-auth.js';
import { getViewerCommunities } from '../server/community-store.js';
import {
  addServerRequest,
  deleteServerRequest,
  getServerRequests,
  mergeServerRequests,
  updateServerRequest,
} from '../server/request-store.js';
import { getServerAdminSettings } from '../server/settings-store.js';
import { hasVkGroupToken, sendVkMessage } from '../server/vk.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function parseManagerIds(rawValue) {
  return [...new Set(String(rawValue || '').split(/[,\s;]+/).map((item) => item.trim()).filter(Boolean))];
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
    return value
      .map((item) =>
        typeof item === 'object' && item !== null && 'name' in item ? String(item.name) : String(item),
      )
      .join(', ') || '-';
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
  const details = (Array.isArray(request?.details) && request.details.length > 0
    ? request.details.map((item) => `${item.label}: ${item.value}`)
    : Object.entries(request?.values || {}).map(([key, value]) => `${key}: ${formatRequestValue(value)}`))
    .map((item) => `• ${item}`)
    .join('\n');

  return [
    '🆕 Новая заявка',
    `🧮 Калькулятор: ${request?.templateTitle || 'Калькулятор'}`,
    `👤 Имя: ${request?.name || '-'}`,
    `📞 Телефон: ${request?.phone || '-'}`,
    `💬 Комментарий: ${request?.comment || 'Без комментария'}`,
    `💰 Сумма: ${Number(request?.amount) || 0} ₽`,
    details ? `\n📋 Детали:\n${details}` : '',
  ].join('\n');
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
    sendJson(response, 401, {
      ok: false,
      error: 'VK launch params verification failed',
    });
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

      const requestPayload = request.body || {};
      let savedRequests = [];

      if (groupId > 0) {
        try {
          savedRequests = await addServerRequest(requestPayload, groupId);
        } catch {
          savedRequests = [];
        }
      }
      const settings = await getServerAdminSettings(groupId);
      const managerIds = parseManagerIds(settings.managerVkId);

      if (managerIds.length === 0) {
        return sendJson(response, 200, {
          ok: true,
          message: 'Заявка сохранена. Менеджер VK ID пока не настроен.',
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
        const vkResponse = await sendVkMessage(managerId, message);
        results.push({ managerId, vkResponse });
      }

      return sendJson(response, 200, {
        ok: true,
        message: `Заявка отправлена ${managerIds.length} менеджер(ам).`,
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
