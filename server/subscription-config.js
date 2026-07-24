export const SUBSCRIPTION_DURATION_DAYS = 30;
export const DEFAULT_SUBSCRIPTION_PLAN = 'free';
export const BILLING_REMINDER_SCHEDULE_DAYS = [7, 3, 1, 0];

const SHARED_BASIC_FEATURES = {
  analytics: false,
  templates: false,
  requestStatuses: false,
  advancedFormulas: false,
  notifications: false,
  hideBranding: false,
  folders: false,
  booking: false,
};

const MOSCOW_UTC_OFFSET = '+03:00';
const MOSCOW_YMD_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceRub: 0,
    communityLimit: 1,
    calculatorLimit: 1,
    monthlyRequestLimit: 20,
    paymentTitle: '\u0411\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u044b\u0439 \u0442\u0430\u0440\u0438\u0444 CalcPro',
    features: {
      ...SHARED_BASIC_FEATURES,
    },
  },
  start: {
    id: 'start',
    name: 'Start',
    monthlyPriceRub: 299,
    communityLimit: 3,
    calculatorLimit: 3,
    monthlyRequestLimit: 100,
    paymentTitle: '\u0422\u0430\u0440\u0438\u0444 Start \u043d\u0430 30 \u0434\u043d\u0435\u0439 \u0434\u043b\u044f \u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u0430',
    features: {
      ...SHARED_BASIC_FEATURES,
      templates: true,
      requestStatuses: true,
      folders: true,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPriceRub: 699,
    communityLimit: null,
    calculatorLimit: null,
    monthlyRequestLimit: null,
    paymentTitle: '\u0422\u0430\u0440\u0438\u0444 Pro \u043d\u0430 30 \u0434\u043d\u0435\u0439 \u0434\u043b\u044f \u0441\u043e\u043e\u0431\u0449\u0435\u0441\u0442\u0432\u0430',
    features: {
      analytics: true,
      templates: true,
      requestStatuses: true,
      advancedFormulas: true,
      notifications: true,
      hideBranding: true,
      folders: true,
      booking: true,
    },
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
    pendingPaymentId: '',
  };
}

export function createDefaultAdminSettings() {
  return {
    managerVkId: '',
    managerVkConfirmedAt: '',
    billingReminderVkId: '',
    billingReminderConfirmedAt: '',
    updatesBroadcastUnsubscribedAt: '',
    integrations: {
      telegram: {
        botToken: '',
        chatId: '',
        enabled: false,
      },
      googleSheets: {
        webhookUrl: '',
        enabled: false,
        lastExportAt: '',
      },
      amoCrm: {
        subdomain: '',
        accessToken: '',
        pipelineId: '',
        statusId: '',
        responsibleUserId: '',
        enabled: false,
      },
      bitrix24: {
        webhookUrl: '',
        assignedById: '',
        sourceId: '',
        enabled: false,
      },
      webhook: {
        url: '',
        enabled: false,
      },
    },
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

function getMoscowDateParts(date) {
  const [year, month, day] = MOSCOW_YMD_FORMATTER.format(date).split('-').map(Number);
  return { year, month, day };
}

function buildMoscowEndOfDayIso(date) {
  const { year, month, day } = getMoscowDateParts(date);
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return new Date(`${isoDate}T23:59:59.999${MOSCOW_UTC_OFFSET}`).toISOString();
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
  return buildMoscowEndOfDayIso(next);
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
