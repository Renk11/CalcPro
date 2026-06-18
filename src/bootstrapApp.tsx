import React from 'react';
import ReactDOM from 'react-dom/client';
import bridge from '@vkontakte/vk-bridge';
import { ConfigProvider, AdaptivityProvider, AppRoot } from '@vkontakte/vkui';
import '@vkontakte/vkui/dist/cssm/styles/themes.css';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');

const initializeVkBridge = async () => {
  if (typeof window === 'undefined' || !bridge.isEmbedded()) {
    return;
  }

  try {
    await bridge.send('VKWebAppInit');
  } catch {
    // Keep rendering even if the host container rejects init.
  }
};

if (rootElement) {
  void initializeVkBridge();
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ConfigProvider appearance="light">
        <AdaptivityProvider>
          <AppRoot>
            <App />
          </AppRoot>
        </AdaptivityProvider>
      </ConfigProvider>
    </React.StrictMode>,
  );
}
