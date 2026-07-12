import { getServerAdminSettings } from './settings-store.js';
import { getSubscriptionPlanConfig } from './subscription-config.js';
import { supabaseSelect, supabaseUpsert } from './supabase.js';
import { getVkCommunityInfo, hasVkGroupToken } from './vk.js';

const COMMUNITIES_KEY_PREFIX = 'calcpro:communities:viewer:';

function normalizeViewerId(viewerId) {
  const trimmed = String(viewerId || '').trim();
  return trimmed ? trimmed : '';
}

function normalizeGroupId(groupId) {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? numericGroupId : 0;
}

function getCommunitiesKey(viewerId) {
  const normalizedViewerId = normalizeViewerId(viewerId);
  return normalizedViewerId ? `${COMMUNITIES_KEY_PREFIX}${normalizedViewerId}` : '';
}

function normalizeCommunityEntry(entry = {}) {
  const groupId = normalizeGroupId(entry.groupId);

  if (!groupId) {
    return null;
  }

  const timestamp = new Date().toISOString();

  return {
    groupId,
    name: String(entry.name || `Сообщество ${groupId}`),
    screenName: String(entry.screenName || ''),
    photoUrl: String(entry.photoUrl || ''),
    role: String(entry.role || ''),
    addedAt: String(entry.addedAt || timestamp),
    lastUsedAt: String(entry.lastUsedAt || entry.addedAt || timestamp),
  };
}

function isGenericCommunityName(name, groupId) {
  const normalizedName = String(name || '').trim().toLowerCase();
  return normalizedName === `сообщество ${groupId}`;
}

function isMaskedCommunityName(name) {
  const normalizedName = String(name || '').trim().toLowerCase();

  return (
    normalizedName === 'частное сообщество' ||
    normalizedName === 'private community' ||
    normalizedName === 'closed community'
  );
}

function pickCommunityName(groupId, ...candidates) {
  const normalizedCandidates = candidates
    .map((candidate) => String(candidate || '').trim())
    .filter(Boolean);

  const meaningfulName = normalizedCandidates.find(
    (candidate) => !isGenericCommunityName(candidate, groupId) && !isMaskedCommunityName(candidate),
  );

  if (meaningfulName) {
    return meaningfulName;
  }

  const fallbackName = normalizedCandidates.find((candidate) => !isMaskedCommunityName(candidate));
  return fallbackName || `Сообщество ${groupId}`;
}

function normalizeCommunitiesList(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(normalizeCommunityEntry)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt));
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

export async function getViewerCommunities(viewerId) {
  const key = getCommunitiesKey(viewerId);

  if (!key) {
    return [];
  }

  return normalizeCommunitiesList((await readSettingRow(key)) || []);
}

export async function listAllConnectedCommunities() {
  try {
    const rows = await supabaseSelect('app_settings', {
      select: 'key,value',
      filter: { key: 'key', value: `like.${COMMUNITIES_KEY_PREFIX}%` },
      limit: 5000,
    });

    const aggregated = new Map();

    rows.forEach((row) => {
      normalizeCommunitiesList(row?.value || []).forEach((community) => {
        const existing = aggregated.get(community.groupId);

        if (!existing) {
          aggregated.set(community.groupId, community);
          return;
        }

        const existingAddedAt = Date.parse(existing.addedAt || '');
        const nextAddedAt = Date.parse(community.addedAt || '');
        const existingLastUsedAt = Date.parse(existing.lastUsedAt || '');
        const nextLastUsedAt = Date.parse(community.lastUsedAt || '');

        aggregated.set(community.groupId, {
          ...existing,
          ...community,
          name: existing.name || community.name,
          screenName: existing.screenName || community.screenName,
          photoUrl: existing.photoUrl || community.photoUrl,
          role: existing.role || community.role,
          addedAt:
            Number.isFinite(existingAddedAt) &&
            Number.isFinite(nextAddedAt) &&
            existingAddedAt <= nextAddedAt
              ? existing.addedAt
              : community.addedAt,
          lastUsedAt:
            Number.isFinite(existingLastUsedAt) &&
            Number.isFinite(nextLastUsedAt) &&
            existingLastUsedAt >= nextLastUsedAt
              ? existing.lastUsedAt
              : community.lastUsedAt,
        });
      });
    });

    return [...aggregated.values()].sort(
      (left, right) => Date.parse(right.addedAt) - Date.parse(left.addedAt),
    );
  } catch (error) {
    if (String(error?.message || '').includes('schema cache')) {
      return [];
    }

    throw error;
  }
}

