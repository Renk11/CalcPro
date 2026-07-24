import mysql from 'mysql2/promise';

let mysqlPool = null;

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

function getMysqlConfig() {
  return {
    host: String(process.env.MYSQL_HOST || '').trim(),
    port: Number(process.env.MYSQL_PORT || 3306) || 3306,
    user: String(process.env.MYSQL_USER || '').trim(),
    password: String(process.env.MYSQL_PASSWORD || '').trim(),
    database: String(process.env.MYSQL_DATABASE || '').trim(),
  };
}

function hasMysqlCredentials() {
  const config = getMysqlConfig();
  return Boolean(config.host && config.user && config.database);
}

function getStorageMode() {
  return hasMysqlCredentials() ? 'mysql' : 'supabase';
}

export function hasSupabaseCredentials() {
  if (hasMysqlCredentials()) {
    return true;
  }

  const config = getSupabaseConfig();
  return Boolean(config.url && config.serviceRoleKey);
}

function getMysqlPool() {
  if (mysqlPool) {
    return mysqlPool;
  }

  const config = getMysqlConfig();
  mysqlPool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 10,
    charset: 'utf8mb4',
    namedPlaceholders: false,
  });

  return mysqlPool;
}

function normalizeMysqlRow(row) {
  if (!row || typeof row !== 'object') {
    return row;
  }

  if (Object.prototype.hasOwnProperty.call(row, 'value') && typeof row.value === 'string') {
    try {
      return {
        ...row,
        value: JSON.parse(row.value),
      };
    } catch {
      return row;
    }
  }

  return row;
}

function parseFilter(filter) {
  if (!filter || !filter.key) {
    return null;
  }

  const rawValue = String(filter.value || '');
  const separatorIndex = rawValue.indexOf('.');
  if (separatorIndex <= 0) {
    throw new Error(`Unsupported filter format: ${rawValue}`);
  }

  const operator = rawValue.slice(0, separatorIndex);
  const value = rawValue.slice(separatorIndex + 1);

  if (operator === 'eq') {
    return {
      sql: `\`${filter.key}\` = ?`,
      params: [value],
    };
  }

  if (operator === 'like') {
    return {
      sql: `\`${filter.key}\` LIKE ?`,
      params: [value],
    };
  }

  throw new Error(`Unsupported filter operator: ${operator}`);
}

function escapeMysqlIdentifier(identifier) {
  return `\`${String(identifier).replace(/`/g, '``')}\``;
}

async function requestMysqlSelect(table, { select = '*', filter = '', limit = 1 } = {}) {
  const pool = getMysqlPool();
  const parsedFilter = parseFilter(filter);
  const normalizedLimit = Number(limit);
  const selectedColumns =
    select === '*'
      ? '*'
      : select
          .split(',')
          .map((column) => escapeMysqlIdentifier(column.trim()))
          .join(', ');
  const clauses = [`SELECT ${selectedColumns} FROM ${escapeMysqlIdentifier(table)}`];
  const params = [];

  if (parsedFilter) {
    clauses.push(`WHERE ${parsedFilter.sql}`);
    params.push(...parsedFilter.params);
  }

  if (Number.isInteger(normalizedLimit) && normalizedLimit > 0) {
    clauses.push(`LIMIT ${normalizedLimit}`);
  }

  const [rows] = await pool.query(clauses.join(' '), params);
  return rows.map(normalizeMysqlRow);
}

async function requestMysqlUpsert(table, rows, { onConflict } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const pool = getMysqlPool();
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const placeholders = `(${columns.map(() => '?').join(', ')})`;
  const values = rows.flatMap((row) =>
    columns.map((column) => {
      const value = row[column];

      if (column === 'value' && value && typeof value === 'object') {
        return JSON.stringify(value);
      }

      return value ?? null;
    }),
  );
  const updateColumns = columns.filter((column) => column !== onConflict);

  const sql = [
    `INSERT INTO ${escapeMysqlIdentifier(table)} (${columns.map(escapeMysqlIdentifier).join(', ')})`,
    `VALUES ${rows.map(() => placeholders).join(', ')}`,
    updateColumns.length
      ? `ON DUPLICATE KEY UPDATE ${updateColumns
          .map((column) => `${escapeMysqlIdentifier(column)} = VALUES(${escapeMysqlIdentifier(column)})`)
          .join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  await pool.query(sql, values);

  if (!onConflict) {
    return rows;
  }

  const filterColumn = columns.includes(onConflict) ? onConflict : columns[0];
  const uniqueValues = [...new Set(rows.map((row) => row[filterColumn]).filter((value) => value != null))];

  if (uniqueValues.length === 0) {
    return rows;
  }

  const inPlaceholders = uniqueValues.map(() => '?').join(', ');
  const [selectedRows] = await pool.query(
    `SELECT * FROM ${escapeMysqlIdentifier(table)} WHERE ${escapeMysqlIdentifier(filterColumn)} IN (${inPlaceholders})`,
    uniqueValues,
  );

  return selectedRows.map(normalizeMysqlRow);
}

async function requestMysqlUpdate(table, filter, patch) {
  const pool = getMysqlPool();
  const parsedFilter = parseFilter(filter);

  if (!parsedFilter) {
    throw new Error('Update filter is required');
  }

  const patchEntries = Object.entries(patch || {});
  if (patchEntries.length === 0) {
    return [];
  }

  const sql = [
    `UPDATE ${escapeMysqlIdentifier(table)}`,
    `SET ${patchEntries.map(([key]) => `${escapeMysqlIdentifier(key)} = ?`).join(', ')}`,
    `WHERE ${parsedFilter.sql}`,
  ].join(' ');
  const patchValues = patchEntries.map(([key, value]) =>
    key === 'value' && value && typeof value === 'object' ? JSON.stringify(value) : value ?? null,
  );

  await pool.query(sql, [...patchValues, ...parsedFilter.params]);
  return requestMysqlSelect(table, { filter, limit: 1000 });
}

async function requestMysqlDelete(table, filter) {
  const pool = getMysqlPool();
  const parsedFilter = parseFilter(filter);

  if (!parsedFilter) {
    throw new Error('Delete filter is required');
  }

  const rows = await requestMysqlSelect(table, { filter, limit: 5000 });
  await pool.query(
    `DELETE FROM ${escapeMysqlIdentifier(table)} WHERE ${parsedFilter.sql}`,
    parsedFilter.params,
  );
  return rows;
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
  if (getStorageMode() === 'mysql') {
    return requestMysqlSelect(table, { select, filter, limit });
  }

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
  if (getStorageMode() === 'mysql') {
    return requestMysqlUpsert(table, rows, { onConflict });
  }

  const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  return requestSupabase(`${table}${query}`, {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation',
  });
}

export async function supabaseUpdate(table, filter, patch) {
  if (getStorageMode() === 'mysql') {
    return requestMysqlUpdate(table, filter, patch);
  }

  const query = new URLSearchParams();
  query.append(filter.key, filter.value);
  return requestSupabase(`${table}?${query.toString()}`, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
}

export async function supabaseDelete(table, filter) {
  if (getStorageMode() === 'mysql') {
    return requestMysqlDelete(table, filter);
  }

  const query = new URLSearchParams();
  query.append(filter.key, filter.value);
  return requestSupabase(`${table}?${query.toString()}`, {
    method: 'DELETE',
    prefer: 'return=representation',
  });
}
