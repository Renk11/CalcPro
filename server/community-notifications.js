import {
  getVkCommunityInfo,
  getVkUserInfo,
  hasVkGroupToken,
  sendVkMessage,
} from './vk.js';

const DEFAULT_CONNECT_RECIPIENT_ID = '139346496';

function resolveConnectRecipientId() {
  return String(
    process.env.CALCPRO_CONNECT_RECIPIENT_ID ||
      process.env.VK_SUPPORT_RECIPIENT_ID ||
      process.env.SUPPORT_RECIPIENT_ID ||
      DEFAULT_CONNECT_RECIPIENT_ID,
  ).trim();
}

function normalizeGroupId(groupId) {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? numericGroupId : 0;
}

function normalizeViewerId(viewerId) {
  const numericViewerId = Number(viewerId);
  return Number.isInteger(numericViewerId) && numericViewerId > 0 ? numericViewerId : 0;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getGroupIdFromPathname(pathname) {
  const match = String(pathname || '').match(/\/app\d+_-([1-9]\d*)/i);
  return match ? Number(match[1]) : 0;
}

function buildCommunityLink(group) {
  if (group?.screenName) {
    return `https://vk.com/${group.screenName}`;
  }

  const groupId = normalizeGroupId(group?.groupId);
  return groupId > 0 ? `https://vk.com/club${groupId}` : '';
}

function formatCommunityBlock(group) {
  const groupId = normalizeGroupId(group?.groupId);
  const link = buildCommunityLink(group);

  if (groupId > 0) {
    return [
      `Сообщество: ${group?.name || `Сообщество ${groupId}`}`,
      `Ссылка: ${link || 'Ссылка не найдена'}`,
      `ID сообщества: ${groupId}`,
    ];
  }

  return [
    'Сообщество: ID не вернулся от VK',
    'Ссылка: Откройте приложение из добавленной группы, чтобы увидеть точное сообщество',
    'ID сообщества: не вернулся от VK',
    'VK mobile пока не передал ID выбранной группы.',
  ];
}

function formatViewerBlock(viewer) {
  const viewerId = normalizeViewerId(viewer?.id);
  const fullName = [viewer?.firstName, viewer?.lastName].filter(Boolean).join(' ').trim();

  return [
    `Администратор: ${fullName || 'Не удалось определить'}`,
    `VK ID: ${viewerId > 0 ? viewerId : 'не определён'}`,
    `Профиль: ${viewerId > 0 ? `https://vk.com/id${viewerId}` : 'не определён'}`,
  ];
}

function formatPlatform(platform) {
  const normalized = String(platform || '').trim();
  return normalized || 'не определена';
}

function formatTimestamp(date = new Date()) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Europe/Moscow',
  }).format(date);
}

function buildConnectMessage(title, group, viewer, platform) {
  return [
    title,
    '',
    ...formatCommunityBlock(group),
    '',
    ...formatViewerBlock(viewer),
    '',
    `Платформа: ${formatPlatform(platform)}`,
    `Время: ${formatTimestamp()}`,
  ].join('\n');
}

async function resolveViewerInfo(viewerId) {
  const normalizedViewerId = normalizeViewerId(viewerId);
  if (!normalizedViewerId) {
    return null;
  }

  try {
    return await getVkUserInfo(normalizedViewerId);
  } catch {
    return {
      id: normalizedViewerId,
      firstName: '',
      lastName: '',
    };
  }
}

async function resolveGroupInfo(groupId, fallbackName = '', fallbackScreenName = '') {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) {
    return null;
  }

  try {
    return await getVkCommunityInfo(normalizedGroupId);
  } catch {
    return {
      groupId: normalizedGroupId,
      name: fallbackName || `Сообщество ${normalizedGroupId}`,
      screenName: fallbackScreenName || '',
      photoUrl: '',
    };
  }
}

export async function notifyConnectStarted({
  viewerId,
  groupId,
  fallbackGroupId,
  platform,
  pathname,
}) {
  if (!hasVkGroupToken()) {
    return false;
  }

  const recipientId = resolveConnectRecipientId();
  if (!recipientId) {
    return false;
  }

  const effectiveGroupId =
    normalizeGroupId(groupId) ||
    normalizeGroupId(fallbackGroupId) ||
    getGroupIdFromPathname(pathname);
  const [viewer, group] = await Promise.all([
    resolveViewerInfo(viewerId),
    resolveGroupInfo(effectiveGroupId),
  ]);

  const title = effectiveGroupId > 0 ? 'Начато подключение CalcPro' : 'Начато подключение CalcPro';
  await sendVkMessage(recipientId, buildConnectMessage(title, group, viewer, platform));
  return true;
}

export async function notifyCommunityConnected({
  viewerId,
  groupId,
  platform,
  communityName,
  communityScreenName,
}) {
  if (!hasVkGroupToken()) {
    return false;
  }

  const recipientId = resolveConnectRecipientId();
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!recipientId || !normalizedGroupId) {
    return false;
  }

  const [viewer, group] = await Promise.all([
    resolveViewerInfo(viewerId),
    resolveGroupInfo(normalizedGroupId, communityName, communityScreenName),
  ]);

  await sendVkMessage(
    recipientId,
    buildConnectMessage('Новое подключение CalcPro', group, viewer, platform),
  );
  return true;
}
