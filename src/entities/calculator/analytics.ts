import {
  appendVkLaunchParamsToPath,
  createVkAuthHeaders,
  getWindowLaunchParams,
} from '../../shared/vkAuth';
import type {
  CalculatorAnalyticsDeviceType,
  CalculatorTemplate,
} from '../../shared/types/calculator';

const detectDeviceType = (): CalculatorAnalyticsDeviceType => {
  if (typeof window === 'undefined') {
    return 'desktop';
  }

  const viewportWidth = window.innerWidth || 0;
  const userAgent = window.navigator.userAgent.toLowerCase();

  if (viewportWidth <= 768 || /iphone|android.+mobile|windows phone/.test(userAgent)) {
    return 'mobile';
  }

  if (viewportWidth <= 1024 || /ipad|tablet|android/.test(userAgent)) {
    return 'tablet';
  }

  return 'desktop';
};

const resolveTrafficSource = () => {
  if (typeof window === 'undefined') {
    return 'Прямой';
  }

  const url = new URL(window.location.href);
  const utmSource = url.searchParams.get('utm_source')?.trim();
  if (utmSource) {
    return `UTM: ${utmSource}`;
  }

  const vkRef = url.searchParams.get('vk_ref')?.trim();
  if (vkRef) {
    return `VK: ${vkRef}`;
  }

  const launchParams = getWindowLaunchParams();
  const vkPlatform = String(launchParams.vk_platform || '').trim();
  if (vkPlatform) {
    return `VK ${vkPlatform}`;
  }

  const referrer = document.referrer.trim();
  if (referrer) {
    try {
      const referrerHost = new URL(referrer).hostname.replace(/^www\./, '');
      if (referrerHost) {
        return referrerHost;
      }
    } catch {
      return referrer;
    }
  }

  return 'Прямой';
};

export const trackCalculatorView = async (template: CalculatorTemplate, groupId: number) => {
  if (groupId <= 0) {
    return;
  }

  try {
    await fetch(appendVkLaunchParamsToPath('/api/analytics', getWindowLaunchParams()), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...createVkAuthHeaders(getWindowLaunchParams()),
      },
      body: JSON.stringify({
        action: 'track-view',
        groupId,
        templateId: template.id,
        templateTitle: template.title,
        source: resolveTrafficSource(),
        device: detectDeviceType(),
      }),
      keepalive: true,
    });
  } catch {
    // Analytics are optional and should not block the calculator.
  }
};
