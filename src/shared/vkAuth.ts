type VkLaunchParamsPayload = Record<string, string>;

const VK_LAUNCH_PARAM_KEYS = new Set(['sign']);

const collectLaunchParamsFromQuery = (
  rawQuery: string,
  target: Record<string, string>,
) => {
  const normalizedQuery = rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery;
  if (!normalizedQuery) {
    return;
  }

  new URLSearchParams(normalizedQuery).forEach((value, key) => {
    target[key] = value;
  });
};

export const getWindowLaunchParams = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  const params: Record<string, string> = {};
  collectLaunchParamsFromQuery(window.location.search, params);

  const hash = window.location.hash || '';
  if (hash.includes('?')) {
    collectLaunchParamsFromQuery(hash.slice(hash.indexOf('?') + 1), params);
  }

  return params;
};

const normalizeLaunchParamValue = (value: unknown) => {
  if (value == null) {
    return '';
  }

  return String(value).trim();
};

export const buildVkLaunchParamsPayload = (
  launchParams?: Record<string, unknown> | null,
): VkLaunchParamsPayload => {
  const params = {
    ...getWindowLaunchParams(),
    ...(launchParams && typeof launchParams === 'object' ? launchParams : {}),
  };

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
