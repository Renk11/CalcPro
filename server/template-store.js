import { supabaseSelect, supabaseUpsert } from './supabase.js';

const TEMPLATES_KEY = 'calcpro:templates';
const GROUP_TEMPLATES_KEY_PREFIX = 'calcpro:templates:group:';

function normalizeGroupId(groupId) {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? String(numericGroupId) : '';
}

function getTemplatesKey(groupId) {
  const normalizedGroupId = normalizeGroupId(groupId);
  return normalizedGroupId ? `${GROUP_TEMPLATES_KEY_PREFIX}${normalizedGroupId}` : TEMPLATES_KEY;
}

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

export async function getServerTemplates(groupId) {
  const scopedKey = getTemplatesKey(groupId);
  const scopedTemplates = await readSettingRow(scopedKey);

  if (scopedTemplates) {
    return normalizeTemplates(scopedTemplates);
  }

  if (normalizeGroupId(groupId)) {
    return normalizeTemplates((await readSettingRow(TEMPLATES_KEY)) || []);
  }

  return normalizeTemplates([]);
}

export async function saveServerTemplates(templates, groupId) {
  const normalized = normalizeTemplates(templates);
  await writeSettingRow(getTemplatesKey(groupId), normalized);
  return normalized;
}
