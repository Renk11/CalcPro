import { sendJson } from '../server/http.js';
import {
  addServerSupportTicket,
  getServerSupportTickets,
  updateServerSupportTicketStatus,
} from '../server/support-store.js';
import { hasVkGroupToken, sendVkMessageWithOptions } from '../server/vk.js';

const SUPPORT_RECIPIENT_ID = '139346496';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function normalizeSupportStatus(status) {
  return status === 'reviewed' || status === 'rejected' || status === 'pending'
    ? status
    : 'pending';
}

function formatSupportType(type) {
  if (type === 'bug') {
    return 'Баг';
  }

  if (type === 'suggestion') {
    return 'Предложение';
  }

  return 'Сообщение';
}

function buildStatusKeyboard(ticketId, groupId) {
  return {
    inline: true,
    buttons: [
      [
        {
          action: {
            type: 'callback',
            label: 'На рассмотрении',
            payload: {
              command: 'support_status',
              ticketId,
              groupId,
              status: 'pending',
            },
          },
          color: 'secondary',
        },
      ],
      [
        {
          action: {
            type: 'callback',
            label: 'Рассмотрено',
            payload: {
              command: 'support_status',
              ticketId,
              groupId,
              status: 'reviewed',
            },
          },
          color: 'positive',
        },
        {
          action: {
            type: 'callback',
            label: 'Отклонено',
            payload: {
              command: 'support_status',
              ticketId,
              groupId,
              status: 'rejected',
            },
          },
          color: 'negative',
        },
      ],
    ],
  };
}

function buildMessage(ticket, groupId) {
  const authorVkId = Number(ticket?.authorVkId);
  const authorLink =
    Number.isInteger(authorVkId) && authorVkId > 0 ? `https://vk.com/id${authorVkId}` : 'не указана';

  return [
    '🛟 Новое обращение в саппорт',
    `#${ticket?.id || '-'}`,
    `📌 Тип: ${formatSupportType(ticket?.type)}`,
    `📝 Тема: ${ticket?.subject || '-'}`,
    `💬 Сообщение: ${ticket?.message || '-'}`,
    `👤 Отправитель: ${ticket?.authorLabel || 'Неизвестный администратор'}`,
    `🔗 Профиль: ${authorLink}`,
    `🏘️ Группа VK: ${groupId > 0 ? groupId : 'не указана'}`,
    `🕒 Создано: ${ticket?.createdAt || new Date().toISOString()}`,
  ].join('\n');
}

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);

    if (request.method === 'GET') {
      const tickets = await getServerSupportTickets(groupId);
      return sendJson(response, 200, { ok: true, data: tickets });
    }

    if (request.method !== 'POST') {
      return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    }

    const action = String(request.query?.action || request.body?.action || '').toLowerCase();

    if (action === 'status') {
      const ticketId = String(request.body?.ticketId || '').trim();
      const status = normalizeSupportStatus(request.body?.status);

      if (!ticketId) {
        return sendJson(response, 400, { ok: false, error: 'ticketId is required' });
      }

      const tickets = await updateServerSupportTicketStatus(ticketId, status, groupId);
      return sendJson(response, 200, { ok: true, data: tickets });
    }

    const ticket = {
      ...(request.body || {}),
      status: normalizeSupportStatus(request.body?.status),
    };
    const tickets = await addServerSupportTicket(ticket, groupId);

    if (!hasVkGroupToken()) {
      return sendJson(response, 200, {
        ok: true,
        message: 'Обращение сохранено. Для отправки в VK нужен VK_GROUP_TOKEN.',
        data: tickets,
      });
    }

    await sendVkMessageWithOptions(SUPPORT_RECIPIENT_ID, buildMessage(ticket, groupId), {
      keyboard: buildStatusKeyboard(ticket.id, groupId),
    });

    return sendJson(response, 200, {
      ok: true,
      message: 'Обращение отправлено в саппорт.',
      data: tickets,
    });
  } catch (error) {
    console.error('support api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Failed to send support message',
    });
  }
}
