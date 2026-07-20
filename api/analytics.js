import { sendJson } from '../server/http.js';
import {
  getTrustedViewerContext,
  requireTrustedViewerContext,
  sendTrustedViewerContextError,
} from '../server/request-auth.js';
import { getVerifiedViewerCommunityGroupIds } from '../server/community-store.js';
import {
  addServerAnalyticsEvent,
  getServerAnalyticsEvents,
} from '../server/analytics-store.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function normalizeEventPayload(payload = {}, groupId = 0) {
  return {
    type: 'view',
    groupId,
    templateId: String(payload.templateId || '').trim(),
    templateTitle: String(payload.templateTitle || 'Калькулятор').trim() || 'Калькулятор',
    source: String(payload.source || 'Прямой').trim() || 'Прямой',
    device: String(payload.device || 'desktop').trim(),
    createdAt: new Date().toISOString(),
  };
}

async function resolveAvailableGroupIds(auth) {
  const availableGroupIds = new Set();

  if (auth?.groupId > 0) {
    availableGroupIds.add(auth.groupId);
  }

  if (auth?.viewerId > 0) {
    const connectedGroupIds = await getVerifiedViewerCommunityGroupIds(auth.viewerId);
    connectedGroupIds.forEach((communityGroupId) => {
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

      const events = await getServerAnalyticsEvents(groupId);
      return sendJson(response, 200, { ok: true, data: events });
    }

    if (request.method === 'POST') {
      const auth = requireTrustedViewerContext(request, response);
      if (!auth) {
        return undefined;
      }

      if (groupId <= 0 || auth.groupId <= 0 || auth.groupId !== groupId) {
        return sendJson(response, 403, {
          ok: false,
          error: 'Analytics can be tracked only from the current VK community context',
        });
      }

      const eventPayload = normalizeEventPayload(request.body, groupId);
      if (!eventPayload.templateId) {
        return sendJson(response, 400, {
          ok: false,
          error: 'templateId is required',
        });
      }

      const events = await addServerAnalyticsEvent(eventPayload, groupId);
      return sendJson(response, 200, { ok: true, data: events });
    }

    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('analytics api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to track analytics',
    });
  }
}
