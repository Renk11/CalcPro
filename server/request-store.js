import { hasSupabaseCredentials, supabaseSelect, supabaseUpsert } from './supabase.js';

const REQUESTS_KEY = 'calcpro:requests';
const GROUP_REQUESTS_KEY_PREFIX = 'calcpro:requests:group:';

function normalizeGroupId(groupId) {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? String(numericGroupId) : '';
}

function getRequestsKey(groupId) {
  const normalizedGroupId = normalizeGroupId(groupId);
  return normalizedGroupId ? `${GROUP_REQUESTS_KEY_PREFIX}${normalizedGroupId}` : REQUESTS_KEY;
}

function normalizeRequestStatus(status) {
  return status === 'in_progress' || status === 'done' || status === 'rejected' || status === 'new'
    ? status
    : 'new';
}

function normalizeRequest(request = {}) {
  const details = Array.isArray(request.details)
    ? request.details
        .map((item) => ({
          key: String(item?.key || ''),
          label: String(item?.label || ''),
          value: String(item?.value || ''),
        }))
        .filter((item) => item.key || item.label || item.value)
    : undefined;

  return {
    id: String(request.id || `request-${Date.now()}`),
    templateId: String(request.templateId || ''),
    templateTitle: String(request.templateTitle || 'Калькулятор'),
    status: normalizeRequestStatus(request.status),
    name: String(request.name || ''),
    phone: String(request.phone || ''),
    comment: String(request.comment || ''),
    amount: Number(request.amount) || 0,
    createdAt: String(request.createdAt || new Date().toISOString()),
    values: request.values && typeof request.values === 'object' ? request.values : {},
    ...(details?.length ? { details } : {}),
  };
}

function normalizeRequests(requests = []) {
  if (!Array.isArray(requests)) {
    return [];
  }

  const unique = new Map();
  requests.forEach((request) => {
    const normalized = normalizeRequest(request);
    unique.set(normalized.id, normalized);
  });

  return [...unique.values()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

async function readRequestRow(key) {
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

async function writeRequestRow(key, requests) {
  if (!hasSupabaseCredentials()) {
    throw new Error('SUPABASE credentials are not configured');
  }

  try {
    await supabaseUpsert(
      'app_settings',
      [
        {
          key,
          value: requests,
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

export async function getServerRequests(groupId) {
  const value = await readRequestRow(getRequestsKey(groupId));
  return normalizeRequests(value);
}

export async function addServerRequest(request, groupId) {
  const current = await getServerRequests(groupId);
  const next = normalizeRequests([request, ...current]);
  await writeRequestRow(getRequestsKey(groupId), next);
  return next;
}

export async function mergeServerRequests(requests, groupId) {
  const current = await getServerRequests(groupId);
  const next = normalizeRequests([...requests, ...current]);
  await writeRequestRow(getRequestsKey(groupId), next);
  return next;
}

export async function updateServerRequest(requestId, patch, groupId) {
  const current = await getServerRequests(groupId);
  const normalizedRequestId = String(requestId || '').trim();
  const next = current.map((request) =>
    request.id === normalizedRequestId
      ? normalizeRequest({
          ...request,
          ...patch,
          id: request.id,
          createdAt: request.createdAt,
          values: request.values,
          details: request.details,
        })
      : request,
  );
  await writeRequestRow(getRequestsKey(groupId), next);
  return next;
}

export async function deleteServerRequest(requestId, groupId) {
  const current = await getServerRequests(groupId);
  const normalizedRequestId = String(requestId || '').trim();
  const next = current.filter((request) => request.id !== normalizedRequestId);
  await writeRequestRow(getRequestsKey(groupId), next);
  return next;
}
