import crypto from 'node:crypto';

const SESSION_COOKIE_NAME = 'calcpro_web_session';
const OAUTH_STATE_COOKIE_NAME = 'calcpro_vk_oauth_state';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function createRandomToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function parsePositiveInteger(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : 0;
}

function getCookieOptions(request) {
  const forwardedProto = String(request?.headers?.['x-forwarded-proto'] || '').trim().toLowerCase();
  const isSecure =
    forwardedProto === 'https' ||
    String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

  return {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: isSecure,
  };
}

function buildCookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge != null) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.secure) {
    parts.push('Secure');
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  parts.push(`Path=${options.path || '/'}`);
  return parts.join('; ');
}

function appendSetCookie(response, cookieHeader) {
  const current = response.getHeader('Set-Cookie');
  if (!current) {
    response.setHeader('Set-Cookie', cookieHeader);
    return;
  }

  if (Array.isArray(current)) {
    response.setHeader('Set-Cookie', [...current, cookieHeader]);
    return;
  }

  response.setHeader('Set-Cookie', [current, cookieHeader]);
}

function getSessionSecret() {
  const secret = String(
    process.env.CALCPRO_SESSION_SECRET ||
      process.env.VK_APP_SECRET ||
      process.env.VK_CLIENT_SECRET ||
      process.env.VK_MINI_APP_SECRET ||
      '',
  ).trim();

  if (!secret) {
    throw new Error('CALCPRO_SESSION_SECRET is not configured');
  }

  return crypto.createHash('sha256').update(secret).digest();
}

function encryptPayload(payload) {
  const key = getSessionSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptPayload(serializedValue) {
  const value = String(serializedValue || '').trim();
  if (!value) {
    return null;
  }

  const [ivPart, authTagPart, ciphertextPart] = value.split('.');
  if (!ivPart || !authTagPart || !ciphertextPart) {
    return null;
  }

  try {
    const key = getSessionSecret();
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      key,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    return null;
  }
}

function normalizeCommunities(items = []) {
  return Array.isArray(items)
    ? items
        .map((community) => {
          const groupId = parsePositiveInteger(community?.groupId);
          if (!groupId) {
            return null;
          }

          return {
            groupId,
            name: String(community?.name || `Сообщество ${groupId}`),
            screenName: String(community?.screenName || '').trim(),
            photoUrl: String(community?.photoUrl || '').trim(),
            role: String(community?.role || 'admin').trim(),
          };
        })
        .filter(Boolean)
    : [];
}

function normalizeSessionPayload(payload = {}) {
  const viewerId = parsePositiveInteger(payload.viewerId);
  if (!viewerId) {
    return null;
  }

  return {
    id: String(payload.id || createRandomToken()),
    viewerId,
    accessToken: String(payload.accessToken || '').trim(),
    profile: {
      id: viewerId,
      firstName: String(payload.profile?.firstName || '').trim(),
      lastName: String(payload.profile?.lastName || '').trim(),
      screenName: String(payload.profile?.screenName || '').trim(),
      photoUrl: String(payload.profile?.photoUrl || '').trim(),
    },
    manageableCommunities: normalizeCommunities(payload.manageableCommunities),
    createdAt: parsePositiveInteger(payload.createdAt) || Date.now(),
    expiresAt: parsePositiveInteger(payload.expiresAt) || Date.now() + SESSION_TTL_MS,
  };
}

export function createWebSession(response, request, payload) {
  const session = normalizeSessionPayload(payload);
  if (!session) {
    return null;
  }

  const nextSession = {
    ...session,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  appendSetCookie(
    response,
    buildCookieHeader(SESSION_COOKIE_NAME, encryptPayload(nextSession), {
      ...getCookieOptions(request),
      maxAge: SESSION_TTL_MS / 1000,
      expires: new Date(nextSession.expiresAt),
    }),
  );

  return nextSession;
}

export function getWebSession(request) {
  const rawCookie = String(request?.cookies?.[SESSION_COOKIE_NAME] || '').trim();
  if (!rawCookie) {
    return null;
  }

  const session = normalizeSessionPayload(decryptPayload(rawCookie));
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    return null;
  }

  return session;
}

export function updateWebSession(response, request, patch = {}) {
  const current = getWebSession(request);
  if (!current) {
    return null;
  }

  return createWebSession(response, request, {
    ...current,
    ...patch,
    id: current.id,
    viewerId: current.viewerId,
    accessToken: patch.accessToken ?? current.accessToken,
    manageableCommunities: patch.manageableCommunities ?? current.manageableCommunities,
    profile: {
      ...current.profile,
      ...(patch.profile || {}),
    },
    createdAt: current.createdAt,
  });
}

export function clearWebSession(response, request) {
  appendSetCookie(
    response,
    buildCookieHeader(SESSION_COOKIE_NAME, '', {
      ...getCookieOptions(request),
      maxAge: 0,
      expires: new Date(0),
    }),
  );
}

export function createOauthState(response, request, payload = {}) {
  const state = {
    id: createRandomToken(),
    returnTo: String(payload.returnTo || '/').trim() || '/',
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  };

  appendSetCookie(
    response,
    buildCookieHeader(OAUTH_STATE_COOKIE_NAME, encryptPayload(state), {
      ...getCookieOptions(request),
      maxAge: OAUTH_STATE_TTL_MS / 1000,
      expires: new Date(state.expiresAt),
    }),
  );

  return state.id;
}

export function consumeOauthState(request, response, state) {
  const cookieValue = String(request?.cookies?.[OAUTH_STATE_COOKIE_NAME] || '').trim();
  const payload = decryptPayload(cookieValue);
  const normalizedState = String(state || '').trim();

  appendSetCookie(
    response,
    buildCookieHeader(OAUTH_STATE_COOKIE_NAME, '', {
      ...getCookieOptions(request),
      maxAge: 0,
      expires: new Date(0),
    }),
  );

  if (!payload || !normalizedState || String(payload.id || '').trim() !== normalizedState) {
    return null;
  }

  if (Number(payload.expiresAt || 0) <= Date.now()) {
    return null;
  }

  return {
    returnTo: String(payload.returnTo || '/').trim() || '/',
  };
}
