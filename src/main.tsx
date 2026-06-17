const sendEarlyVkInit = () => {
  if (typeof window === 'undefined' || window.parent === window) {
    return;
  }

  try {
    window.parent.postMessage(
      {
        type: 'vk-connect',
        handler: 'VKWebAppInit',
        params: {},
      },
      '*',
    );
  } catch {
    // Ignore iframe init errors and continue with normal bootstrap.
  }
};

sendEarlyVkInit();
void import('./bootstrapApp');
