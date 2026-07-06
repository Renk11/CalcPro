import { linkServerBillingReminderRecipient } from '../server/settings-store.js';
import { updateServerSupportTicketStatus } from '../server/support-store.js';
import { sendVkMessage, sendVkMessageEventAnswer } from '../server/vk.js';

const STATUS_LABELS = {
  pending: 'На рассмотрении',
  reviewed: 'Рассмотрено',
  rejected: 'Отклонено',
};

function sendPlainText(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(payload);
}

function isAllowedSecret(secret) {
  const expectedSecret = String(process.env.VK_CALLBACK_SECRET || '').trim();
  if (!expectedSecret) {
    return true;
  }

  return secret === expectedSecret;
}

function getConfirmationToken() {
  return String(process.env.VK_CALLBACK_CONFIRMATION_TOKEN || '').trim();
}

function normalizeStatus(status) {
  return status === 'reviewed' || status === 'rejected' || status === 'pending'
    ? status
    : 'pending';
}

function parseReminderGroupId(text) {
  const match = String(text || '').match(
    /(?:calcpro[\s:,-]*)?(?:уведомления|напоминания|notify)(?:\s+по\s+тарифу)?[\s:#-]*([1-9]\d{3,15})/iu,
  );
  return match ? Number(match[1]) : 0;
}

function normalizeVkUserId(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

export default async function handler(request, response) {
  try {
    const body = request.body || {};

    if (request.method !== 'POST') {
      return sendPlainText(response, 405, 'method_not_allowed');
    }

    if (!isAllowedSecret(String(body.secret || '').trim())) {
      return sendPlainText(response, 403, 'forbidden');
    }

    if (body.type === 'confirmation') {
      return sendPlainText(response, 200, getConfirmationToken());
    }

    if (body.type === 'message_event') {
      const payload = body.object?.payload || {};

      if (payload.command === 'support_status') {
        const ticketId = String(payload.ticketId || '').trim();
        const groupId = Number(payload.groupId) || 0;
        const status = normalizeStatus(payload.status);

        if (ticketId) {
          await updateServerSupportTicketStatus(ticketId, status, groupId);
        }

        await sendVkMessageEventAnswer(
          body.object?.event_id,
          body.object?.user_id,
          body.object?.peer_id,
          {
            type: 'show_snackbar',
            text: `Статус обновлён: ${STATUS_LABELS[status]}`,
          },
        ).catch(() => undefined);
      }
    }

    if (body.type === 'message_new') {
      const message = body.object?.message || {};
      const userId = normalizeVkUserId(message.from_id || message.peer_id);
      const groupId = parseReminderGroupId(message.text);

      if (userId > 0 && groupId > 0) {
        await linkServerBillingReminderRecipient(groupId, userId);
        await sendVkMessage(
          userId,
          [
            'Напоминания о продлении тарифа CalcPro подключены.',
            `Сообщество ID: ${groupId}.`,
            'Теперь мы сможем заранее написать вам в ЛС перед окончанием оплаченного периода.',
          ].join('\n'),
        ).catch(() => undefined);
      }
    }

    return sendPlainText(response, 200, 'ok');
  } catch (error) {
    console.error('vk callback api error', error);
    return sendPlainText(response, 200, 'ok');
  }
}
