import { sendRequestsToGoogleSheets } from './google-sheets.js';

function formatRequestValue(value) {
  if (Array.isArray(value)) {
    return (
      value
        .map((item) =>
          typeof item === 'object' && item !== null && 'name' in item ? String(item.name) : String(item),
        )
        .join(', ') || '-'
    );
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

function mapRequestDetails(request = {}) {
  if (Array.isArray(request.details) && request.details.length > 0) {
    return request.details.map((item) => ({
      key: String(item.key || item.label || ''),
      label: String(item.label || item.key || ''),
      value: String(item.value || ''),
    }));
  }

  return Object.entries(request.values || {}).map(([key, value]) => ({
    key,
    label: key,
    value: formatRequestValue(value),
  }));
}

function buildIntegrationPayload(request = {}, groupId = 0) {
  return {
    event: 'calcpro.request.created',
    groupId,
    request: {
      id: String(request.id || ''),
      templateId: String(request.templateId || ''),
      templateTitle: String(request.templateTitle || 'Калькулятор'),
      status: String(request.status || 'new'),
      name: String(request.name || ''),
      phone: String(request.phone || ''),
      comment: String(request.comment || ''),
      amount: Number(request.amount) || 0,
      createdAt: String(request.createdAt || new Date().toISOString()),
      updatedAt: String(request.updatedAt || request.createdAt || new Date().toISOString()),
      assignedTo: String(request.assignedTo || ''),
      details: mapRequestDetails(request),
      values: request.values && typeof request.values === 'object' ? request.values : {},
    },
  };
}

function buildTelegramMessage(request) {
  const details = mapRequestDetails(request)
    .map((item) => `• ${item.label}: ${item.value}`)
    .join('\n');

  return [
    'Новая заявка CalcPro',
    `Калькулятор: ${request.templateTitle || 'Калькулятор'}`,
    `Имя: ${request.name || '-'}`,
    `Телефон: ${request.phone || '-'}`,
    `Комментарий: ${request.comment || 'Без комментария'}`,
    `Сумма: ${Number(request.amount) || 0} ₽`,
    details ? `\nДетали:\n${details}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function sendTelegramNotification(request, telegramSettings) {
  const botToken = String(telegramSettings?.botToken || '').trim();
  const chatId = String(telegramSettings?.chatId || '').trim();

  if (!telegramSettings?.enabled || !botToken || !chatId) {
    return { skipped: true };
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: buildTelegramMessage(request),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(responseText || `Telegram request failed with status ${response.status}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

async function sendBitrix24Lead(request, groupId, bitrixSettings) {
  const webhookUrl = String(bitrixSettings?.webhookUrl || '').trim();
  if (!bitrixSettings?.enabled || !webhookUrl) {
    return { skipped: true };
  }

  const details = mapRequestDetails(request);
  const comments = [
    `Группа VK: ${groupId}`,
    `Калькулятор: ${request.templateTitle || 'Калькулятор'}`,
    request.comment ? `Комментарий клиента: ${request.comment}` : '',
    details.length
      ? `Детали:\n${details.map((item) => `- ${item.label}: ${item.value}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const normalizedUrl = webhookUrl.endsWith('/')
    ? `${webhookUrl}crm.lead.add.json`
    : webhookUrl.endsWith('.json')
      ? webhookUrl
      : `${webhookUrl}/crm.lead.add.json`;

  const response = await fetch(normalizedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        TITLE: `Заявка CalcPro: ${request.templateTitle || 'Калькулятор'}`,
        NAME: String(request.name || ''),
        PHONE: [{ VALUE: String(request.phone || ''), VALUE_TYPE: 'WORK' }],
        COMMENTS: comments,
        OPPORTUNITY: Number(request.amount) || 0,
        ASSIGNED_BY_ID: bitrixSettings.assignedById ? Number(bitrixSettings.assignedById) || undefined : undefined,
        SOURCE_ID: String(bitrixSettings.sourceId || '').trim() || undefined,
      },
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(responseText || `Bitrix24 request failed with status ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  if (payload && 'error' in payload && payload.error) {
    throw new Error(String(payload.error_description || payload.error));
  }

  return payload;
}

async function sendAmoCrmLead(request, groupId, amoCrmSettings) {
  const subdomain = String(amoCrmSettings?.subdomain || '').trim();
  const accessToken = String(amoCrmSettings?.accessToken || '').trim();

  if (!amoCrmSettings?.enabled || !subdomain || !accessToken) {
    return { skipped: true };
  }

  const details = mapRequestDetails(request);
  const note = [
    `Группа VK: ${groupId}`,
    request.comment ? `Комментарий: ${request.comment}` : '',
    details.length
      ? `Детали:\n${details.map((item) => `${item.label}: ${item.value}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await fetch(`https://${subdomain}.amocrm.ru/api/v4/leads/complex`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify([
      {
        name: `Заявка CalcPro: ${request.templateTitle || 'Калькулятор'}`,
        price: Number(request.amount) || 0,
        pipeline_id: amoCrmSettings.pipelineId ? Number(amoCrmSettings.pipelineId) || undefined : undefined,
        status_id: amoCrmSettings.statusId ? Number(amoCrmSettings.statusId) || undefined : undefined,
        responsible_user_id: amoCrmSettings.responsibleUserId
          ? Number(amoCrmSettings.responsibleUserId) || undefined
          : undefined,
        _embedded: {
          contacts: [
            {
              name: String(request.name || 'Клиент'),
              custom_fields_values: [
                {
                  field_code: 'PHONE',
                  values: [{ value: String(request.phone || '') }],
                },
              ],
            },
          ],
        },
        metadata: {
          calcpro_request_id: String(request.id || ''),
          group_id: groupId,
        },
        custom_fields_values: note
          ? [
              {
                field_name: 'Комментарий CalcPro',
                values: [{ value: note }],
              },
            ]
          : undefined,
      },
    ]),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(responseText || `amoCRM request failed with status ${response.status}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

async function sendGenericWebhook(request, groupId, webhookSettings) {
  const url = String(webhookSettings?.url || '').trim();
  if (!webhookSettings?.enabled || !url) {
    return { skipped: true };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildIntegrationPayload(request, groupId)),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(responseText || `Webhook request failed with status ${response.status}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

export async function exportRequestsToGoogleSheets(settings, groupId, requests, mode = 'append') {
  const webhookUrl = String(
    settings?.integrations?.googleSheets?.webhookUrl || settings?.googleSheetsWebhookUrl || '',
  ).trim();

  if (!webhookUrl) {
    throw new Error('Google Sheets webhook URL is not configured');
  }

  return sendRequestsToGoogleSheets({
    webhookUrl,
    groupId,
    mode,
    requests,
  });
}

export async function dispatchRequestIntegrations(settings, request, groupId) {
  const integrations = settings?.integrations || {};
  const results = await Promise.allSettled([
    sendTelegramNotification(request, integrations.telegram),
    integrations.googleSheets?.enabled || settings?.googleSheetsWebhookUrl
      ? exportRequestsToGoogleSheets(settings, groupId, [request], 'append')
      : Promise.resolve({ skipped: true }),
    sendAmoCrmLead(request, groupId, integrations.amoCrm),
    sendBitrix24Lead(request, groupId, integrations.bitrix24),
    sendGenericWebhook(request, groupId, integrations.webhook),
  ]);

  return {
    telegram: results[0],
    googleSheets: results[1],
    amoCrm: results[2],
    bitrix24: results[3],
    webhook: results[4],
  };
}
