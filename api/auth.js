import { sendJson } from '../server/http.js';
import {
  clearWebSession,
  consumeOauthState,
  createOauthState,
  createWebSession,
  getWebSession,
  updateWebSession,
} from '../server/web-session.js';
import {
  exchangeVkOAuthCode,
  getVkManagedCommunities,
  getVkUserInfoByAccessToken,
} from '../server/vk.js';
import { getViewerCommunities } from '../server/community-store.js';

const DEFAULT_VK_APP_ID = '54626522';
const VK_OAUTH_SCOPE = 'groups';

function getVkAppId() {
  return String(process.env.VK_APP_ID || process.env.VK_CLIENT_ID || DEFAULT_VK_APP_ID).trim();
}

function resolvePublicOrigin(request) {
  const configured = String(process.env.PUBLIC_APP_URL || '').trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return configured;
    }
  }

  const protocol =
    String(request.headers['x-forwarded-proto'] || '').trim() ||
    (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ? 'https' : 'http');
  const host = String(request.headers.host || '').trim() || 'localhost:3000';
  return `${protocol}://${host}`;
}

function buildCallbackUrl(request) {
  return `${resolvePublicOrigin(request)}/api/auth?action=vk-callback`;
}

function sendRedirect(response, location) {
  response.statusCode = 302;
  response.setHeader('Location', location);
  response.end();
}

function buildSessionResponse(session, connectedCommunities) {
  return {
    viewerId: session.viewerId,
    profile: session.profile,
    connectedCommunities,
    manageableCommunities: session.manageableCommunities,
  };
}

export default async function handler(request, response) {
  try {
    const action = String(request.query?.action || request.body?.action || '').trim().toLowerCase();

    if (request.method === 'GET' && action === 'session') {
      const session = getWebSession(request);
      if (!session) {
        return sendJson(response, 200, { ok: true, data: null });
      }

      const connectedCommunities = await getViewerCommunities(session.viewerId);
      return sendJson(response, 200, {
        ok: true,
        data: buildSessionResponse(session, connectedCommunities),
      });
    }

    if (request.method === 'GET' && action === 'vk-start') {
      const appId = getVkAppId();
      if (!appId) {
        return sendJson(response, 500, { ok: false, error: 'VK app id is not configured' });
      }

      const returnTo = String(request.query?.returnTo || '/').trim() || '/';
      const state = createOauthState(response, request, { returnTo });
      const authorizeUrl = new URL('https://oauth.vk.com/authorize');
      authorizeUrl.searchParams.set('client_id', appId);
      authorizeUrl.searchParams.set('redirect_uri', buildCallbackUrl(request));
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('scope', VK_OAUTH_SCOPE);
      authorizeUrl.searchParams.set('state', state);
      authorizeUrl.searchParams.set('display', 'page');
      authorizeUrl.searchParams.set('v', '5.199');
      return sendRedirect(response, authorizeUrl.toString());
    }

    if (request.method === 'GET' && action === 'vk-callback') {
      const code = String(request.query?.code || '').trim();
      const state = String(request.query?.state || '').trim();
      const statePayload = consumeOauthState(request, response, state);
      if (!code || !statePayload) {
        return sendRedirect(response, '/?webAuthError=vk_oauth_state');
      }

      const tokenPayload = await exchangeVkOAuthCode({
        code,
        redirectUri: buildCallbackUrl(request),
      });
      const accessToken = String(tokenPayload?.access_token || '').trim();
      const userId = Number(tokenPayload?.user_id || 0);
      if (!accessToken || !Number.isInteger(userId) || userId <= 0) {
        return sendRedirect(response, '/?webAuthError=vk_oauth_token');
      }

      const [profile, manageableCommunities] = await Promise.all([
        getVkUserInfoByAccessToken(accessToken, userId),
        getVkManagedCommunities(accessToken).catch(() => []),
      ]);

      createWebSession(response, request, {
        viewerId: userId,
        accessToken,
        profile,
        manageableCommunities,
      });

      return sendRedirect(response, statePayload.returnTo || '/');
    }

    if (request.method === 'POST' && action === 'logout') {
      clearWebSession(response, request);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === 'POST' && action === 'refresh-managed') {
      const session = getWebSession(request);
      if (!session?.accessToken) {
        return sendJson(response, 401, { ok: false, error: 'Web session is required' });
      }

      const manageableCommunities = await getVkManagedCommunities(session.accessToken);
      const nextSession = updateWebSession(response, request, { manageableCommunities });
      const connectedCommunities = await getViewerCommunities(session.viewerId);

      return sendJson(response, 200, {
        ok: true,
        data: nextSession ? buildSessionResponse(nextSession, connectedCommunities) : null,
      });
    }

    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    return sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Auth request failed',
    });
  }
}
