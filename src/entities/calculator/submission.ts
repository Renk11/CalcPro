import bridge from '@vkontakte/vk-bridge';
import { addRequest } from '../../shared/storage/localStorage';
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
    return value.surcharge > 0 ? `${value.label} (+${value.surcharge} \u20bd)` : value.label;
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
  const details = Object.entries(request.values)
    .map(([key, value]) => `${key}: ${formatRequestValue(value)}`)
    .join('\n');

  return [
    `Новая заявка: ${request.templateTitle}`,
    `Имя: ${request.name}`,
    `Телефон: ${request.phone}`,
    `Комментарий: ${request.comment || 'Без комментария'}`,
    `Сумма: ${request.amount} ₽`,
    details ? `\nДетали:\n${details}` : '',
  ].join('\n');
};

export const submitRequest = async (request: CalculatorRequest) => {
  addRequest(request);
  const message = buildMessage(request);

  try {
    await bridge.send('VKWebAppCopyText', { text: message });
    return {
      ok: true,
      message:
        'Заявка сохранена, текст скопирован для отправки в сообщения сообщества.',
    };
  } catch {
    await navigator.clipboard.writeText(message).catch(() => undefined);
    return {
      ok: true,
      message: 'Заявка сохранена локально. Текст заявки подготовлен для отправки.',
    };
  }
};
