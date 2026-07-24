import { sendJson } from '../server/http.js';
import { getTrustedViewerContext, sendTrustedViewerContextError } from '../server/request-auth.js';
import { getServerFolders, saveServerFolders } from '../server/folder-store.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
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

  if (auth.groupId <= 0 || auth.groupId !== groupId) {
    sendJson(response, 403, {
      ok: false,
      error: 'The requested group does not match the current VK context',
    });
    return null;
  }

  return auth;
}

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);

    if (!groupId) {
      return sendJson(response, 400, { ok: false, error: 'groupId is required' });
    }

    const auth = await requireWorkspaceCommunityAdmin(request, response, groupId);
    if (!auth) {
      return undefined;
    }

    if (request.method === 'GET') {
      const folders = await getServerFolders(groupId);
      return sendJson(response, 200, { ok: true, data: folders });
    }

    if (request.method === 'POST') {
      const incomingFolders = Array.isArray(request.body) ? request.body : request.body?.folders;
      if (!Array.isArray(incomingFolders)) {
        return sendJson(response, 400, { ok: false, error: 'Folders payload must be an array' });
      }

      const folders = await saveServerFolders(incomingFolders, groupId);
      return sendJson(response, 200, { ok: true, data: folders });
    }

    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('folders api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Folders request failed',
    });
  }
}
