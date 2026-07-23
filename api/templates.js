import { sendJson } from '../server/http.js';
import { getTrustedViewerContext, sendTrustedViewerContextError } from '../server/request-auth.js';
import {
  findPublishedTemplateByPublicId,
  getServerTemplates,
  saveServerTemplates,
  transferServerTemplate,
} from '../server/template-store.js';
import { getVerifiedViewerCommunityGroupIds } from '../server/community-store.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
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

export default async function handler(request, response) {
  try {
    const requestedGroupId = parseGroupId(request.query?.groupId || request.body?.groupId);
    const publicTemplateId = String(
      request.query?.calculator || request.query?.publicId || request.body?.calculator || '',
    ).trim();

    if (request.method === 'GET') {
      if (publicTemplateId) {
        const template = await findPublishedTemplateByPublicId(publicTemplateId);
        return sendJson(response, 200, { ok: true, data: template ? [template] : [] });
      }

      const auth = getTrustedViewerContext(request);
      if (!auth) {
        sendTrustedViewerContextError(request, response);
        return undefined;
      }

      if (auth.isCommunityAdmin && requestedGroupId > 0) {
        if (auth.groupId <= 0 || auth.groupId !== requestedGroupId) {
          return sendJson(response, 403, {
            ok: false,
            error: 'The requested group does not match the current VK context',
          });
        }
      } else if (
        !auth.isCommunityAdmin &&
        requestedGroupId > 0 &&
        auth.groupId > 0 &&
        auth.groupId !== requestedGroupId
      ) {
        return sendJson(response, 403, {
          ok: false,
          error: 'The requested group does not match the current VK context',
        });
      }

      const targetGroupId = auth.isCommunityAdmin
        ? requestedGroupId
        : requestedGroupId > 0
          ? requestedGroupId
          : auth.groupId;

      const templates = await getServerTemplates(targetGroupId);
      const visibleTemplates = auth.isCommunityAdmin
        ? templates
        : templates.filter((template) => template?.publicationStatus === 'published');

      if (!auth.isCommunityAdmin && targetGroupId <= 0) {
        return sendJson(response, 403, {
          ok: false,
          error: 'Public templates are available only in the current VK community context',
        });
      }

      return sendJson(response, 200, { ok: true, data: visibleTemplates });
    }

    if (request.method === 'POST') {
      const groupId = requestedGroupId;
      const action = String(request.query?.action || request.body?.action || '').toLowerCase();

      if (action === 'transfer') {
        const auth = getTrustedViewerContext(request);
        if (!auth) {
          sendTrustedViewerContextError(request, response);
          return undefined;
        }

        if (!auth.isCommunityAdmin) {
          return sendJson(response, 403, {
            ok: false,
            error: 'Community admin access required',
          });
        }

        const fromGroupId = parseGroupId(request.body?.fromGroupId);
        const toGroupId = parseGroupId(request.body?.toGroupId);

        const availableGroupIds = new Set(await getVerifiedViewerCommunityGroupIds(auth.viewerId));

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

      const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
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
