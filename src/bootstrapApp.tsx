import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, AdaptivityProvider, AppRoot } from '@vkontakte/vkui';
import '@vkontakte/vkui/dist/cssm/styles/themes.css';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement) {
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
