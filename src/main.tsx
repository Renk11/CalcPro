import bridge from '@vkontakte/vk-bridge';

const initializeVkBridge = async () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (bridge.isWebView()) {
      await bridge.send('VKWebAppInit');
    }
  } catch {
    // Keep loading the app even if the VK container rejects init.
  }
};

void initializeVkBridge();
void import('./bootstrapApp');
