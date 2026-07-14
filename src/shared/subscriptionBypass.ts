import { SUBSCRIPTION_PLANS, type SubscriptionPlanConfig } from './subscription';

export const hasSubscriptionBypassForUser = () => false;

export const getSubscriptionBypassPlan = (): SubscriptionPlanConfig => SUBSCRIPTION_PLANS.pro;
