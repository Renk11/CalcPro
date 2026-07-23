import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

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

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

async function requestSupabase(pathname, { method = 'GET', body, prefer } = {}) {
  const baseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${baseUrl}/rest/v1/${pathname.replace(/^\/+/, '')}`, {
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

async function fetchAllSupabaseRows(table, select = '*') {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const query = new URLSearchParams({
      select,
      limit: String(pageSize),
      offset: String(offset),
    });
    const batch = await requestSupabase(`${table}?${query.toString()}`);

    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    rows.push(...batch);

    if (batch.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

async function createMysqlPool() {
  return mysql.createPool({
    host: requireEnv('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306) || 3306,
    user: requireEnv('MYSQL_USER'),
    password: requireEnv('MYSQL_PASSWORD'),
    database: requireEnv('MYSQL_DATABASE'),
    connectionLimit: 5,
    charset: 'utf8mb4',
  });
}

async function ensureMysqlSchema(pool) {
  const schemaPath = path.join(projectRoot, 'beget-mysql-schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const statements = schemaSql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function upsertAppSettings(pool, rows) {
  if (rows.length === 0) {
    return 0;
  }

  const sql = `
    INSERT INTO app_settings (\`key\`, \`value\`, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      \`value\` = VALUES(\`value\`),
      created_at = VALUES(created_at),
      updated_at = VALUES(updated_at)
  `;

  for (const row of rows) {
    await pool.execute(sql, [
      row.key,
      JSON.stringify(row.value ?? {}),
      row.created_at ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      row.updated_at ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
    ]);
  }

  return rows.length;
}

async function upsertPayments(pool, rows) {
  if (rows.length === 0) {
    return 0;
  }

  const sql = `
    INSERT INTO payments (
      id,
      status,
      amount_rub,
      description,
      payment_url,
      paid_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      status = VALUES(status),
      amount_rub = VALUES(amount_rub),
      description = VALUES(description),
      payment_url = VALUES(payment_url),
      paid_at = VALUES(paid_at),
      created_at = VALUES(created_at),
      updated_at = VALUES(updated_at)
  `;

  for (const row of rows) {
    await pool.execute(sql, [
      row.id,
      row.status ?? 'pending',
      Number(row.amount_rub) || 0,
      row.description ?? null,
      row.payment_url ?? null,
      row.paid_at ?? null,
      row.created_at ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      row.updated_at ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
    ]);
  }

  return rows.length;
}

async function main() {
  loadEnvFile();

  console.log('Starting Supabase -> MySQL migration...');

  const [appSettingsRows, paymentRows] = await Promise.all([
    fetchAllSupabaseRows('app_settings', 'key,value,created_at,updated_at'),
    fetchAllSupabaseRows(
      'payments',
      'id,status,amount_rub,description,payment_url,paid_at,created_at,updated_at',
    ),
  ]);

  console.log(`Fetched ${appSettingsRows.length} app_settings rows from Supabase.`);
  console.log(`Fetched ${paymentRows.length} payments rows from Supabase.`);

  const pool = await createMysqlPool();

  try {
    await ensureMysqlSchema(pool);
    const migratedSettings = await upsertAppSettings(pool, appSettingsRows);
    const migratedPayments = await upsertPayments(pool, paymentRows);

    console.log(`Migrated ${migratedSettings} app_settings rows into MySQL.`);
    console.log(`Migrated ${migratedPayments} payments rows into MySQL.`);
    console.log('Migration completed successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
