import type {
  CalculatorAdminSettings,
  CalculatorSubscriptionPlan,
} from './types/calculator';

export const SUBSCRIPTION_DURATION_DAYS = 30;

export type SubscriptionPlanFeatures = {
  analytics: boolean;
  templates: boolean;
  requestStatuses: boolean;
  advancedFormulas: boolean;
  notifications: boolean;
  hideBranding: boolean;
  folders: boolean;
  booking: boolean;
};

export type SubscriptionPlanConfig = {
  id: CalculatorSubscriptionPlan;
  name: string;
  monthlyPriceRub: number;
  calculatorLimit: number | null;
  monthlyRequestLimit: number | null;
  features: SubscriptionPlanFeatures;
  paymentTitle: string;
};

const SHARED_BASIC_FEATURES: SubscriptionPlanFeatures = {
  analytics: false,
  templates: false,
  requestStatuses: false,
  advancedFormulas: false,
  notifications: false,
  hideBranding: false,
  folders: false,
  booking: false,
};

export const SUBSCRIPTION_PLANS: Record<CalculatorSubscriptionPlan, SubscriptionPlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceRub: 0,
    calculatorLimit: 1,
    monthlyRequestLimit: 20,
    paymentTitle: 'Бесплатный тариф CalcPro',
    features: {
      ...SHARED_BASIC_FEATURES,
    },
  },
  start: {
    id: 'start',
    name: 'Start',
    monthlyPriceRub: 299,
    calculatorLimit: 3,
    monthlyRequestLimit: 100,
    paymentTitle: 'Тариф Start на 30 дней для сообщества',
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
    calculatorLimit: null,
    monthlyRequestLimit: null,
    paymentTitle: 'Тариф Pro на 30 дней для сообщества',
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

export const DEFAULT_SUBSCRIPTION_PLAN: CalculatorSubscriptionPlan = 'free';
export const DEFAULT_SUBSCRIPTION_PRICE_RUB = SUBSCRIPTION_PLANS.free.monthlyPriceRub;

export const getSubscriptionPlanConfig = (
  plan: CalculatorSubscriptionPlan | string | undefined,
): SubscriptionPlanConfig => {
  if (plan === 'start' || plan === 'pro' || plan === 'free') {
    return SUBSCRIPTION_PLANS[plan];
  }

  return SUBSCRIPTION_PLANS[DEFAULT_SUBSCRIPTION_PLAN];
};

export const createDefaultSubscriptionSettings = (): CalculatorAdminSettings['subscription'] => {
  const freePlan = getSubscriptionPlanConfig(DEFAULT_SUBSCRIPTION_PLAN);
  return {
    plan: freePlan.id,
    priceRub: freePlan.monthlyPriceRub,
    status: 'inactive',
    paidUntil: '',
    provider: '',
    externalPaymentId: '',
  };
};

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
  const plan = getSubscriptionPlanConfig(subscription.plan);
  if (plan.id === 'free') {
    return true;
  }

  if (subscription.status !== 'active') {
    return false;
  }

  const paidUntil = parseSubscriptionDate(subscription.paidUntil);
  return Boolean(paidUntil && paidUntil.getTime() >= now);
};

export const getEffectiveSubscriptionPlan = (
  subscription: CalculatorAdminSettings['subscription'],
  now = Date.now(),
): SubscriptionPlanConfig => {
  const configuredPlan = getSubscriptionPlanConfig(subscription.plan);
  if (configuredPlan.id === 'free') {
    return configuredPlan;
  }

  return isSubscriptionActive(subscription, now)
    ? configuredPlan
    : getSubscriptionPlanConfig(DEFAULT_SUBSCRIPTION_PLAN);
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
