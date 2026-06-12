import { sendJson } from '../server/http.js';
import { getServerTemplates, saveServerTemplates } from '../server/template-store.js';

function parseGroupId(rawValue) {
  const groupId = Number(rawValue);
  return Number.isInteger(groupId) && groupId > 0 ? groupId : 0;
}

export default async function handler(request, response) {
  try {
    const groupId = parseGroupId(request.query?.groupId || request.body?.groupId);

    if (request.method === 'GET') {
      const templates = await getServerTemplates(groupId);
      return sendJson(response, 200, { ok: true, data: templates });
    }

    if (request.method === 'POST') {
      const incomingTemplates = Array.isArray(request.body)
        ? request.body
        : request.body?.templates;
      if (!Array.isArray(incomingTemplates)) {
        return sendJson(response, 400, { ok: false, error: 'Templates payload must be an array' });
      }

      const templates = await saveServerTemplates(incomingTemplates, groupId);
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
