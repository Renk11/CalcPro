import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import adminSettingsHandler from '../api/admin-settings.js';
import communitiesHandler from '../api/communities.js';
import requestsHandler from '../api/requests.js';
import supportHandler from '../api/support.js';
import templatesHandler from '../api/templates.js';
import vkCallbackHandler from '../api/vk-callback.js';
import yookassaHandler from '../api/yookassa.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const port = Number(process.env.PORT || 3000);
const VK_LAUNCH_SECRET_ENV_KEYS = ['VK_APP_SECRET', 'VK_MINI_APP_SECRET', 'VK_CLIENT_SECRET'];
const DEFAULT_APP_HOSTS = ['app.calcpro.su'];

const API_ROUTES = new Map([
  ['/api/admin-settings', adminSettingsHandler],
  ['/api/communities', communitiesHandler],
  ['/api/requests', requestsHandler],
  ['/api/support', supportHandler],
  ['/api/templates', templatesHandler],
  ['/api/vk-callback', vkCallbackHandler],
  ['/api/yookassa', yookassaHandler],
]);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function loadEnvFile() {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function getConfiguredVkLaunchSecrets() {
  return VK_LAUNCH_SECRET_ENV_KEYS.filter((key) => String(process.env[key] || '').trim());
}

function logVkLaunchSecretStatus() {
  const configuredKeys = getConfiguredVkLaunchSecrets();
  if (configuredKeys.length === 0) {
    console.warn(
      '[vk-auth] VK launch params signature verification is disabled: set VK_APP_SECRET, VK_MINI_APP_SECRET, or VK_CLIENT_SECRET.',
    );
    return;
  }

  if (configuredKeys.length > 1) {
    console.warn(
      `[vk-auth] Multiple VK app secrets are configured (${configuredKeys.join(', ')}). CalcPro will use ${configuredKeys[0]}.`,
    );
  }
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function getRequestQuery(url) {
  const query = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

function parseRequestBody(rawBody, contentType) {
  if (!rawBody) {
    return {};
  }

  if (contentType.includes('application/json')) {
    return JSON.parse(rawBody);
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(rawBody);
    return Object.fromEntries(params.entries());
  }

  if (contentType.includes('text/plain')) {
    return rawBody;
  }

  return {};
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = '';

    request.on('data', (chunk) => {
      rawBody += chunk;

      if (rawBody.length > 2 * 1024 * 1024) {
        reject(new Error('Request body is too large'));
        request.destroy();
      }
    });

    request.on('end', () => {
      try {
        const contentType = String(request.headers['content-type'] || '').toLowerCase();
        resolve(parseRequestBody(rawBody, contentType));
      } catch (error) {
        reject(error);
      }
    });

    request.on('error', reject);
  });
}

async function handleApiRequest(request, response, url) {
  const handler = API_ROUTES.get(url.pathname);
  if (!handler) {
    return sendJson(response, 404, { ok: false, error: 'API route not found' });
  }

  try {
    request.query = getRequestQuery(url);
    request.body =
      request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH'
        ? await readRequestBody(request)
        : {};

    return await handler(request, response);
  } catch (error) {
    console.error('api gateway error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
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

  return new Set([...DEFAULT_APP_HOSTS, ...configuredHosts].filter(Boolean));
}

function isAppHost(hostHeader) {
  const host = normalizeHost(hostHeader);
  if (!host) {
    return false;
  }

  return getConfiguredAppHosts().has(host);
}

function resolveStaticFile(pathname, hostHeader) {
  const defaultEntryFile = isAppHost(hostHeader) ? '/index.html' : '/landing.html';
  const normalizedPath = pathname === '/' ? defaultEntryFile : pathname;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, '');
  return path.join(distDir, safePath);
}

function sendFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';

  response.statusCode = 200;
  response.setHeader('Content-Type', contentType);
  fs.createReadStream(filePath).pipe(response);
}

function handleStaticRequest(request, response, url) {
  const candidatePath = resolveStaticFile(url.pathname, request.headers.host);
  const fallbackPath = path.join(
    distDir,
    isAppHost(request.headers.host) ? 'index.html' : 'landing.html',
  );

  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
    return sendFile(response, candidatePath);
  }

  if (fs.existsSync(fallbackPath)) {
    return sendFile(response, fallbackPath);
  }

  response.statusCode = 503;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end('Build output not found. Run "npm run build" first.');
}

loadEnvFile();
logVkLaunchSecretStatus();

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    return handleApiRequest(request, response, url);
  }

  return handleStaticRequest(request, response, url);
});

server.listen(port, () => {
  console.log(`CalcPro server is listening on port ${port}`);
});
