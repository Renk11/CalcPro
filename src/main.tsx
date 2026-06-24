import bridge from '@vkontakte/vk-bridge';

const BRIDGE_INIT_TIMEOUT_MS = 1500;

const initializeVkBridge = async () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    await Promise.race([
      bridge.send('VKWebAppInit'),
      new Promise((resolve) => window.setTimeout(resolve, BRIDGE_INIT_TIMEOUT_MS)),
    ]);
  } catch {
    // Keep loading the app even if the VK container rejects init.
  }
};

void initializeVkBridge();
void import('./bootstrapApp');
