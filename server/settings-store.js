import {
  createDefaultAdminSettings,
  createDefaultSubscriptionSettings,
  getSubscriptionPlanConfig,
} from './subscription-config.js';
import { normalizeGoogleSheetsWebhookUrl } from './google-sheets-url.js';
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
    pendingPaymentId: String(subscription.pendingPaymentId || defaults.pendingPaymentId),
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

function normalizeWebhookUrl(value) {
  const trimmedValue = String(value || '').trim();
  if (!trimmedValue) {
    return '';
  }

  try {
    const url = new URL(trimmedValue);
    const isLocalhost =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname === '[::1]';
    if (url.protocol === 'https:') {
      return url.toString();
    }

    return process.env.NODE_ENV !== 'production' && isLocalhost && url.protocol === 'http:'
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function normalizeAmoCrmSubdomain(value) {
  const trimmedValue = String(value || '').trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(trimmedValue) ? trimmedValue : '';
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeIntegrations(integrations = {}, defaults = createDefaultAdminSettings().integrations) {
  const normalizedIntegrations =
    integrations && typeof integrations === 'object' && !Array.isArray(integrations)
      ? integrations
      : {};

  return {
    telegram: {
      botToken: String(
        normalizedIntegrations.telegram?.botToken || defaults.telegram.botToken || '',
      ).trim(),
      chatId: String(normalizedIntegrations.telegram?.chatId || defaults.telegram.chatId || '').trim(),
      enabled: normalizeBoolean(normalizedIntegrations.telegram?.enabled),
    },
    googleSheets: {
      webhookUrl: normalizeGoogleSheetsWebhookUrl(
        normalizedIntegrations.googleSheets?.webhookUrl || defaults.googleSheets.webhookUrl || '',
      ),
      enabled: normalizeBoolean(normalizedIntegrations.googleSheets?.enabled),
      lastExportAt: String(
        normalizedIntegrations.googleSheets?.lastExportAt || defaults.googleSheets.lastExportAt || '',
      ).trim(),
    },
    amoCrm: {
      subdomain: normalizeAmoCrmSubdomain(
        normalizedIntegrations.amoCrm?.subdomain || defaults.amoCrm.subdomain || '',
      ),
      accessToken: String(
        normalizedIntegrations.amoCrm?.accessToken || defaults.amoCrm.accessToken || '',
      ).trim(),
      pipelineId: String(
        normalizedIntegrations.amoCrm?.pipelineId || defaults.amoCrm.pipelineId || '',
      ).trim(),
      statusId: String(normalizedIntegrations.amoCrm?.statusId || defaults.amoCrm.statusId || '').trim(),
      responsibleUserId: String(
        normalizedIntegrations.amoCrm?.responsibleUserId || defaults.amoCrm.responsibleUserId || '',
      ).trim(),
      enabled: normalizeBoolean(normalizedIntegrations.amoCrm?.enabled),
    },
    bitrix24: {
      webhookUrl: normalizeWebhookUrl(
        normalizedIntegrations.bitrix24?.webhookUrl || defaults.bitrix24.webhookUrl || '',
      ),
      assignedById: String(
        normalizedIntegrations.bitrix24?.assignedById || defaults.bitrix24.assignedById || '',
      ).trim(),
      sourceId: String(normalizedIntegrations.bitrix24?.sourceId || defaults.bitrix24.sourceId || '').trim(),
      enabled: normalizeBoolean(normalizedIntegrations.bitrix24?.enabled),
    },
    webhook: {
      url: normalizeWebhookUrl(normalizedIntegrations.webhook?.url || defaults.webhook.url || ''),
      enabled: normalizeBoolean(normalizedIntegrations.webhook?.enabled),
    },
  };
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
  const normalizedIntegrations = normalizeIntegrations(settings.integrations, defaults.integrations);
  const fallbackGoogleSheetsWebhookUrl = normalizeGoogleSheetsWebhookUrl(
    settings.googleSheetsWebhookUrl || normalizedIntegrations.googleSheets.webhookUrl,
  );
  const fallbackGoogleSheetsLastExportAt = String(
    settings.googleSheetsLastExportAt || normalizedIntegrations.googleSheets.lastExportAt,
  ).trim();
  const integrations = {
    ...normalizedIntegrations,
    googleSheets: {
      ...normalizedIntegrations.googleSheets,
      webhookUrl: normalizedIntegrations.googleSheets.webhookUrl || fallbackGoogleSheetsWebhookUrl,
      enabled:
        normalizedIntegrations.googleSheets.enabled ||
        Boolean(
          normalizedIntegrations.googleSheets.webhookUrl || fallbackGoogleSheetsWebhookUrl,
        ),
      lastExportAt: normalizedIntegrations.googleSheets.lastExportAt || fallbackGoogleSheetsLastExportAt,
    },
  };

  return {
    managerVkId: normalizeManagerVkUserId(settings.managerVkId || defaults.managerVkId),
    managerVkConfirmedAt: String(settings.managerVkConfirmedAt || defaults.managerVkConfirmedAt).trim(),
    billingReminderVkId: normalizeVkUserId(settings.billingReminderVkId || defaults.billingReminderVkId),
    billingReminderConfirmedAt: String(
      settings.billingReminderConfirmedAt || defaults.billingReminderConfirmedAt,
    ),
    updatesBroadcastUnsubscribedAt: String(
      settings.updatesBroadcastUnsubscribedAt || defaults.updatesBroadcastUnsubscribedAt,
    ).trim(),
    integrations,
    googleSheetsWebhookUrl: normalizeGoogleSheetsWebhookUrl(
      fallbackGoogleSheetsWebhookUrl || defaults.googleSheetsWebhookUrl,
    ),
    googleSheetsLastExportAt: String(
      fallbackGoogleSheetsLastExportAt || defaults.googleSheetsLastExportAt,
    ).trim(),
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
  const settings = scopedSettings || createDefaultAdminSettings();
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
    updatesBroadcastUnsubscribedAt: '',
  });

  await writeSettingRow(getAdminSettingsKey(groupId), nextSettings);
  return nextSettings;
}

export async function updateServerBroadcastSubscription(groupId, userId, isSubscribed) {
  const settings = await getServerAdminSettings(groupId);
  const normalizedUserId = normalizeVkUserId(userId);
  if (!normalizedUserId) {
    throw new Error('Valid VK user id is required');
  }

  if (settings.billingReminderVkId && settings.billingReminderVkId !== normalizedUserId) {
    throw new Error('Broadcast recipient does not match the configured reminder recipient');
  }

  const nextSettings = normalizeAdminSettings({
    ...settings,
    updatesBroadcastUnsubscribedAt: isSubscribed ? '' : new Date().toISOString(),
  });

  await writeSettingRow(getAdminSettingsKey(groupId), nextSettings);
  return nextSettings;
}

export async function updateServerBroadcastSubscriptionForUser(userId, isSubscribed) {
  const normalizedUserId = normalizeVkUserId(userId);
  if (!normalizedUserId) {
    throw new Error('Valid VK user id is required');
  }

  const settingsList = await listServerAdminSettings();
  const matchedSettings = settingsList.filter(
    ({ settings }) => settings.billingReminderVkId === normalizedUserId,
  );

  if (matchedSettings.length === 0) {
    throw new Error('Broadcast recipient is not configured for this user');
  }

  const nextUnsubscribedAt = isSubscribed ? '' : new Date().toISOString();
  await Promise.all(
    matchedSettings.map(({ groupId, settings }) =>
      writeSettingRow(
        getAdminSettingsKey(groupId),
        normalizeAdminSettings({
          ...settings,
          updatesBroadcastUnsubscribedAt: nextUnsubscribedAt,
        }),
      ),
    ),
  );

  return matchedSettings.length;
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
