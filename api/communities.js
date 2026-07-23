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
import { resolveVkCommunityInfo } from '../server/vk.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function parseViewerId(rawValue) {
  const viewerId = String(rawValue || '').trim();
  return viewerId ? viewerId : '';
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

      if (action === 'resolve') {
        const community = await resolveVkCommunityInfo(
          request.body?.community || request.body?.value || request.body?.groupId,
        );
        return sendJson(response, 200, { ok: true, data: community });
      }

      const customNameRequested = request.body?.customName === true;
      const isCurrentCommunityContext =
        parseGroupId(request.body?.groupId) > 0 &&
        auth.groupId > 0 &&
        parseGroupId(request.body?.groupId) === auth.groupId;
      const community = {
        groupId: parseGroupId(request.body?.groupId),
        name: request.body?.name,
        customName: customNameRequested,
        screenName: request.body?.screenName,
        photoUrl: request.body?.photoUrl,
        role: isCurrentCommunityContext ? auth.viewerRole : request.body?.role,
        verifiedAt: isCurrentCommunityContext ? new Date().toISOString() : '',
      };

      if (!auth.isCommunityAdmin) {
        return sendJson(response, 403, {
          ok: false,
          error: 'Community admin access required',
        });
      }

      if (community.groupId <= 0) {
        return sendJson(response, 400, {
          ok: false,
          error: 'groupId is required',
        });
      }

      if (customNameRequested) {
        const existingCommunities = await getViewerCommunities(viewerId);
        const existingCommunity = existingCommunities.find((item) => item.groupId === community.groupId);

        if (!existingCommunity) {
          return sendJson(response, 404, {
            ok: false,
            error: 'Community is not connected to the current workspace',
          });
        }
      } else if (
        auth.groupId <= 0 ||
        (community.groupId !== auth.groupId && request.body?.notifyConnect !== true)
      ) {
        return sendJson(response, 403, {
          ok: false,
          error: 'Community can be connected only from the current VK community context',
        });
      }

      const communities = await connectViewerCommunity(viewerId, community);

      if (request.body?.notifyConnect === true) {
        await notifyCommunityConnected({
          viewerId: auth.viewerId,
          groupId: community.groupId,
          workspaceGroupId: request.body?.workspaceGroupId,
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
