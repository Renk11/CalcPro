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
  const quotaMonthlyUsageSource =
    subscription.quotaMonthlyUsage &&
    typeof subscription.quotaMonthlyUsage === 'object' &&
    !Array.isArray(subscription.quotaMonthlyUsage)
      ? subscription.quotaMonthlyUsage
      : {};
  const quotaMonthlyUsage = Object.fromEntries(
    Object.entries(quotaMonthlyUsageSource)
      .map(([cycleId, value]) => [
        String(cycleId).trim(),
        Math.max(0, Math.trunc(Number(value) || 0)),
      ])
      .filter(([cycleId, value]) => cycleId && Number.isFinite(value)),
  );

  return {
    ...defaults,
    ...subscription,
    plan: planConfig.id,
    priceRub: Number(subscription.priceRub) || planConfig.monthlyPriceRub,
    status: subscription.status === 'active' ? 'active' : 'inactive',
    paidUntil: String(subscription.paidUntil || defaults.paidUntil),
    quotaStartedAt: String(subscription.quotaStartedAt || defaults.quotaStartedAt),
    quotaMonthlyUsage,
    provider: String(subscription.provider || defaults.provider),
    externalPaymentId: String(subscription.externalPaymentId || defaults.externalPaymentId),
  };
}

function normalizeVkUserId(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? String(numericValue) : '';
}

function normalizeManagerVkUserId(value) {
  const firstToken = String(value || '')
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .find(Boolean);

  return normalizeVkUserId(firstToken);
}

function normalizeBillingReminderState(state = {}, paidUntil = '') {
  const normalizedState =
    state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const normalizedCycleId = String(normalizedState.cycleId || '').trim();
  const fallbackCycleId = paidUntil ? `paidUntil:${paidUntil}` : '';
  const sentStagesSource =
    normalizedState.sentStages &&
    typeof normalizedState.sentStages === 'object' &&
    !Array.isArray(normalizedState.sentStages)
      ? normalizedState.sentStages
      : {};

  const sentStages = Object.fromEntries(
    Object.entries(sentStagesSource)
      .map(([stage, value]) => [String(stage).trim(), String(value || '').trim()])
      .filter(([stage, value]) => stage && value),
  );

  return {
    cycleId: normalizedCycleId || fallbackCycleId,
    sentStages,
    lastCheckedAt: String(normalizedState.lastCheckedAt || '').trim(),
    lastSentAt: String(normalizedState.lastSentAt || '').trim(),
  };
}

export function normalizeAdminSettings(settings = {}) {
  const defaults = createDefaultAdminSettings();
  const subscription = normalizeSubscription(settings.subscription);

  return {
    managerVkId: normalizeManagerVkUserId(settings.managerVkId || defaults.managerVkId),
    managerVkConfirmedAt: String(settings.managerVkConfirmedAt || defaults.managerVkConfirmedAt).trim(),
    billingReminderVkId: normalizeVkUserId(settings.billingReminderVkId || defaults.billingReminderVkId),
    billingReminderConfirmedAt: String(
      settings.billingReminderConfirmedAt || defaults.billingReminderConfirmedAt,
    ),
    billingReminderState: normalizeBillingReminderState(
      settings.billingReminderState,
      subscription.paidUntil,
    ),
    subscription,
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

export async function listServerAdminSettings() {
  try {
    const rows = await supabaseSelect('app_settings', {
      select: 'key,value',
      filter: { key: 'key', value: `like.${GROUP_SETTINGS_KEY_PREFIX}%` },
      limit: 5000,
    });

    return rows
      .map((row) => {
        const groupId = normalizeGroupId(String(row?.key || '').split(':').pop() || '');
        if (!groupId) {
          return null;
        }

        return {
          groupId: Number(groupId),
          settings: normalizeAdminSettings(row?.value || {}),
        };
      })
      .filter(Boolean);
  } catch (error) {
    if (String(error?.message || '').includes('schema cache')) {
      return [];
    }

    throw error;
  }
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

export async function linkServerManagerRecipient(groupId, userId) {
  const settings = await getServerAdminSettings(groupId);
  const normalizedUserId = normalizeVkUserId(userId);
  if (!normalizedUserId) {
    throw new Error('Valid VK user id is required');
  }

  if (settings.managerVkId && settings.managerVkId !== normalizedUserId) {
    throw new Error('Manager VK id does not match the configured recipient');
  }

  const nextSettings = normalizeAdminSettings({
    ...settings,
    managerVkId: normalizedUserId,
    managerVkConfirmedAt: new Date().toISOString(),
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
