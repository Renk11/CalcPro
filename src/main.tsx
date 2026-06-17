import bridge from '@vkontakte/vk-bridge';

void bridge.send('VKWebAppInit').catch(() => undefined);
void import('./bootstrapApp');
