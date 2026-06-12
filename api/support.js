import { sendJson } from '../server/http.js';
import { hasVkGroupToken, sendVkMessage } from '../server/vk.js';

const SUPPORT_RECIPIENT_ID = '139346496';

function formatSupportType(type) {
  if (type === 'bug') {
    return 'Баг';
  }

  if (type === 'suggestion') {
    return 'Предложение';
  }

  return 'Сообщение';
}

function buildMessage(ticket, groupId) {
  return [
    'Новое обращение в саппорт',
    `Тип: ${formatSupportType(ticket?.type)}`,
    `Тема: ${ticket?.subject || '-'}`,
    `Сообщение: ${ticket?.message || '-'}`,
    `Отправитель: ${ticket?.authorLabel || 'Неизвестный администратор'}`,
    `Группа VK: ${groupId > 0 ? groupId : 'не указана'}`,
    `Создано: ${ticket?.createdAt || new Date().toISOString()}`,
  ].join('\n');
}

export default async function handler(request, response) {
  try {
    if (request.method !== 'POST') {
      return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    }

    if (!hasVkGroupToken()) {
      return sendJson(response, 500, { ok: false, error: 'VK_GROUP_TOKEN is not configured' });
    }

    const groupId = Number(request.body?.groupId || request.query?.groupId || 0);
    const ticket = request.body || {};
    const message = buildMessage(ticket, Number.isInteger(groupId) ? groupId : 0);

    const vkResponse = await sendVkMessage(SUPPORT_RECIPIENT_ID, message);

    return sendJson(response, 200, {
      ok: true,
      message: 'Обращение отправлено в саппорт.',
      data: {
        recipientId: SUPPORT_RECIPIENT_ID,
        vkResponse,
      },
    });
  } catch (error) {
    console.error('support api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Failed to send support message',
    });
  }
}
