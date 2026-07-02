export const VK_LAUNCH_PARAMS_ERROR = 'VK launch params verification failed';

export type VkLaunchParamsErrorPayload = {
  error?: string;
  errorCode?: string;
} | null;

export const isVkLaunchParamsError = (
  payload?: VkLaunchParamsErrorPayload,
  status?: number,
) => status === 401 && payload?.error === VK_LAUNCH_PARAMS_ERROR;

export const getVkLaunchParamsErrorMessage = (
  payload?: VkLaunchParamsErrorPayload,
  status?: number,
) => {
  if (!isVkLaunchParamsError(payload, status)) {
    return '';
  }

  switch (payload?.errorCode) {
    case 'missing_launch_params':
      return 'Сервер не получил VK launch params. Откройте кабинет из сообщества VK, а не по прямой ссылке.';
    case 'invalid_launch_params':
      return 'VK launch params повреждены или переданы в неверном формате. Проверьте запуск мини-приложения внутри VK.';
    case 'missing_sign':
      return 'В VK launch params отсутствует подпись sign. Обычно это значит, что приложение открыто вне корректного VK-контекста.';
    case 'invalid_signature':
      return 'Подпись VK launch params не прошла проверку. Проверьте секрет мини-приложения в переменной VK_APP_SECRET, VK_MINI_APP_SECRET или VK_CLIENT_SECRET на сервере.';
    default:
      return 'Сервер не подтвердил VK-контекст. Откройте кабинет из сообщества VK или проверьте launch params.';
  }
};
