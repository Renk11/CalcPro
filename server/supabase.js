function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

export function hasSupabaseCredentials() {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.serviceRoleKey);
}

async function requestSupabase(path, { method = 'GET', body, prefer } = {}) {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path.replace(/^\/+/, '')}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(payload?.message || payload?.details || text || 'Supabase request failed');
  }

  return payload;
}

export async function supabaseSelect(table, { select = '*', filter = '', limit = 1 } = {}) {
  const query = new URLSearchParams();
  query.set('select', select);
  if (filter) {
    query.append(filter.key, filter.value);
  }
  if (limit) {
    query.set('limit', String(limit));
  }

  return requestSupabase(`${table}?${query.toString()}`, {
    method: 'GET',
  });
}

export async function supabaseUpsert(table, rows, { onConflict } = {}) {
  const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  return requestSupabase(`${table}${query}`, {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

export async function supabaseUpdate(table, filter, patch) {
  const query = new URLSearchParams();
  query.append(filter.key, filter.value);
  return requestSupabase(`${table}?${query.toString()}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
}

export async function supabaseDelete(table, filter) {
  const query = new URLSearchParams();
  query.append(filter.key, filter.value);
  return requestSupabase(`${table}?${query.toString()}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
}
