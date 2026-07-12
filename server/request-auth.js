import crypto from 'node:crypto';
import { sendJson } from './http.js';
import { getViewerCommunities } from './community-store.js';
import { getWebSession } from './web-session.js';

const COMMUNITY_ADMIN_ROLES = new Set(['admin', 'editor', 'moder']);
export const VK_LAUNCH_PARAMS_ERROR = 'VK launch params verification failed';
export const WEB_SESSION_ERROR = 'CalcPro web session is required';

function isLocalDevHost(hostname) {
  const normalizedHostname = String(hostname || '').trim().toLowerCase();
  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname === '127.0.0.1' ||
    normalizedHostname === '::1' ||
    normalizedHostname === '[::1]'
  );
}

function normalizeHost(hostHeader) {
  return String(hostHeader || '')
    .split(':')[0]
    .trim()
    .toLowerCase();
}

function getConfiguredAppHosts() {
  const configuredHosts = String(process.env.CALCPRO_APP_HOSTS || '')
    .split(',')
    .map((host) => normalizeHost(host))
    .filter(Boolean);

  const publicAppUrl = String(process.env.PUBLIC_APP_URL || '').trim();
  if (publicAppUrl) {
    try {
      configuredHosts.push(normalizeHost(new URL(publicAppUrl).host));
    } catch {
      configuredHosts.push(normalizeHost(publicAppUrl));
    }
  }

  return new Set(configuredHosts.filter(Boolean));
}

function isSelfHostedAppHost(hostHeader) {
  const host = normalizeHost(hostHeader);
  if (!host || host.endsWith('vercel.app')) {
    return false;
  }

  return getConfiguredAppHosts().has(host);
}

function shouldBypassLaunchParamsVerification(request) {
  if (String(process.env.CALCPRO_ALLOW_UNTRUSTED_VK_LAUNCH_PARAMS || '').trim() === '1') {
    return true;
  }

  if (String(process.env.CALCPRO_ENFORCE_VK_SIGNATURE || '').trim() === '1') {
    return false;
  }

  if (process.env.NODE_ENV === 'production') {
    // Self-hosted VK Mini App deployments can lose a valid signature because of
    // proxy/iframe specifics outside Vercel. Keep compatibility on the
    // configured production host and allow opting back into strict validation
    // with CALCPRO_ENFORCE_VK_SIGNATURE=1.
    if (isSelfHostedAppHost(request?.headers?.host)) {
      return true;
    }

    return false;
  }

  const hostHeader = String(request?.headers?.host || '').trim().toLowerCase();
  const hostname = hostHeader.includes(':') ? hostHeader.slice(0, hostHeader.indexOf(':')) : hostHeader;
  return isLocalDevHost(hostname);
}

function resolveVkAppSecret() {
  return String(
    process.env.VK_APP_SECRET ||
      process.env.VK_MINI_APP_SECRET ||
      process.env.VK_CLIENT_SECRET ||
      '',
  ).trim();
}

function hasVkAppSecret() {
  return Boolean(resolveVkAppSecret());
}

function normalizeBase64Url(value) {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildLaunchParamsSecrets(secret) {
  const normalizedSecret = String(secret || '').trim();
  if (!normalizedSecret) {
    return [];
  }

  return [
    normalizedSecret,
    crypto.createHmac('sha256', normalizedSecret).update('WebAppData').digest(),
    crypto.createHmac('sha256', 'WebAppData').update(normalizedSecret).digest(),
  ];
}

function parseLaunchParamsHeader(request) {
  const rawHeader = request.headers['x-vk-launch-params'];
  if (!rawHeader) {
    return {
      launchParams: null,
      errorCode: 'missing_launch_params',
    };
  }

  try {
    const parsed = JSON.parse(String(rawHeader));
    return {
      launchParams: parsed && typeof parsed === 'object' ? parsed : null,
      errorCode: parsed && typeof parsed === 'object' ? null : 'invalid_launch_params',
    };
  } catch {
    return {
      launchParams: null,
      errorCode: 'invalid_launch_params',
    };
  }
}

function extractLaunchParamsFromSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }

  const launchParams = Object.entries(source).reduce((acc, [key, value]) => {
    if (!key.startsWith('vk_') && key !== 'sign') {
      return acc;
    }

    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue) {
      return acc;
    }

    acc[key] = normalizedValue;
    return acc;
  }, {});

  return Object.keys(launchParams).length > 0 ? launchParams : null;
}

function parseLaunchParamsFallback(request) {
  const bodyPayload =
    extractLaunchParamsFromSource(request.body?.launchParams) ||
    extractLaunchParamsFromSource(request.body);
  if (bodyPayload) {
    return {
      launchParams: bodyPayload,
      errorCode: null,
    };
  }

  const queryPayload = extractLaunchParamsFromSource(request.query);
  if (queryPayload) {
    return {
      launchParams: queryPayload,
      errorCode: null,
    };
  }

  return {
    launchParams: null,
    errorCode: 'missing_launch_params',
  };
}

