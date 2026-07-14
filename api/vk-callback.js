import {
  getServerAdminSettings,
  linkServerBillingReminderRecipient,
  linkServerManagerRecipient,
  updateServerBroadcastSubscription,
  updateServerBroadcastSubscriptionForUser,
} from '../server/settings-store.js';
import { updateServerSupportTicketStatus } from '../server/support-store.js';
import { sendVkMessage, sendVkMessageEventAnswer, sendVkMessageWithOptions } from '../server/vk.js';

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
    return false;
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

function parseManagerLinkRequest(text) {
  const match = String(text || '')
    .trim()
    .match(
      /(?:calcpro[\s:,-]*)?(?:менеджер|manager)(?:\s+для\s+заявок)?[\s:#-]*([1-9]\d{3,15})(?:[\s,#-]+([1-9]\d{3,15}))?/iu,
    );

  return {
    groupId: match ? Number(match[1]) : 0,
    managerVkId: match ? Number(match[2]) || 0 : 0,
  };
}

function normalizeVkUserId(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function parseBroadcastUnsubscribeGroupId(text) {
  const normalizedText = String(text || '').trim().toLowerCase();
  const match = normalizedText.match(
    /(?:calcpro[\s:,-]*)?(?:отписаться|стоп)(?:\s+от\s+обновлений)?[\s:#-]*([1-9]\d{3,15})/iu,
  );

  return match ? Number(match[1]) : 0;
}

function hasBroadcastUnsubscribeIntent(text) {
  return /(?:отписать(?:ся)?|стоп)(?:\s+от)?\s+рассыл/i.test(String(text || '').trim());
}

function hasBroadcastSubscribeIntent(text) {
  return /(?:подписать(?:ся)?|включить|вернуть)(?:\s+на)?\s+рассыл/i.test(
    String(text || '').trim(),
  );
}

function parseMessagePayload(rawPayload) {
  if (!rawPayload) {
    return null;
  }

  if (typeof rawPayload === 'object') {
    return rawPayload;
  }

  try {
    return JSON.parse(String(rawPayload));
  } catch {
    return null;
  }
}

function buildBroadcastResubscribeKeyboard() {
  return {
    one_time: false,
    buttons: [
      [
        {
          action: {
            type: 'text',
            label: 'Подписаться на рассылку',
            payload: {
              command: 'subscribe_updates',
            },
          },
          color: 'positive',
        },
      ],
    ],
  };
}

function buildBroadcastSubscribedKeyboard() {
  return {
    one_time: false,
    buttons: [
      [
        {
          action: {
            type: 'text',
            label: 'Отписаться от рассылки',
            payload: {
              command: 'unsubscribe_updates',
            },
          },
          color: 'negative',
        },
      ],
    ],
  };
}

async function sendBroadcastUnsubscribeConfirmation(userId) {
  await sendVkMessageWithOptions(
    userId,
    'Вы успешно отписались от рассылки обновлений CalcPro. Если захотите снова получать новости об обновлениях, нажмите кнопку ниже.',
    {
      keyboard: buildBroadcastResubscribeKeyboard(),
    },
  ).catch(() => undefined);
}

async function sendBroadcastSubscribeConfirmation(userId) {
  await sendVkMessageWithOptions(
    userId,
    'Вы снова подписаны на рассылку обновлений CalcPro. Будем присылать только важные новости и обновления.',
    {
      keyboard: buildBroadcastSubscribedKeyboard(),
    },
  ).catch(() => undefined);
}

async function unsubscribeUserFromBroadcasts(userId, fallbackGroupId = 0) {
  await updateServerBroadcastSubscriptionForUser(userId, false).catch(() =>
    fallbackGroupId > 0
      ? updateServerBroadcastSubscription(fallbackGroupId, userId, false).catch(() => undefined)
      : undefined,
  );
}

export default async function handler(request, response) {
  try {
    const body = request.body || {};

    if (request.method !== 'POST') {
      return sendPlainText(response, 405, 'method_not_allowed');
    }

    if (!String(process.env.VK_CALLBACK_SECRET || '').trim()) {
      return sendPlainText(response, 503, 'callback_secret_not_configured');
    }

    if (!isAllowedSecret(String(body.secret || '').trim())) {
      return sendPlainText(response, 403, 'forbidden');
    }

    if (body.type === 'confirmation') {
      const confirmationToken = getConfirmationToken();
      if (!confirmationToken) {
        return sendPlainText(response, 503, 'confirmation_token_not_configured');
      }

      return sendPlainText(response, 200, confirmationToken);
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

      if (payload.command === 'unsubscribe_updates') {
        const targetGroupId = Number(payload.groupId) || 0;
        const targetUserId = normalizeVkUserId(body.object?.user_id);

        if (targetUserId > 0) {
          await unsubscribeUserFromBroadcasts(targetUserId, targetGroupId);
          await sendBroadcastUnsubscribeConfirmation(targetUserId);
        }

        await sendVkMessageEventAnswer(
          body.object?.event_id,
          body.object?.user_id,
          body.object?.peer_id,
          {
            type: 'show_snackbar',
            text: 'Вы отписались от рассылки',
          },
        ).catch(() => undefined);
      }

      if (payload.command === 'subscribe_updates') {
        const targetUserId = normalizeVkUserId(body.object?.user_id);

        if (targetUserId > 0) {
          await updateServerBroadcastSubscriptionForUser(targetUserId, true).catch(() => undefined);
          await sendBroadcastSubscribeConfirmation(targetUserId);
        }

        await sendVkMessageEventAnswer(
          body.object?.event_id,
          body.object?.user_id,
          body.object?.peer_id,
          {
            type: 'show_snackbar',
            text: 'Вы снова подписаны на рассылку',
          },
        ).catch(() => undefined);
      }
    }

    if (body.type === 'message_new') {
      const message = body.object?.message || {};
      const userId = normalizeVkUserId(message.from_id || message.peer_id);
      const groupId = parseReminderGroupId(message.text);
      const managerLinkRequest = parseManagerLinkRequest(message.text);
      const unsubscribeGroupIdFromText = parseBroadcastUnsubscribeGroupId(message.text);
      const hasUnsubscribeIntent = hasBroadcastUnsubscribeIntent(message.text);
      const hasSubscribeIntent = hasBroadcastSubscribeIntent(message.text);
      const messagePayload = parseMessagePayload(message.payload);
      const isUnsubscribePayload = messagePayload?.command === 'unsubscribe_updates';
      const isSubscribePayload = messagePayload?.command === 'subscribe_updates';

      if ((unsubscribeGroupIdFromText > 0 || hasUnsubscribeIntent) && !isUnsubscribePayload && userId > 0) {
        await unsubscribeUserFromBroadcasts(userId, unsubscribeGroupIdFromText);
        await sendBroadcastUnsubscribeConfirmation(userId);
      }

      if (isUnsubscribePayload && userId > 0) {
        const targetGroupId = Number(messagePayload.groupId) || 0;

        await unsubscribeUserFromBroadcasts(userId, targetGroupId);
        await sendBroadcastUnsubscribeConfirmation(userId);
      }

      if ((isSubscribePayload || hasSubscribeIntent) && userId > 0) {
        await updateServerBroadcastSubscriptionForUser(userId, true).catch(() => undefined);
        await sendBroadcastSubscribeConfirmation(userId);
      }

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

      if (userId > 0 && managerLinkRequest.groupId > 0) {
        const settings = await getServerAdminSettings(managerLinkRequest.groupId);
        const configuredManagerId = normalizeVkUserId(
          managerLinkRequest.managerVkId || settings.managerVkId,
        );

        if (!configuredManagerId) {
          await sendVkMessage(
            userId,
            [
              'Привязка менеджера не выполнена.',
              `Сообщество ID: ${managerLinkRequest.groupId}.`,
              'Сначала укажите VK ID менеджера в настройках CalcPro.',
            ].join('\n'),
          ).catch(() => undefined);
        } else if (configuredManagerId !== userId) {
          await sendVkMessage(
            userId,
            [
              'Привязка менеджера отклонена.',
              `Сообщество ID: ${managerLinkRequest.groupId}.`,
              `В настройках ожидается VK ID ${configuredManagerId}.`,
            ].join('\n'),
          ).catch(() => undefined);
        } else {
          await linkServerManagerRecipient(managerLinkRequest.groupId, userId);
          await sendVkMessage(
            userId,
            [
              'Менеджер для заявок CalcPro подключён.',
              `Сообщество ID: ${managerLinkRequest.groupId}.`,
              'Теперь мы сможем отправлять вам новые заявки из калькуляторов.',
            ].join('\n'),
          ).catch(() => undefined);
        }
      }
    }

    return sendPlainText(response, 200, 'ok');
  } catch (error) {
    console.error('vk callback api error', error);
    return sendPlainText(response, 200, 'ok');
  }
}
