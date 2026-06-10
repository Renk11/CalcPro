export const SUBSCRIPTION_PRICE_RUB = 490;
export const SUBSCRIPTION_DURATION_DAYS = 30;
export const SUBSCRIPTION_PLAN = 'calcpro_30_days';
export const SUBSCRIPTION_TITLE = 'Доступ CalcPro на 30 дней для сообщества';

export function createDefaultSubscriptionSettings() {
  return {
    plan: SUBSCRIPTION_PLAN,
    priceRub: SUBSCRIPTION_PRICE_RUB,
    status: 'inactive',
    paidUntil: '',
    provider: '',
    externalPaymentId: '',
  };
}

export function createDefaultAdminSettings() {
  return {
    managerVkId: '',
    subscription: createDefaultSubscriptionSettings(),
  };
}

export function parseSubscriptionDate(value = '') {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

export function buildNextPaidUntil(currentPaidUntil = '') {
  const current = parseSubscriptionDate(currentPaidUntil);
  const baseTime = current && current.getTime() > Date.now() ? current.getTime() : Date.now();
  const next = new Date(baseTime);
  next.setDate(next.getDate() + SUBSCRIPTION_DURATION_DAYS);
  return next.toISOString();
}

export function normalizeSubscriptionAmount(value) {
  const amountRub = Number(value);
  if (!Number.isFinite(amountRub) || amountRub <= 0) {
    return SUBSCRIPTION_PRICE_RUB;
  }

  return amountRub;
}

export function isSubscriptionAmountValid(paymentAmountRub, expectedAmountRub) {
  return Math.abs(Number(paymentAmountRub) - Number(expectedAmountRub)) < 0.000001;
}
