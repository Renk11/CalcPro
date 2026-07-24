import { sendJson } from '../server/http.js';
import { requireCommunityAdmin } from '../server/request-auth.js';
import {
  addServerSupportTicket,
  getServerSupportTickets,
  updateServerSupportTicketComment,
  updateServerSupportTicketStatus,
} from '../server/support-store.js';
import { getVkUserInfo, hasVkGroupToken, sendVkMessageWithOptions } from '../server/vk.js';

const SUPPORT_RECIPIENT_ID = '139346496';
const SUPPORT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const SUPPORT_RATE_LIMIT_MAX_TICKETS = 3;

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

function normalizeSupportStatus(status) {
  return status === 'reviewed' || status === 'rejected' || status === 'pending'
    ? status
    : 'pending';
}

function isSupportOperator(auth) {
  return Number.isInteger(auth?.viewerId) && String(auth.viewerId) === SUPPORT_RECIPIENT_ID;
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

function getRateLimitAuthorId(auth, trustedAuthor) {
  if (Number.isInteger(trustedAuthor?.authorVkId) && trustedAuthor.authorVkId > 0) {
    return trustedAuthor.authorVkId;
  }

  return Number.isInteger(auth?.viewerId) && auth.viewerId > 0 ? auth.viewerId : 0;
}

function getRecentSupportTicketCount(tickets, authorVkId) {
  if (!Number.isInteger(authorVkId) || authorVkId <= 0) {
    return 0;
  }

  const windowStart = Date.now() - SUPPORT_RATE_LIMIT_WINDOW_MS;

  return tickets.filter((ticket) => {
    const createdAt = Date.parse(String(ticket?.createdAt || ''));
    return (
      Number.isFinite(createdAt) &&
      createdAt >= windowStart &&
      Number(ticket?.authorVkId) === authorVkId
    );
  }).length;
}

async function resolveTrustedAuthor(auth) {
  const fallbackLabel =
    Number.isInteger(auth?.viewerId) && auth.viewerId > 0
      ? `Администратор VK ID ${auth.viewerId}`
      : 'Неизвестный администратор';

  if (!hasVkGroupToken() || !Number.isInteger(auth?.viewerId) || auth.viewerId <= 0) {
    return {
      authorLabel: fallbackLabel,
      authorVkId: Number.isInteger(auth?.viewerId) && auth.viewerId > 0 ? auth.viewerId : undefined,
    };
  }

  try {
    const profile = await getVkUserInfo(auth.viewerId);
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();

    return {
      authorLabel: fullName || fallbackLabel,
      authorVkId: profile.id,
    };
  } catch {
    return {
      authorLabel: fallbackLabel,
      authorVkId: auth.viewerId,
    };
  }
}

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);
    const auth = requireCommunityAdmin(request, response, groupId);
    if (!auth) {
      return undefined;
    }

    if (request.method === 'GET') {
      const tickets = await getServerSupportTickets(groupId);
      return sendJson(response, 200, { ok: true, data: tickets });
    }

    if (request.method !== 'POST') {
      return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
    }

    const action = String(request.query?.action || request.body?.action || '').toLowerCase();

    if (action === 'status') {
      if (!isSupportOperator(auth)) {
        return sendJson(response, 403, {
          ok: false,
          error: 'Only the support operator can update ticket status',
        });
      }

      const ticketId = String(request.body?.ticketId || '').trim();
      const status = normalizeSupportStatus(request.body?.status);

      if (!ticketId) {
        return sendJson(response, 400, { ok: false, error: 'ticketId is required' });
      }

      const tickets = await updateServerSupportTicketStatus(ticketId, status, groupId);
      return sendJson(response, 200, { ok: true, data: tickets });
    }

    if (action === 'comment') {
      if (!isSupportOperator(auth)) {
        return sendJson(response, 403, {
          ok: false,
          error: 'Only the support operator can update the support comment',
        });
      }

      const ticketId = String(request.body?.ticketId || '').trim();
      const managerComment = String(request.body?.managerComment || '');

      if (!ticketId) {
        return sendJson(response, 400, { ok: false, error: 'ticketId is required' });
      }

      const tickets = await updateServerSupportTicketComment(ticketId, managerComment, groupId);
      return sendJson(response, 200, { ok: true, data: tickets });
    }

    const trustedAuthor = await resolveTrustedAuthor(auth);
    const existingTickets = await getServerSupportTickets(groupId);
    const rateLimitAuthorId = getRateLimitAuthorId(auth, trustedAuthor);
    const recentTicketCount = getRecentSupportTicketCount(existingTickets, rateLimitAuthorId);

    if (recentTicketCount >= SUPPORT_RATE_LIMIT_MAX_TICKETS) {
      return sendJson(response, 429, {
        ok: false,
        error: `Слишком много обращений. Можно отправить не более ${SUPPORT_RATE_LIMIT_MAX_TICKETS} сообщений в минуту.`,
      });
    }

    const createdAt = new Date().toISOString();
    const ticket = {
      type: request.body?.type,
      subject: request.body?.subject,
      message: request.body?.message,
      status: 'pending',
      managerComment: '',
      createdAt,
      authorLabel: trustedAuthor.authorLabel,
      authorVkId: trustedAuthor.authorVkId,
    };
    const tickets = await addServerSupportTicket(ticket, groupId);
    const persistedTicket = Array.isArray(tickets) && tickets.length > 0 ? tickets[0] : ticket;

    if (!hasVkGroupToken()) {
      return sendJson(response, 200, {
        ok: true,
        message: 'Обращение сохранено. Для отправки в VK нужен VK_GROUP_TOKEN.',
        data: tickets,
      });
    }

    await sendVkMessageWithOptions(SUPPORT_RECIPIENT_ID, buildMessage(persistedTicket, groupId), {
      keyboard: buildStatusKeyboard(persistedTicket.id, groupId),
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
