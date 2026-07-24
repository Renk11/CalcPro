import { supabaseSelect, supabaseUpsert } from './supabase.js';

const FOLDERS_KEY_PREFIX = 'calcpro:folders:group:';

function normalizeGroupId(groupId) {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? String(numericGroupId) : '';
}

function getFoldersKey(groupId) {
  const normalizedGroupId = normalizeGroupId(groupId);
  return normalizedGroupId ? `${FOLDERS_KEY_PREFIX}${normalizedGroupId}` : '';
}

function normalizeFolders(folders = []) {
  return Array.isArray(folders)
    ? folders.filter((folder) => folder && typeof folder === 'object' && folder.id)
    : [];
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

export async function getServerFolders(groupId) {
  const key = getFoldersKey(groupId);
  if (!key) {
    return [];
  }

  const folders = await readSettingRow(key);
  return normalizeFolders(folders);
}

export async function saveServerFolders(folders, groupId) {
  const key = getFoldersKey(groupId);
  if (!key) {
    return [];
  }

  const normalized = normalizeFolders(folders);
  await writeSettingRow(key, normalized);
  return normalized;
}
