import { sendJson } from '../server/http.js';
import { getServerAdminSettings, saveServerAdminSettings } from '../server/settings-store.js';

export default async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      const settings = await getServerAdminSettings();
      return sendJson(response, 200, { ok: true, data: settings });
    }

    if (request.method === 'POST') {
      const currentSettings = await getServerAdminSettings();
      const incomingSettings = request.body || {};
      const settings = await saveServerAdminSettings({
        ...currentSettings,
        managerVkId: incomingSettings.managerVkId ?? currentSettings.managerVkId,
        subscription: currentSettings.subscription,
      });
      return sendJson(response, 200, { ok: true, data: settings });
    }

    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('admin-settings api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Failed to process admin settings',
    });
  }
}
