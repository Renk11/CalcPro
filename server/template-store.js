import { supabaseSelect, supabaseUpsert } from './supabase.js';

const TEMPLATES_KEY = 'calcpro:templates';

function normalizeTemplates(templates = []) {
  return Array.isArray(templates) ? templates : [];
}

async function readSettingRow(key) {
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

async function writeSettingRow(key, value) {
  try {
    await supabaseUpsert(
      'app_settings',
      [
        {
          key,
          value,
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

export async function getServerTemplates() {
  return normalizeTemplates((await readSettingRow(TEMPLATES_KEY)) || []);
}

export async function saveServerTemplates(templates) {
  const normalized = normalizeTemplates(templates);
  await writeSettingRow(TEMPLATES_KEY, normalized);
  return normalized;
}
