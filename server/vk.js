const VK_API_URL = 'https://api.vk.com/method';
const VK_API_VERSION = '5.199';

function getVkGroupToken() {
  return process.env.VK_GROUP_TOKEN || '';
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

export async function sendVkMessageWithOptions(userId, message, options = {}) {
  return requestVk('messages.send', {
    user_id: userId,
    random_id: Math.floor(Math.random() * 2147483647),
    message,
    ...options,
  });
}

export async function sendVkMessageEventAnswer(eventId, userId, peerId, eventData) {
  return requestVk('messages.sendMessageEventAnswer', {
    event_id: eventId,
    user_id: userId,
    peer_id: peerId,
    event_data: eventData,
  });
}
