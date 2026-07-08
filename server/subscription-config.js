export const SUBSCRIPTION_DURATION_DAYS = 30;
export const DEFAULT_SUBSCRIPTION_PLAN = 'free';
export const BILLING_REMINDER_SCHEDULE_DAYS = [7, 3, 1, 0];

export const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceRub: 0,
    communityLimit: 1,
    calculatorLimit: 1,
    monthlyRequestLimit: 20,
    paymentTitle: 'Бесплатный тариф CalcPro',
  },
  start: {
    id: 'start',
    name: 'Start',
    monthlyPriceRub: 299,
    communityLimit: 3,
    calculatorLimit: 3,
    monthlyRequestLimit: 100,
    paymentTitle: 'Тариф Start на 30 дней для сообщества',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPriceRub: 699,
    communityLimit: null,
    calculatorLimit: null,
    monthlyRequestLimit: null,
    paymentTitle: 'Тариф Pro на 30 дней для сообщества',
  },
};

export function getSubscriptionPlanConfig(plan) {
  if (plan === 'start' || plan === 'pro' || plan === 'free') {
    return SUBSCRIPTION_PLANS[plan];
  }

  return SUBSCRIPTION_PLANS[DEFAULT_SUBSCRIPTION_PLAN];
}

export function createDefaultSubscriptionSettings() {
  const freePlan = getSubscriptionPlanConfig(DEFAULT_SUBSCRIPTION_PLAN);
  return {
    plan: freePlan.id,
    priceRub: freePlan.monthlyPriceRub,
    status: 'inactive',
    paidUntil: '',
    quotaStartedAt: '',
    quotaMonthlyUsage: {},
    provider: '',
    externalPaymentId: '',
  };
}

export function createDefaultAdminSettings() {
  return {
    managerVkId: '',
    managerVkConfirmedAt: '',
    billingReminderVkId: '',
    billingReminderConfirmedAt: '',
    googleSheetsWebhookUrl: '',
    googleSheetsLastExportAt: '',
    billingReminderState: {
      cycleId: '',
      sentStages: {},
      lastCheckedAt: '',
      lastSentAt: '',
    },
    subscription: createDefaultSubscriptionSettings(),
  };
}

export function parseSubscriptionDate(value = '') {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

export function isSubscriptionActive(subscription, now = Date.now()) {
  const plan = getSubscriptionPlanConfig(subscription?.plan);
  if (plan.id === 'free') {
    return true;
  }

  if (subscription?.status !== 'active') {
    return false;
  }

  const paidUntil = parseSubscriptionDate(subscription?.paidUntil);
  return Boolean(paidUntil && paidUntil.getTime() >= now);
}

export function getEffectiveSubscriptionPlan(subscription, now = Date.now()) {
  const configuredPlan = getSubscriptionPlanConfig(subscription?.plan);
  if (configuredPlan.id === 'free') {
    return configuredPlan;
  }

  return isSubscriptionActive(subscription, now)
    ? configuredPlan
    : getSubscriptionPlanConfig(DEFAULT_SUBSCRIPTION_PLAN);
}

export function getSubscriptionQuotaCycleId(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function buildNextPaidUntil(currentPaidUntil = '') {
  const current = parseSubscriptionDate(currentPaidUntil);
  const baseTime = current && current.getTime() > Date.now() ? current.getTime() : Date.now();
  const next = new Date(baseTime);
  next.setDate(next.getDate() + SUBSCRIPTION_DURATION_DAYS);
  return next.toISOString();
}

export function normalizeSubscriptionAmount(value, plan = DEFAULT_SUBSCRIPTION_PLAN) {
  const amountRub = Number(value);
  if (!Number.isFinite(amountRub) || amountRub <= 0) {
    return getSubscriptionPlanConfig(plan).monthlyPriceRub;
  }

  return amountRub;
}

export function isSubscriptionAmountValid(paymentAmountRub, expectedAmountRub) {
  return Math.abs(Number(paymentAmountRub) - Number(expectedAmountRub)) < 0.000001;
}
