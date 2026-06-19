import { sendJson } from '../server/http.js';
import {
  getTrustedViewerContext,
  requireCommunityAdmin,
} from '../server/request-auth.js';
import {
  getServerTemplates,
  saveServerTemplates,
  transferServerTemplate,
} from '../server/template-store.js';
import { getViewerCommunities } from '../server/community-store.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);

    if (request.method === 'GET') {
      const auth = getTrustedViewerContext(request);
      if (!auth) {
        return sendJson(response, 401, {
          ok: false,
          error: 'VK launch params verification failed',
        });
      }

      if (groupId > 0 && auth.groupId !== groupId) {
        return sendJson(response, 403, {
          ok: false,
          error: 'The requested group does not match the current VK context',
        });
      }

      const templates = await getServerTemplates(groupId);
      const visibleTemplates = auth.isCommunityAdmin
        ? templates
        : templates.filter((template) => template?.publicationStatus === 'published');

      if (!auth.isCommunityAdmin && groupId <= 0) {
        return sendJson(response, 403, {
          ok: false,
          error: 'Public templates are available only in the current VK community context',
        });
      }

      if (!auth.isCommunityAdmin && auth.groupId <= 0) {
        return sendJson(response, 403, {
          ok: false,
          error: 'Public templates are available only inside a VK community',
        });
      }

      return sendJson(response, 200, { ok: true, data: visibleTemplates });
    }

    if (request.method === 'POST') {
      const action = String(request.query?.action || request.body?.action || '').toLowerCase();

      if (action === 'transfer') {
        const auth = getTrustedViewerContext(request);
        if (!auth) {
          return sendJson(response, 401, {
            ok: false,
            error: 'VK launch params verification failed',
          });
        }

        if (!auth.isCommunityAdmin) {
          return sendJson(response, 403, {
            ok: false,
            error: 'Community admin access required',
          });
        }

        const fromGroupId = parseGroupId(request.body?.fromGroupId);
        const toGroupId = parseGroupId(request.body?.toGroupId);

        const connectedCommunities = await getViewerCommunities(auth.viewerId);
        const availableGroupIds = new Set(
          connectedCommunities.map((community) => parseGroupId(community.groupId)),
        );

        if (auth.groupId > 0) {
          availableGroupIds.add(auth.groupId);
        }

        if (!availableGroupIds.has(fromGroupId)) {
          return sendJson(response, 403, {
            ok: false,
            error: 'Source community is not available in the current workspace',
          });
        }

        if (!availableGroupIds.has(toGroupId)) {
          return sendJson(response, 403, {
            ok: false,
            error: 'Target community is not connected to the current workspace',
          });
        }

        const result = await transferServerTemplate(
          request.body?.templateId,
          fromGroupId,
          toGroupId,
        );
        return sendJson(response, 200, { ok: true, data: result });
      }

      const auth = requireCommunityAdmin(request, response, groupId);
      if (!auth) {
        return undefined;
      }

      const incomingTemplates = Array.isArray(request.body)
        ? request.body
        : request.body?.templates;
      if (!Array.isArray(incomingTemplates)) {
        return sendJson(response, 400, { ok: false, error: 'Templates payload must be an array' });
      }

      const templates = await saveServerTemplates(incomingTemplates, groupId);
      return sendJson(response, 200, { ok: true, data: templates });
    }

    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('templates api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Templates request failed',
    });
  }
}
