const VK_API_URL = 'https://api.vk.com/method';
const VK_API_VERSION = '5.199';

function getVkGroupToken() {
  return process.env.VK_GROUP_TOKEN || '';
}

function normalizeCommunityIdentifier(rawValue) {
  const normalized = String(rawValue || '').trim();
  if (!normalized) {
    return '';
  }

  const withoutProtocol = normalized.replace(/^https?:\/\/(?:m\.)?/i, '');
  const pathCandidate = withoutProtocol.replace(/^vk\.com\//i, '').split(/[/?#]/)[0] || normalized;
  const withoutAt = pathCandidate.replace(/^@/, '').trim();
  const numericMatch = withoutAt.match(/^(?:club|public|event)([1-9]\d*)$/i);

  if (numericMatch) {
    return numericMatch[1];
  }

  return withoutAt;
}

export async function getVkUserInfo(userId) {
  const normalizedUserId = Number(userId);

  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error('Valid userId is required');
  }

  const response = await requestVk('users.get', {
    user_ids: normalizedUserId,
    fields: 'photo_100,photo_200,screen_name',
  });
  const user = Array.isArray(response) ? response[0] : response?.[0] || response;

  if (!user) {
    throw new Error('VK user not found');
  }

  return {
    id: normalizedUserId,
    firstName: String(user.first_name || ''),
    lastName: String(user.last_name || ''),
    screenName: String(user.screen_name || ''),
    photoUrl: String(user.photo_200 || user.photo_100 || ''),
  };
}

export function hasVkGroupToken() {
  return Boolean(getVkGroupToken());
}

async function requestVk(method, params = {}) {
  const token = getVkGroupToken();
  if (!token) {
    throw new Error('VK_GROUP_TOKEN is not configured');
  }

  const body = new URLSearchParams({
    access_token: token,
    v: VK_API_VERSION,
    ...Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? ''),
      ]),
    ),
  });

  const response = await fetch(`${VK_API_URL}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error('VK API request failed');
  }

  if (payload?.error) {
    throw new Error(payload.error.error_msg || 'VK API returned an error');
  }

  return payload?.response;
}

export async function sendVkMessage(userId, message) {
  return requestVk('messages.send', {
    user_id: userId,
    random_id: Math.floor(Math.random() * 2147483647),
    message,
  });
}

function extractKeyboardTextHints(keyboard) {
  const buttons = Array.isArray(keyboard?.buttons) ? keyboard.buttons : [];

  return buttons
    .flat()
    .map((button) => String(button?.action?.label || '').trim())
    .filter(Boolean);
}

export async function sendVkMessageWithOptions(userId, message, options = {}) {
  try {
    return await requestVk('messages.send', {
      user_id: userId,
      random_id: Math.floor(Math.random() * 2147483647),
      message,
      ...options,
    });
  } catch (error) {
    const errorMessage = String(error?.message || '');

    if (!options?.keyboard || !/chat bot feature/i.test(errorMessage)) {
      throw error;
    }

    const { keyboard, ...fallbackOptions } = options;
    const textHints = extractKeyboardTextHints(keyboard);
    const fallbackMessage = textHints.length
      ? `${message}\n\nДля отписки ответьте: ${textHints.join(' / ')}`
      : message;

    return requestVk('messages.send', {
      user_id: userId,
      random_id: Math.floor(Math.random() * 2147483647),
      message: fallbackMessage,
      ...fallbackOptions,
    });
  }
}

export async function sendVkMessageEventAnswer(eventId, userId, peerId, eventData) {
  return requestVk('messages.sendMessageEventAnswer', {
    event_id: eventId,
    user_id: userId,
    peer_id: peerId,
    event_data: eventData,
  });
}

export async function getVkCommunityInfo(groupId) {
  const normalizedGroupId = Number(groupId);

  if (!Number.isInteger(normalizedGroupId) || normalizedGroupId <= 0) {
    throw new Error('Valid groupId is required');
  }

  const response = await requestVk('groups.getById', {
    group_id: normalizedGroupId,
    fields: 'screen_name,photo_100,photo_200',
  });
  const group = Array.isArray(response) ? response[0] : response?.groups?.[0] || response;

  if (!group) {
    throw new Error('VK group not found');
  }

  return {
    groupId: normalizedGroupId,
    name: String(group.name || `Сообщество ${normalizedGroupId}`),
    screenName: String(group.screen_name || ''),
    photoUrl: String(group.photo_200 || group.photo_100 || ''),
  };
}

export async function resolveVkCommunityInfo(rawValue) {
  const identifier = normalizeCommunityIdentifier(rawValue);

  if (!identifier) {
    throw new Error('Community link or identifier is required');
  }

  if (/^[1-9]\d*$/.test(identifier)) {
    return getVkCommunityInfo(Number(identifier));
  }

  const response = await requestVk('groups.getById', {
    group_ids: identifier,
    fields: 'screen_name,photo_100,photo_200',
  });
  const group = Array.isArray(response) ? response[0] : response?.groups?.[0] || response;
  const resolvedGroupId = Number(group?.id || 0);

  if (!Number.isInteger(resolvedGroupId) || resolvedGroupId <= 0) {
    throw new Error('VK group not found');
  }

  return {
    groupId: resolvedGroupId,
    name: String(group.name || `Сообщество ${resolvedGroupId}`),
    screenName: String(group.screen_name || identifier),
    photoUrl: String(group.photo_200 || group.photo_100 || ''),
  };
}
