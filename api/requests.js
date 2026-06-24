import { sendJson } from '../server/http.js';
import { getServerAdminSettings } from '../server/settings-store.js';
import { hasVkGroupToken, sendVkMessage } from '../server/vk.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function parseManagerIds(rawValue) {
  return [...new Set(String(rawValue || '').split(/[,\s;]+/).map((item) => item.trim()).filter(Boolean))];
}

function formatRequestValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'object' && item !== null && 'name' in item ? String(item.name) : String(item),
      )
      .join(', ') || '-';
  }

  if (typeof value === 'boolean') {
    return value ? 'Да' : 'Нет';
  }

  if (value && typeof value === 'object') {
    if ('label' in value) {
      const label = String(value.label || '');
      const surcharge = Number('surcharge' in value ? value.surcharge : 0);
      return surcharge > 0 ? `${label} (+${surcharge} ₽)` : label || '-';
    }

    return JSON.stringify(value);
  }

  return String(value || '-');
}

function buildMessage(request) {
  const details = (Array.isArray(request?.details) && request.details.length > 0
    ? request.details.map((item) => `${item.label}: ${item.value}`)
    : Object.entries(request?.values || {}).map(([key, value]) => `${key}: ${formatRequestValue(value)}`))
    .map((item) => `• ${item}`)
    .join('\n');

  return [
    '🆕 Новая заявка',
    `🧮 Калькулятор: ${request?.templateTitle || 'Калькулятор'}`,
    `👤 Имя: ${request?.name || '-'}`,
    `📞 Телефон: ${request?.phone || '-'}`,
    `💬 Комментарий: ${request?.comment || 'Без комментария'}`,
    `💰 Сумма: ${Number(request?.amount) || 0} ₽`,
    details ? `\n📋 Детали:\n${details}` : '',
  ].join('\n');
}

export default async function handler(request, response) {
  try {
    if (request.method !== 'POST') {
      return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    }

    const groupId = parseGroupId(request.body?.groupId || request.query?.groupId);
    const settings = await getServerAdminSettings(groupId);
    const managerIds = parseManagerIds(settings.managerVkId);

    if (managerIds.length === 0) {
      return sendJson(response, 400, { ok: false, error: 'Manager VK ID is not configured' });
    }

    if (!hasVkGroupToken()) {
      return sendJson(response, 500, { ok: false, error: 'VK_GROUP_TOKEN is not configured' });
    }

    const message = buildMessage(request.body || {});
    const results = [];

    for (const managerId of managerIds) {
      const vkResponse = await sendVkMessage(managerId, message);
      results.push({ managerId, vkResponse });
    }

    return sendJson(response, 200, {
      ok: true,
      message: `Заявка отправлена ${managerIds.length} менеджер(ам).`,
      data: results,
    });
  } catch (error) {
    console.error('requests api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Failed to send request',
    });
  }
}
