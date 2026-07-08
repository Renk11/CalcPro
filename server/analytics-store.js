import { hasSupabaseCredentials, supabaseSelect, supabaseUpsert } from './supabase.js';

const ANALYTICS_KEY = 'calcpro:analytics';
const GROUP_ANALYTICS_KEY_PREFIX = 'calcpro:analytics:group:';
const ALLOWED_DEVICES = new Set(['desktop', 'tablet', 'mobile']);

function normalizeGroupId(groupId) {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? String(numericGroupId) : '';
}

function getAnalyticsKey(groupId) {
  const normalizedGroupId = normalizeGroupId(groupId);
  return normalizedGroupId ? `${GROUP_ANALYTICS_KEY_PREFIX}${normalizedGroupId}` : ANALYTICS_KEY;
}

function normalizeAnalyticsEvent(event = {}, fallbackGroupId = 0) {
  const groupId = Number(event.groupId) || Number(fallbackGroupId) || 0;
  const rawDevice = String(event.device || '').trim();

  return {
    id: String(event.id || `analytics-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    type: 'view',
    groupId,
    templateId: String(event.templateId || '').trim(),
    templateTitle: String(event.templateTitle || 'Калькулятор').trim() || 'Калькулятор',
    source: String(event.source || 'Прямой').trim() || 'Прямой',
    device: ALLOWED_DEVICES.has(rawDevice) ? rawDevice : 'desktop',
    createdAt: String(event.createdAt || new Date().toISOString()),
  };
}

function normalizeAnalyticsEvents(events = [], groupId = 0) {
  if (!Array.isArray(events)) {
    return [];
  }

  return events
    .map((event) => normalizeAnalyticsEvent(event, groupId))
    .filter((event) => event.groupId > 0 && event.templateId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

async function readAnalyticsRow(key) {
  if (!hasSupabaseCredentials()) {
    return null;
  }

  try {
    const rows = await supabaseSelect('app_settings', {
      select: 'value',
      filter: { key: 'key', value: `eq.${key}` },
      limit: 1,
    });

    return rows?.[0]?.value ?? null;
  } catch (error) {
    if (String(error?.message || '').includes('schema cache')) {
      return null;
    }

    throw error;
  }
}

async function writeAnalyticsRow(key, analyticsEvents) {
  if (!hasSupabaseCredentials()) {
    throw new Error('SUPABASE credentials are not configured');
  }

  try {
    await supabaseUpsert(
      'app_settings',
      [
        {
          key,
          value: analyticsEvents,
        },
      ],
      { onConflict: 'key' },
    );
  } catch (error) {
    if (!String(error?.message || '').includes('schema cache')) {
      throw error;
    }
  }
}

export async function getServerAnalyticsEvents(groupId) {
  const value = await readAnalyticsRow(getAnalyticsKey(groupId));
  return normalizeAnalyticsEvents(value, groupId);
}

export async function addServerAnalyticsEvent(event, groupId) {
  const current = await getServerAnalyticsEvents(groupId);
  const next = normalizeAnalyticsEvents([event, ...current], groupId);
  await writeAnalyticsRow(getAnalyticsKey(groupId), next);
  return next;
}