function parseLaunchParams(request) {
  const headerResult = parseLaunchParamsHeader(request);
  if (headerResult.launchParams) {
    return headerResult;
  }

  return parseLaunchParamsFallback(request);
}

function buildSignedPayload(params) {
  return Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && key.startsWith('vk_') && String(value || '').trim())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join('&');
}

function isValidLaunchSignature(params) {
  const secret = resolveVkAppSecret();
  const sign = normalizeBase64Url(String(params?.sign || '').trim());

  if (!secret || !sign) {
    return false;
  }

  const payload = buildSignedPayload(params);
  if (!payload) {
    return false;
  }

  const expectedSigns = buildLaunchParamsSecrets(secret).map((secretCandidate) =>
    normalizeBase64Url(
      crypto.createHmac('sha256', secretCandidate).update(payload).digest('base64'),
    ),
  );

  return expectedSigns.some((expectedSign) => {
    if (sign.length !== expectedSign.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(expectedSign));
  });
}

export function getTrustedViewerContextError(request) {
  const webSession = getWebSession(request);
  if (webSession) {
    return null;
  }

  const { launchParams, errorCode } = parseLaunchParams(request);
  if (!launchParams) {
    return {
      errorCode: errorCode || 'missing_launch_params_or_session',
    };
  }

  if (shouldBypassLaunchParamsVerification(request)) {
    return null;
  }

  if (hasVkAppSecret()) {
    if (!String(launchParams.sign || '').trim()) {
      return {
        errorCode: 'missing_sign',
      };
    }

    if (!isValidLaunchSignature(launchParams)) {
      return {
        errorCode: 'invalid_signature',
      };
    }
  }

  return null;
}

export function sendTrustedViewerContextError(request, response) {
  const error = getTrustedViewerContextError(request);
  sendJson(response, 401, {
    ok: false,
    error: error?.errorCode?.includes('session') ? WEB_SESSION_ERROR : VK_LAUNCH_PARAMS_ERROR,
    errorCode: error?.errorCode || 'unknown_vk_context_error',
  });
}

export function getTrustedViewerContext(request) {
  const webSession = getWebSession(request);
  if (webSession) {
    return {
      authType: 'web',
      viewerId: webSession.viewerId,
      groupId: 0,
      viewerRole: 'admin',
      isCommunityAdmin: true,
      profile: webSession.profile,
      manageableGroupIds: webSession.manageableCommunities.map((community) => community.groupId),
      sessionId: webSession.id,
    };
  }

  const authError = getTrustedViewerContextError(request);
  if (authError) {
    return null;
  }

  const { launchParams } = parseLaunchParams(request);

  const viewerId = Number(launchParams.vk_user_id || 0);
  const groupId = Number(launchParams.vk_group_id || 0);
  const viewerRole = String(launchParams.vk_viewer_group_role || '').trim().toLowerCase();

  return {
    authType: 'vk',
    viewerId: Number.isInteger(viewerId) && viewerId > 0 ? viewerId : 0,
    groupId: Number.isInteger(groupId) && groupId > 0 ? groupId : 0,
    viewerRole,
    isCommunityAdmin: COMMUNITY_ADMIN_ROLES.has(viewerRole),
    manageableGroupIds: [],
  };
}

export function requireTrustedViewerContext(request, response) {
  const context = getTrustedViewerContext(request);
  if (context) {
    return context;
  }

  sendTrustedViewerContextError(request, response);
  return null;
}

async function resolveAvailableGroupIds(context) {
  const availableGroupIds = new Set();

  if (context?.groupId > 0) {
    availableGroupIds.add(context.groupId);
  }

  if (context?.viewerId > 0) {
    const connectedCommunities = await getViewerCommunities(context.viewerId);
    connectedCommunities.forEach((community) => {
      const communityGroupId = Number(community.groupId);
      if (Number.isInteger(communityGroupId) && communityGroupId > 0) {
        availableGroupIds.add(communityGroupId);
      }
    });
  }

  return availableGroupIds;
}

export async function requireCommunityAdmin(request, response, groupId) {
  const context = requireTrustedViewerContext(request, response);
  if (!context) {
    return null;
  }

  if (!context.isCommunityAdmin) {
    sendJson(response, 403, {
      ok: false,
      error: 'Community admin access required',
    });
    return null;
  }

  if (groupId > 0) {
    const availableGroupIds = await resolveAvailableGroupIds(context);
    if (!availableGroupIds.has(groupId)) {
      sendJson(response, 403, {
        ok: false,
        error:
          context.authType === 'vk'
            ? 'The requested group does not match the current VK context'
            : 'The requested group is not connected to the current workspace',
      });
      return null;
    }
  }

  return context;
}
