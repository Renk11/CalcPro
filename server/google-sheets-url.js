const GOOGLE_SHEETS_WEBHOOK_HOST = 'script.google.com';
const GOOGLE_SHEETS_WEBHOOK_PATH_PATTERN = /^\/macros\/s\/[^/]+\/exec\/?$/;

function parseGoogleSheetsWebhookUrl(value) {
  const trimmedValue = String(value || '').trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    return new URL(trimmedValue);
  } catch {
    return null;
  }
}

export function normalizeGoogleSheetsWebhookUrl(value) {
  const url = parseGoogleSheetsWebhookUrl(value);
  if (!url) {
    return '';
  }

  if (url.protocol !== 'https:') {
    return '';
  }

  if (url.username || url.password || url.hostname !== GOOGLE_SHEETS_WEBHOOK_HOST) {
    return '';
  }

  if (!GOOGLE_SHEETS_WEBHOOK_PATH_PATTERN.test(url.pathname)) {
    return '';
  }

  return url.toString();
}

export function assertValidGoogleSheetsWebhookUrl(value) {
  const normalizedUrl = normalizeGoogleSheetsWebhookUrl(value);
  if (!normalizedUrl) {
    throw new Error(
      'Google Sheets webhook URL must use https://script.google.com/macros/s/.../exec',
    );
  }

  return normalizedUrl;
}
