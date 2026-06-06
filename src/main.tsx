import React from 'react';
import ReactDOM from 'react-dom/client';
import bridge from '@vkontakte/vk-bridge';
import { ConfigProvider, AdaptivityProvider, AppRoot } from '@vkontakte/vkui';
import '@vkontakte/vkui/dist/cssm/styles/themes.css';
import App from './App';
import './styles.css';

bridge.send('VKWebAppInit').catch(() => undefined);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
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
