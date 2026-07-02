import crypto from 'node:crypto';
import { sendJson } from './http.js';

const COMMUNITY_ADMIN_ROLES = new Set(['admin', 'editor', 'moder']);
export const VK_LAUNCH_PARAMS_ERROR = 'VK launch params verification failed';

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

function buildLaunchParamsSecret(secret) {
  return crypto.createHmac('sha256', 'WebAppData').update(secret).digest();
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

function buildSignedPayload(params) {
  return Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && key.startsWith('vk_') && String(value || '').trim())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${String(value).trim()}`)
    .join('&');
}

function isValidLaunchSignature(params) {
  const secret = resolveVkAppSecret();
  const sign = String(params?.sign || '').trim();

  if (!secret || !sign) {
    return false;
  }

  const payload = buildSignedPayload(params);
  if (!payload) {
    return false;
  }

  const expectedSigns = [
    normalizeBase64Url(
      crypto.createHmac('sha256', buildLaunchParamsSecret(secret)).update(payload).digest('base64'),
    ),
    normalizeBase64Url(crypto.createHmac('sha256', secret).update(payload).digest('base64')),
  ];

  return expectedSigns.some((expectedSign) => {
    if (sign.length !== expectedSign.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(sign), Buffer.from(expectedSign));
  });
}

export function getTrustedViewerContextError(request) {
  const { launchParams, errorCode } = parseLaunchParamsHeader(request);
  if (!launchParams) {
    return {
      errorCode: errorCode || 'missing_launch_params',
    };
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
    error: VK_LAUNCH_PARAMS_ERROR,
    errorCode: error?.errorCode || 'unknown_vk_context_error',
  });
}

export function getTrustedViewerContext(request) {
  const authError = getTrustedViewerContextError(request);
  if (authError) {
    return null;
  }

  const { launchParams } = parseLaunchParamsHeader(request);

  const viewerId = Number(launchParams.vk_user_id || 0);
  const groupId = Number(launchParams.vk_group_id || 0);
  const viewerRole = String(launchParams.vk_viewer_group_role || '').trim().toLowerCase();

  return {
    viewerId: Number.isInteger(viewerId) && viewerId > 0 ? viewerId : 0,
    groupId: Number.isInteger(groupId) && groupId > 0 ? groupId : 0,
    viewerRole,
    isCommunityAdmin: COMMUNITY_ADMIN_ROLES.has(viewerRole),
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

export function requireCommunityAdmin(request, response, groupId) {
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

  if (groupId > 0 && context.groupId !== groupId) {
    sendJson(response, 403, {
      ok: false,
      error: 'The requested group does not match the current VK context',
    });
    return null;
  }

  return context;
}
