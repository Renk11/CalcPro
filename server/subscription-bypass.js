import { SUBSCRIPTION_PLANS } from './subscription-config.js';

function parseBypassUserIds(rawValue = '') {
  return new Set(
    String(rawValue)
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
}

const subscriptionBypassUserIds = parseBypassUserIds(
  process.env.CALCPRO_SUBSCRIPTION_BYPASS_USER_IDS,
);

export function hasSubscriptionBypassForViewer(viewerId) {
  return subscriptionBypassUserIds.has(Number(viewerId) || 0);
}

export function getSubscriptionBypassPlan() {
  return SUBSCRIPTION_PLANS.pro;
}
