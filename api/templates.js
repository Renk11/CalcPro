import { sendJson } from '../server/http.js';
import { getServerTemplates, saveServerTemplates } from '../server/template-store.js';

export default async function handler(request, response) {
  try {
    if (request.method === 'GET') {
      const templates = await getServerTemplates();
      return sendJson(response, 200, { ok: true, data: templates });
    }

    if (request.method === 'POST') {
      const incomingTemplates = request.body;
      if (!Array.isArray(incomingTemplates)) {
        return sendJson(response, 400, { ok: false, error: 'Templates payload must be an array' });
      }

      const templates = await saveServerTemplates(incomingTemplates);
      return sendJson(response, 200, { ok: true, data: templates });
    }

    return sendJson(response, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('templates api error', error);
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || 'Templates request failed',
    });
  }
}
