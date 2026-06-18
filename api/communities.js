import { sendJson } from '../server/http.js';
import { requireTrustedViewerContext } from '../server/request-auth.js';
import {
  notifyCommunityConnected,
  notifyConnectStarted,
} from '../server/community-notifications.js';
import {
  connectViewerCommunity,
  disconnectViewerCommunity,
  getViewerCommunities,
  touchViewerCommunity,
} from '../server/community-store.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function parseViewerId(rawValue) {
  const viewerId = String(rawValue || '').trim();
  return viewerId ? viewerId : '';
}

function parseWorkspacePlan(rawValue) {
  return rawValue === 'free' || rawValue === 'start' || rawValue === 'pro' ? rawValue : undefined;
}

export default async function handler(request, response) {
  try {
    const action = String(request.query?.action || request.body?.action || '').toLowerCase();
    const auth = requireTrustedViewerContext(request, response);
    if (!auth) {
      return undefined;
    }

    const viewerId = parseViewerId(auth.viewerId);

    if (!viewerId) {
      return sendJson(response, 400, { ok: false, error: 'viewerId is required' });
    }

    if (request.method === 'GET') {
      const communities = await getViewerCommunities(viewerId);
      return sendJson(response, 200, { ok: true, data: communities });
    }

    if (request.method === 'POST') {
      if (action === 'notify-connect-start') {
        await notifyConnectStarted({
          viewerId: auth.viewerId,
          groupId: request.body?.groupId,
          fallbackGroupId: request.body?.fallbackGroupId,
          platform: request.body?.platform || request.body?.vkPlatform,
          pathname: request.body?.pathname,
        });

        return sendJson(response, 200, { ok: true });
      }

      if (action === 'disconnect') {
        const communities = await disconnectViewerCommunity(
          viewerId,
          request.query?.groupId || request.body?.groupId,
        );
        return sendJson(response, 200, { ok: true, data: communities });
      }

      if (action === 'touch') {
        const communities = await touchViewerCommunity(
          viewerId,
          request.query?.groupId || request.body?.groupId,
        );
        return sendJson(response, 200, { ok: true, data: communities });
      }

      const community = {
        groupId: parseGroupId(request.body?.groupId),
        name: request.body?.name,
        screenName: request.body?.screenName,
        photoUrl: request.body?.photoUrl,
        role: request.body?.role,
      };
      const workspacePlan = parseWorkspacePlan(request.body?.workspacePlan);

      const communities = await connectViewerCommunity(viewerId, community, workspacePlan);

      if (request.body?.notifyConnect === true) {
        await notifyCommunityConnected({
          viewerId: auth.viewerId,
          groupId: community.groupId,
          platform: request.body?.platform || request.body?.vkPlatform,
          communityName: community.name,
          communityScreenName: community.screenName,
        });
      }

      return sendJson(response, 200, { ok: true, data: communities });
    }

    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Failed to process communities',
    });
  }
}
