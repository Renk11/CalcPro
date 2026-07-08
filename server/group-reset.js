import { getViewerCommunities, saveViewerCommunities } from './community-store.js';
import { hasSupabaseCredentials, supabaseDelete, supabaseSelect } from './supabase.js';

const RESET_PREFIXES = [
  'calcpro:templates:group:',
  'calcpro:requests:group:',
  'calcpro:support-tickets:group:',
  'calcpro:admin-settings:group:',
  'calcpro:communities:viewer:',
];

const GROUP_KEY_PREFIXES = RESET_PREFIXES.filter((prefix) => prefix.includes(':group:'));

function collectMatchingKeys(rows = []) {
  return rows
    .map((row) => String(row?.key || '').trim())
    .filter((key) => RESET_PREFIXES.some((prefix) => key.startsWith(prefix)));
}

function extractGroupIds(keys) {
  return [...new Set(
    keys
      .filter((key) => GROUP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .map((key) => Number(key.split(':').pop() || 0))
      .filter((groupId) => Number.isInteger(groupId) && groupId > 0),
  )].sort((left, right) => left - right);
}

function extractViewerIds(keys) {
  return [...new Set(
    keys
      .filter((key) => key.startsWith('calcpro:communities:viewer:'))
      .map((key) => String(key.split(':').pop() || '').trim())
      .filter(Boolean),
  )].sort();
}

function getGroupScopedKeys(groupId) {
  return GROUP_KEY_PREFIXES.map((prefix) => `${prefix}${groupId}`);
}

export async function resetSingleGroupData(groupId) {
  const normalizedGroupId = Number(groupId);
  if (!Number.isInteger(normalizedGroupId) || normalizedGroupId <= 0) {
    throw new Error('Valid groupId is required');
  }

  if (!hasSupabaseCredentials()) {
    throw new Error('SUPABASE credentials are not configured');
  }

  const rows = await supabaseSelect('app_settings', {
    select: 'key',
    filter: { key: 'key', value: 'like.calcpro:%' },
    limit: 5000,
  });
  const keys = collectMatchingKeys(rows);
  const groupKeys = getGroupScopedKeys(normalizedGroupId);
  const matchedGroupKeys = keys.filter((key) => groupKeys.includes(key));
  const viewerBucketKeys = keys.filter((key) => key.startsWith('calcpro:communities:viewer:'));
  const affectedViewerIds = [];

  for (const key of groupKeys) {
    await supabaseDelete('app_settings', {
      key: 'key',
      value: `eq.${key}`,
    });
  }

  for (const viewerId of extractViewerIds(viewerBucketKeys)) {
    const communities = await getViewerCommunities(viewerId);
    if (!communities.some((community) => community.groupId === normalizedGroupId)) {
      continue;
    }

    affectedViewerIds.push(viewerId);
    await saveViewerCommunities(
      viewerId,
      communities.filter((community) => community.groupId !== normalizedGroupId),
    );
  }

  return {
    ok: true,
    groupId: normalizedGroupId,
    matchedKeys: matchedGroupKeys.length,
    clearedViewerBuckets: affectedViewerIds.length,
    affectedViewerIds,
  };
}

export async function resetAllGroupsData() {
  if (!hasSupabaseCredentials()) {
    throw new Error('SUPABASE credentials are not configured');
  }

  const rows = await supabaseSelect('app_settings', {
    select: 'key',
    filter: { key: 'key', value: 'like.calcpro:%' },
    limit: 5000,
  });
  const keys = collectMatchingKeys(rows);

  const deletedByPrefix = {};
  for (const prefix of RESET_PREFIXES) {
    const deletedRows = await supabaseDelete('app_settings', {
      key: 'key',
      value: `like.${prefix}%`,
    });
    deletedByPrefix[prefix] = Array.isArray(deletedRows) ? deletedRows.length : 0;
  }

  return {
    ok: true,
    matchedKeys: keys.length,
    clearedGroupIds: extractGroupIds(keys),
    clearedViewerBuckets: keys.filter((key) => key.startsWith('calcpro:communities:viewer:')).length,
    deletedByPrefix,
  };
}
