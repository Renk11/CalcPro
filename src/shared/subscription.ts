import type { CalculatorAdminSettings } from './types/calculator';

export const SUBSCRIPTION_PRICE_RUB = 490;
export const SUBSCRIPTION_DURATION_DAYS = 30;
export const SUBSCRIPTION_PLAN = 'calcpro_30_days';
export const SUBSCRIPTION_TITLE = 'Доступ CalcPro на 30 дней для сообщества';
export const PENDING_YOOKASSA_PAYMENT_KEY = 'calcpro-yookassa-pending-payment-v1';

export const createDefaultSubscriptionSettings = (): CalculatorAdminSettings['subscription'] => ({
  plan: SUBSCRIPTION_PLAN,
  priceRub: SUBSCRIPTION_PRICE_RUB,
  status: 'inactive',
  paidUntil: '',
  provider: '',
  externalPaymentId: '',
});

export const parseSubscriptionDate = (value?: string) => {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
};

export const isSubscriptionActive = (
  subscription: CalculatorAdminSettings['subscription'],
  now = Date.now(),
) => {
  if (subscription.status !== 'active') {
    return false;
  }

  const paidUntil = parseSubscriptionDate(subscription.paidUntil);
  return Boolean(paidUntil && paidUntil.getTime() >= now);
};

export const buildNextPaidUntil = (currentPaidUntil?: string) => {
  const current = parseSubscriptionDate(currentPaidUntil);
  const baseTime = current && current.getTime() > Date.now() ? current.getTime() : Date.now();
  const next = new Date(baseTime);
  next.setDate(next.getDate() + SUBSCRIPTION_DURATION_DAYS);
  return next.toISOString();
};

export const formatSubscriptionDate = (value?: string) => {
  const parsed = parseSubscriptionDate(value);
  return parsed ? parsed.toLocaleDateString('ru-RU') : '';
};
