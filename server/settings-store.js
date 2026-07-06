import {
  createDefaultAdminSettings,
  createDefaultSubscriptionSettings,
  getSubscriptionPlanConfig,
} from './subscription-config.js';
import { supabaseSelect, supabaseUpsert } from './supabase.js';

const ADMIN_SETTINGS_KEY = 'calcpro:admin-settings';
const GROUP_SETTINGS_KEY_PREFIX = 'calcpro:admin-settings:group:';

function normalizeGroupId(groupId) {
  const numericGroupId = Number(groupId);
  return Number.isInteger(numericGroupId) && numericGroupId > 0 ? String(numericGroupId) : '';
}

function getAdminSettingsKey(groupId) {
  const normalizedGroupId = normalizeGroupId(groupId);
  return normalizedGroupId
    ? `${GROUP_SETTINGS_KEY_PREFIX}${normalizedGroupId}`
    : ADMIN_SETTINGS_KEY;
}

function normalizeSubscription(subscription = {}) {
  const defaults = createDefaultSubscriptionSettings();
  const planConfig = getSubscriptionPlanConfig(subscription.plan || defaults.plan);

  return {
    ...defaults,
    ...subscription,
    plan: planConfig.id,
    priceRub: Number(subscription.priceRub) || planConfig.monthlyPriceRub,
    status: subscription.status === 'active' ? 'active' : 'inactive',
    paidUntil: String(subscription.paidUntil || defaults.paidUntil),
    provider: String(subscription.provider || defaults.provider),
    externalPaymentId: String(subscription.externalPaymentId || defaults.externalPaymentId),
  };
}

function normalizeVkUserId(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? String(numericValue) : '';
}

export function normalizeAdminSettings(settings = {}) {
  const defaults = createDefaultAdminSettings();

  return {
    managerVkId: String(settings.managerVkId || defaults.managerVkId),
    billingReminderVkId: normalizeVkUserId(settings.billingReminderVkId || defaults.billingReminderVkId),
    billingReminderConfirmedAt: String(
      settings.billingReminderConfirmedAt || defaults.billingReminderConfirmedAt,
    ),
    subscription: normalizeSubscription(settings.subscription),
  };
}

async function readSettingRow(key) {
  try {
    const rows = await supabaseSelect('app_settings', {
      select: 'value',
      filter: { key: 'key', value: `eq.${key}` },
      limit: 1,
    });

    return rows?.[0]?.value ?? null;
  } catch (error) {
    if (String(error?.message || '').includes('schema cache')) {
      return null;
    }

    throw error;
  }
}

async function writeSettingRow(key, value) {
  try {
    await supabaseUpsert(
      'app_settings',
      [
        {
          key,
          value,
        },
      ],
      { onConflict: 'key' },
    );
  } catch (error) {
    if (!String(error?.message || '').includes('schema cache')) {
      throw error;
    }
  }
}

export async function getServerAdminSettings(groupId) {
  const scopedKey = getAdminSettingsKey(groupId);
  const scopedSettings = await readSettingRow(scopedKey);
  const settings =
    scopedSettings ||
    (normalizeGroupId(groupId)
      ? (await readSettingRow(ADMIN_SETTINGS_KEY)) || createDefaultAdminSettings()
      : createDefaultAdminSettings());
  return normalizeAdminSettings(settings);
}

export async function saveServerAdminSettings(settings, groupId) {
  const normalized = normalizeAdminSettings(settings);
  await writeSettingRow(getAdminSettingsKey(groupId), normalized);
  return normalized;
}

export async function updateServerSubscription(subscriptionPatch = {}, groupId) {
  const settings = await getServerAdminSettings(groupId);
  const nextSettings = normalizeAdminSettings({
    ...settings,
    subscription: {
      ...settings.subscription,
      ...subscriptionPatch,
    },
  });

  await writeSettingRow(getAdminSettingsKey(groupId), nextSettings);
  return nextSettings;
}

export async function linkServerBillingReminderRecipient(groupId, userId) {
  const settings = await getServerAdminSettings(groupId);
  const normalizedUserId = normalizeVkUserId(userId);
  if (!normalizedUserId) {
    throw new Error('Valid VK user id is required');
  }

  const nextSettings = normalizeAdminSettings({
    ...settings,
    billingReminderVkId: normalizedUserId,
    billingReminderConfirmedAt: new Date().toISOString(),
  });

  await writeSettingRow(getAdminSettingsKey(groupId), nextSettings);
  return nextSettings;
}

export async function saveServerPayment(payment) {
  const now = new Date().toISOString();
  try {
    await supabaseUpsert(
      'payments',
      [
        {
          id: payment.id,
          status: payment.status || 'pending',
          amount_rub: Number(payment.amountRub) || 0,
          description: payment.description || null,
          payment_url: payment.paymentUrl || null,
          paid_at: payment.paidAt || null,
          created_at: payment.createdAt || now,
          updated_at: now,
        },
      ],
      { onConflict: 'id' },
    );
  } catch (error) {
    if (!String(error?.message || '').includes('schema cache')) {
      throw error;
    }
  }

  return payment;
}
