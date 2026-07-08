function stringifyRequestDetails(request = {}) {
  if (Array.isArray(request.details) && request.details.length > 0) {
    return request.details
      .map((item) => `${String(item?.label || item?.key || 'Поле')}: ${String(item?.value || '')}`)
      .join('\n');
  }

  return Object.entries(request.values || {})
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join('\n');
}

function mapRequestForSheets(request = {}, groupId = 0) {
  return {
    id: String(request.id || ''),
    groupId: Number(groupId) || 0,
    calculatorId: String(request.templateId || ''),
    calculator: String(request.templateTitle || ''),
    status: String(request.status || 'new'),
    name: String(request.name || ''),
    phone: String(request.phone || ''),
    comment: String(request.comment || ''),
    amount: Number(request.amount) || 0,
    assignedTo: String(request.assignedTo || ''),
    createdAt: String(request.createdAt || ''),
    updatedAt: String(request.updatedAt || request.createdAt || ''),
    historyCount: Array.isArray(request.history) ? request.history.length : 0,
    commentsCount: Array.isArray(request.internalComments) ? request.internalComments.length : 0,
    details: stringifyRequestDetails(request),
  };
}

export async function sendRequestsToGoogleSheets({
  webhookUrl,
  groupId,
  mode = 'append',
  requests = [],
}) {
  const normalizedWebhookUrl = String(webhookUrl || '').trim();
  if (!normalizedWebhookUrl) {
    throw new Error('Google Sheets webhook URL is not configured');
  }

  const payload = {
    source: 'calcpro',
    version: 1,
    mode: mode === 'replace' ? 'replace' : 'append',
    groupId: Number(groupId) || 0,
    exportedAt: new Date().toISOString(),
    requests: requests.map((request) => mapRequestForSheets(request, groupId)),
  };

  const response = await fetch(normalizedWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(responseText || `Google Sheets export failed with status ${response.status}`);
  }

  return {
    ok: true,
    status: response.status,
    body: responseText,
    exportedAt: payload.exportedAt,
    count: payload.requests.length,
  };
}
