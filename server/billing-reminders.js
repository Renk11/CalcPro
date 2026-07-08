import {
  BILLING_REMINDER_SCHEDULE_DAYS,
  parseSubscriptionDate,
} from './subscription-config.js';
import {
  getServerAdminSettings,
  listServerAdminSettings,
  saveServerAdminSettings,
} from './settings-store.js';
import { hasSupabaseCredentials } from './supabase.js';
import { getVkCommunityInfo, hasVkGroupToken, sendVkMessage } from './vk.js';

const REMINDER_CHECK_INTERVAL_MS = Math.max(
  5 * 60 * 1000,
  (Number(process.env.BILLING_REMINDER_CHECK_INTERVAL_MINUTES) || 30) * 60 * 1000,
);
const DAY_MS = 24 * 60 * 60 * 1000;
const MOSCOW_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function isPaidSubscriptionActive(subscription) {
  return (
    subscription?.status === 'active' &&
    subscription?.plan !== 'free' &&
    Boolean(parseSubscriptionDate(subscription?.paidUntil))
  );
}

function buildReminderCycleId(subscription) {
  return `plan:${subscription.plan}|paidUntil:${subscription.paidUntil || ''}`;
}

function createReminderState(settings) {
  const nextCycleId = buildReminderCycleId(settings.subscription);
  const currentState =
    settings.billingReminderState &&
    typeof settings.billingReminderState === 'object' &&
    !Array.isArray(settings.billingReminderState)
      ? settings.billingReminderState
      : {};

  if (currentState.cycleId === nextCycleId) {
    return {
      cycleId: nextCycleId,
      sentStages:
        currentState.sentStages &&
        typeof currentState.sentStages === 'object' &&
        !Array.isArray(currentState.sentStages)
          ? currentState.sentStages
          : {},
      lastCheckedAt: String(currentState.lastCheckedAt || ''),
      lastSentAt: String(currentState.lastSentAt || ''),
    };
  }

  return {
    cycleId: nextCycleId,
    sentStages: {},
    lastCheckedAt: '',
    lastSentAt: '',
  };
}

function getMoscowDateDayNumber(date) {
  const [year, month, day] = MOSCOW_DATE_FORMATTER.format(date).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function resolveReminderStage(paidUntil, sentStages = {}, now = new Date()) {
  const remainingMs = paidUntil.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return null;
  }

  const isSameMoscowDate = getMoscowDateDayNumber(paidUntil) === getMoscowDateDayNumber(now);
  const stages = [...BILLING_REMINDER_SCHEDULE_DAYS]
    .filter((stage) => stage > 0)
    .sort((left, right) => left - right);

  for (const stage of stages) {
    if (remainingMs <= stage * DAY_MS) {
      const stageKey = String(stage);
      if (!sentStages[stageKey]) {
        return stageKey;
      }

      if (stage === 1 && isSameMoscowDate && !sentStages['0']) {
        return '0';
      }

      return null;
    }
  }

  return null;
}

function formatMoscowDate(isoString) {
  const date = parseSubscriptionDate(isoString);
  if (!date) {
    return 'дата не определена';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Moscow',
  }).format(date);
}

function formatRemainingLabel(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(totalSeconds / (60 * 60 * 24));
  const hours = Math.floor((totalSeconds % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);

  if (days > 0) {
    return `${days} дн. ${hours} ч.`;
  }

  if (hours > 0) {
    return `${hours} ч. ${minutes} мин.`;
  }

  return `${minutes} мин.`;
}

function buildReminderTitle(stage) {
  if (stage === '0') {
    return 'Напоминание: тариф CalcPro заканчивается сегодня';
  }

  return `Напоминание: до окончания тарифа CalcPro осталось ${stage} дн.`;
}

async function buildReminderMessage(groupId, settings, stage, remainingMs) {
  let communityName = `Сообщество ${groupId}`;
  let communityLink = `https://vk.com/club${groupId}`;

  try {
    const community = await getVkCommunityInfo(groupId);
    communityName = community.name || communityName;
    if (community.screenName) {
      communityLink = `https://vk.com/${community.screenName}`;
    }
  } catch {
    // Keep fallback values when VK community info is temporarily unavailable.
  }

  return [
    buildReminderTitle(stage),
    '',
    `Сообщество: ${communityName}`,
    `Ссылка: ${communityLink}`,
    `Тариф: ${String(settings.subscription.plan || '').toUpperCase()}`,
    `Оплачен до: ${formatMoscowDate(settings.subscription.paidUntil)}`,
    `Осталось: ${formatRemainingLabel(remainingMs)}`,
    '',
    'Желательно продлить тариф заранее, чтобы уведомления и заявки продолжали работать без паузы.',
  ].join('\n');
}

async function processGroupReminder(groupId) {
  const settings = await getServerAdminSettings(groupId);
  const recipientId = String(settings.billingReminderVkId || '').trim();
  const paidUntil = parseSubscriptionDate(settings.subscription.paidUntil);
  const now = new Date();

  if (!recipientId || !settings.billingReminderConfirmedAt || !paidUntil) {
    return;
  }

  if (!isPaidSubscriptionActive(settings.subscription)) {
    return;
  }

  const reminderState = createReminderState(settings);
  const remainingMs = paidUntil.getTime() - now.getTime();
  const stage = resolveReminderStage(paidUntil, reminderState.sentStages, now);
  const nextCheckedAt = now.toISOString();

  if (!stage || reminderState.sentStages[stage]) {
    return false;
  }

  const message = await buildReminderMessage(groupId, settings, stage, remainingMs);
  await sendVkMessage(recipientId, message);

  await saveServerAdminSettings(
    {
      ...settings,
      billingReminderState: {
        ...reminderState,
        sentStages: {
          ...reminderState.sentStages,
          [stage]: nextCheckedAt,
        },
        lastCheckedAt: nextCheckedAt,
        lastSentAt: nextCheckedAt,
      },
    },
    groupId,
  );
  return true;
}

export async function runBillingReminderCheck() {
  if (!hasSupabaseCredentials() || !hasVkGroupToken()) {
    return { checked: 0, sent: 0, skipped: true };
  }

  const groups = await listServerAdminSettings();
  let sent = 0;

  for (const entry of groups) {
    try {
      const settings = entry?.settings;
      if (!settings || !isPaidSubscriptionActive(settings.subscription)) {
        continue;
      }

      if (await processGroupReminder(entry.groupId)) {
        sent += 1;
      }
    } catch (error) {
      console.error(`[billing-reminders] Failed for group ${entry.groupId}`, error);
    }
  }

  return {
    checked: groups.length,
    sent,
    skipped: false,
  };
}

export function startBillingReminderScheduler() {
  let isRunning = false;

  const run = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    try {
      const result = await runBillingReminderCheck();
      if (!result.skipped) {
        console.log(
          `[billing-reminders] checked=${result.checked} sent=${result.sent} intervalMs=${REMINDER_CHECK_INTERVAL_MS}`,
        );
      }
    } catch (error) {
      console.error('[billing-reminders] Scheduler failed', error);
    } finally {
      isRunning = false;
    }
  };

  void run();
  return setInterval(() => {
    void run();
  }, REMINDER_CHECK_INTERVAL_MS);
}