export async function saveViewerCommunities(viewerId, communities) {
  const key = getCommunitiesKey(viewerId);

  if (!key) {
    return [];
  }

  const normalized = normalizeCommunitiesList(communities);
  await writeSettingRow(key, normalized);
  return normalized;
}

export async function connectViewerCommunity(viewerId, community, workspacePlanId) {
  const normalizedViewerId = normalizeViewerId(viewerId);
  const baseCommunity = normalizeCommunityEntry(community);

  if (!normalizedViewerId) {
    throw new Error('viewerId is required');
  }

  if (!baseCommunity) {
    throw new Error('groupId is required');
  }

  const latestList = await getViewerCommunities(normalizedViewerId);
  const existingCommunity =
    latestList.find((item) => item.groupId === baseCommunity.groupId) || null;
  let normalizedCommunity = normalizeCommunityEntry({
    ...baseCommunity,
    name: pickCommunityName(baseCommunity.groupId, baseCommunity.name, existingCommunity?.name),
    screenName: baseCommunity.screenName || existingCommunity?.screenName || '',
    photoUrl: baseCommunity.photoUrl || existingCommunity?.photoUrl || '',
  });

  if (hasVkGroupToken()) {
    try {
      const vkCommunity = await getVkCommunityInfo(baseCommunity.groupId);
      normalizedCommunity = normalizeCommunityEntry({
        ...normalizedCommunity,
        name: pickCommunityName(
          baseCommunity.groupId,
          vkCommunity.name,
          normalizedCommunity?.name,
          existingCommunity?.name,
        ),
        screenName:
          vkCommunity.screenName || normalizedCommunity?.screenName || existingCommunity?.screenName,
        photoUrl: vkCommunity.photoUrl || normalizedCommunity?.photoUrl || existingCommunity?.photoUrl,
      });
    } catch {
      normalizedCommunity = normalizeCommunityEntry(normalizedCommunity);
    }
  }

  const groupSettings = await getServerAdminSettings(normalizedCommunity.groupId);
  const activePlan = workspacePlanId
    ? getSubscriptionPlanConfig(workspacePlanId)
    : getSubscriptionPlanConfig(groupSettings.subscription.plan);
  const communityLimit = activePlan.communityLimit;
  const existingIndex = latestList.findIndex(
    (item) => item.groupId === normalizedCommunity.groupId,
  );

  if (existingIndex === -1 && communityLimit != null && latestList.length >= communityLimit) {
    throw new Error(`Лимит подключённых сообществ для тарифа ${activePlan.name}: ${communityLimit}`);
  }

  const nextList = [...latestList];
  const merged = {
    ...normalizedCommunity,
    addedAt:
      existingIndex >= 0 ? nextList[existingIndex].addedAt : normalizedCommunity.addedAt,
    lastUsedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    nextList[existingIndex] = {
      ...nextList[existingIndex],
      ...merged,
    };
  } else {
    nextList.push(merged);
  }

  return saveViewerCommunities(normalizedViewerId, nextList);
}

export async function disconnectViewerCommunity(viewerId, groupId) {
  const normalizedViewerId = normalizeViewerId(viewerId);
  const normalizedGroupId = normalizeGroupId(groupId);

  if (!normalizedViewerId || !normalizedGroupId) {
    return [];
  }

  const currentList = await getViewerCommunities(normalizedViewerId);
  const nextList = currentList.filter((item) => item.groupId !== normalizedGroupId);
  return saveViewerCommunities(normalizedViewerId, nextList);
}

export async function touchViewerCommunity(viewerId, groupId) {
  const normalizedViewerId = normalizeViewerId(viewerId);
  const normalizedGroupId = normalizeGroupId(groupId);

  if (!normalizedViewerId || !normalizedGroupId) {
    return [];
  }

  const currentList = await getViewerCommunities(normalizedViewerId);
  const existingCommunity = currentList.find((item) => item.groupId === normalizedGroupId);

  if (!existingCommunity) {
    return currentList;
  }

  return saveViewerCommunities(
    normalizedViewerId,
    currentList.map((item) =>
      item.groupId === normalizedGroupId
        ? {
            ...item,
            lastUsedAt: new Date().toISOString(),
          }
        : item,
    ),
  );
}
