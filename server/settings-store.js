import {
  createDefaultAdminSettings,
  createDefaultSubscriptionSettings,
} from './subscription-config.js';
import { supabaseSelect, supabaseUpsert } from './supabase.js';

const ADMIN_SETTINGS_KEY = 'calcpro:admin-settings';

function normalizeSubscription(subscription = {}) {
  const defaults = createDefaultSubscriptionSettings();

  return {
    ...defaults,
    ...subscription,
    plan: String(subscription.plan || defaults.plan),
    priceRub: Number(subscription.priceRub) || defaults.priceRub,
    status: subscription.status === 'active' ? 'active' : 'inactive',
    paidUntil: String(subscription.paidUntil || defaults.paidUntil),
    provider: String(subscription.provider || defaults.provider),
    externalPaymentId: String(subscription.externalPaymentId || defaults.externalPaymentId),
  };
}

export function normalizeAdminSettings(settings = {}) {
  const defaults = createDefaultAdminSettings();

  return {
    managerVkId: String(settings.managerVkId || defaults.managerVkId),
    subscription: normalizeSubscription(settings.subscription),
  };
}

async function readSettingRow(key) {
  const rows = await supabaseSelect('app_settings', {
    select: 'value',
    filter: { key: 'key', value: `eq.${key}` },
    limit: 1,
  });

  return rows?.[0]?.value ?? null;
}

async function writeSettingRow(key, value) {
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
}

export async function getServerAdminSettings() {
  const settings = (await readSettingRow(ADMIN_SETTINGS_KEY)) || createDefaultAdminSettings();
  return normalizeAdminSettings(settings);
}

export async function saveServerAdminSettings(settings) {
  const normalized = normalizeAdminSettings(settings);
  await writeSettingRow(ADMIN_SETTINGS_KEY, normalized);
  return normalized;
}

export async function updateServerSubscription(subscriptionPatch = {}) {
  const settings = await getServerAdminSettings();
  const nextSettings = normalizeAdminSettings({
    ...settings,
    subscription: {
      ...settings.subscription,
      ...subscriptionPatch,
    },
  });

  await writeSettingRow(ADMIN_SETTINGS_KEY, nextSettings);
  return nextSettings;
}

export async function saveServerPayment(payment) {
  const now = new Date().toISOString();
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

  return payment;
}
