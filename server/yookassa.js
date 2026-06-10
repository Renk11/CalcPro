const YOOKASSA_API_URL = 'https://api.yookassa.ru/v3';

function resolveShopId() {
  return process.env.YOOKASSA_SHOP_ID || '1314377';
}

export function hasYooKassaCredentials() {
  return Boolean(resolveShopId() && process.env.YOOKASSA_SECRET_KEY);
}

function buildAuthHeader() {
  const token = Buffer.from(
    `${resolveShopId()}:${process.env.YOOKASSA_SECRET_KEY || ''}`,
  ).toString('base64');

  return `Basic ${token}`;
}

export async function requestYooKassa(path, { method = 'GET', body, idempotenceKey } = {}) {
  if (!hasYooKassaCredentials()) {
    throw new Error('YooKassa credentials are not configured');
  }

  const headers = {
    Authorization: buildAuthHeader(),
    'Content-Type': 'application/json',
  };

  if (idempotenceKey) {
    headers['Idempotence-Key'] = idempotenceKey;
  }

  const response = await fetch(`${YOOKASSA_API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.description ||
        payload?.message ||
        payload?.error_description ||
        'YooKassa request failed',
    );
  }

  return payload;
}

export function normalizeYooKassaPayment(payment) {
  const confirmationUrl =
    payment?.confirmation?.confirmation_url ||
    payment?.confirmation?.confirmationUrl ||
    payment?.payment_url ||
    '';

  return {
    id: String(payment?.id || ''),
    status: String(payment?.status || ''),
    paid: Boolean(payment?.paid),
    amountRub: Number(payment?.amount?.value || payment?.amountRub || 0) || 0,
    confirmationUrl,
    raw: payment,
  };
}
