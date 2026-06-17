type VkLaunchParamsPayload = {
  vk_user_id?: string;
  vk_group_id?: string;
  vk_viewer_group_role?: string;
  sign?: string;
};

const VK_LAUNCH_PARAM_KEYS = new Set(['sign']);

const normalizeLaunchParamValue = (value: unknown) => {
  if (value == null) {
    return '';
  }

  return String(value).trim();
};

export const buildVkLaunchParamsPayload = (
  launchParams?: Record<string, unknown> | null,
): VkLaunchParamsPayload => {
  const params =
    launchParams && typeof launchParams === 'object'
      ? launchParams
      : typeof window !== 'undefined'
        ? Object.fromEntries(new URLSearchParams(window.location.search).entries())
        : {};

  const payload = Object.entries(params).reduce<VkLaunchParamsPayload>((acc, [key, value]) => {
    if (!key.startsWith('vk_') && !VK_LAUNCH_PARAM_KEYS.has(key)) {
      return acc;
    }

    const normalizedValue = normalizeLaunchParamValue(value);
    if (!normalizedValue) {
      return acc;
    }

    acc[key as keyof VkLaunchParamsPayload] = normalizedValue;
    return acc;
  }, {});

  if (!payload.sign && typeof window !== 'undefined') {
    const sign = normalizeLaunchParamValue(new URLSearchParams(window.location.search).get('sign'));
    if (sign) {
      payload.sign = sign;
    }
  }

  return payload;
};

export const createVkAuthHeaders = (launchParams?: Record<string, unknown> | null) => {
  const payload = buildVkLaunchParamsPayload(launchParams);
  const headers: Record<string, string> = {};

  if (Object.keys(payload).length > 0) {
    headers['x-vk-launch-params'] = JSON.stringify(payload);
  }

  return headers;
};
