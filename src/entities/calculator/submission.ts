import bridge from '@vkontakte/vk-bridge';
import { addRequest } from '../../shared/storage/localStorage';
import { appendVkLaunchParamsToPath, createVkAuthHeaders, getWindowLaunchParams } from '../../shared/vkAuth';
import type {
  CalculatorFieldValue,
  CalculatorRequest,
  CalculatorUploadedFile,
} from '../../shared/types/calculator';
import { isBookingValue } from './booking';

const isUploadedFileArray = (value: CalculatorFieldValue): value is CalculatorUploadedFile[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'name' in item &&
      'size' in item &&
      'type' in item,
  );

const formatRequestValue = (value: CalculatorFieldValue) => {
  if (isBookingValue(value)) {
    return value.surcharge > 0 ? `${value.label} (+${value.surcharge} ₽)` : value.label;
  }

  if (isUploadedFileArray(value)) {
    return value.map((item) => item.name).join(', ') || '-';
  }

  if (Array.isArray(value)) {
    return value.join(', ') || '-';
  }

  if (typeof value === 'boolean') {
    return value ? 'Да' : 'Нет';
  }

  return String(value || '-');
};

const buildMessage = (request: CalculatorRequest) => {
  const details = (request.details?.length
    ? request.details.map((item) => `${item.label}: ${item.value}`)
    : Object.entries(request.values).map(([key, value]) => `${key}: ${formatRequestValue(value)}`))
    .map((item) => `• ${item}`)
    .join('\n');

  return [
    '🆕 Новая заявка',
    `🧮 Калькулятор: ${request.templateTitle}`,
    `👤 Имя: ${request.name}`,
    `📞 Телефон: ${request.phone}`,
    `💬 Комментарий: ${request.comment || 'Без комментария'}`,
    `💰 Сумма: ${request.amount} ₽`,
    details ? `\n📋 Детали:\n${details}` : '',
  ].join('\n');
};

export const submitRequest = async (request: CalculatorRequest, groupId = 0) => {
  const message = buildMessage(request);

  try {
    const response = await fetch(
      appendVkLaunchParamsToPath('/api/requests', getWindowLaunchParams()),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...createVkAuthHeaders(getWindowLaunchParams()),
        },
        body: JSON.stringify({
          ...request,
          groupId,
        }),
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; message?: string; error?: string }
      | null;

    if (response.ok && payload?.ok) {
      addRequest(request);
      return {
        ok: true,
        shouldStoreLocally: true,
        message: payload.message || 'Заявка отправлена менеджеру.',
      };
    }

    if (payload?.message || payload?.error) {
      return {
        ok: false,
        shouldStoreLocally: false,
        message: payload.message || payload.error || 'Не удалось отправить заявку.',
      };
    }
  } catch {
    // Fall back to manual delivery when server-side VK sending is unavailable.
  }

  addRequest(request);

  try {
    await bridge.send('VKWebAppCopyText', { text: message });
    return {
      ok: true,
      shouldStoreLocally: true,
      message: 'Заявка сохранена, текст скопирован для ручной отправки в сообщения сообщества.',
    };
  } catch {
    await navigator.clipboard.writeText(message).catch(() => undefined);
    return {
      ok: true,
      shouldStoreLocally: true,
      message: 'Заявка сохранена локально. Текст подготовлен для отправки.',
    };
  }
};
