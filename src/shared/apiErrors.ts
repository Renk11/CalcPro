export const VK_LAUNCH_PARAMS_ERROR = 'VK launch params verification failed';

export const isVkLaunchParamsError = (payload?: { error?: string } | null, status?: number) =>
  status === 401 && payload?.error === VK_LAUNCH_PARAMS_ERROR;
