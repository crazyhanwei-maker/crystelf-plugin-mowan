// 记忆与人设中心 API
import { createRouteUtils } from './routeUtils.js';

export function createMemoryLibraryRoutes(options = {}) {
  const {
    buildMemoryLibraryPayload,
    addMemoryPayload,
    updateMemoryPayload,
    deleteMemoryPayload,
    importKnowledgePayload,
    distillMemoriesPayload,
    distillPersonaPayload,
    distillSkillPayload,
    saveArtifactPayload,
    getArtifactPayload,
    deleteArtifactPayload,
    applyArtifactPayload,
    parseRequestBody,
    sendJson,
  } = options;
  const { rejectReadOnly, sendRouteError } = createRouteUtils(options);

  async function handle(req, res, url) {
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/memory-library')) return false;
    if (rejectReadOnly(req, res)) return true;

    try {
      if (pathname === '/api/memory-library' && req.method === 'GET') {
        sendJson(res, await buildMemoryLibraryPayload({
          sessionId: url.searchParams.get('sessionId'),
          userId: url.searchParams.get('userId'),
          query: url.searchParams.get('query'),
          kind: url.searchParams.get('kind'),
          source: url.searchParams.get('source'),
          includeDisabled: url.searchParams.get('includeDisabled') === '1',
          limit: url.searchParams.get('limit'),
        }));
        return true;
      }
      if (req.method !== 'POST') {
        return false;
      }
      const body = await parseRequestBody(req);
      if (pathname === '/api/memory-library/memories/add') {
        sendJson(res, await addMemoryPayload(body));
        return true;
      }
      if (pathname === '/api/memory-library/memories/update') {
        sendJson(res, await updateMemoryPayload(body));
        return true;
      }
      if (pathname === '/api/memory-library/memories/delete') {
        sendJson(res, await deleteMemoryPayload(body));
        return true;
      }
      if (pathname === '/api/memory-library/knowledge/import') {
        sendJson(res, await importKnowledgePayload());
        return true;
      }
      if (pathname === '/api/memory-library/distill/memories') {
        sendJson(res, await distillMemoriesPayload(body));
        return true;
      }
      if (pathname === '/api/memory-library/distill/persona') {
        sendJson(res, await distillPersonaPayload(body));
        return true;
      }
      if (pathname === '/api/memory-library/distill/skill') {
        sendJson(res, await distillSkillPayload(body));
        return true;
      }
      if (pathname === '/api/memory-library/artifacts/save') {
        sendJson(res, await saveArtifactPayload(body));
        return true;
      }
      if (pathname === '/api/memory-library/artifacts/get') {
        sendJson(res, await getArtifactPayload(body));
        return true;
      }
      if (pathname === '/api/memory-library/artifacts/delete') {
        sendJson(res, await deleteArtifactPayload(body));
        return true;
      }
      if (pathname === '/api/memory-library/artifacts/apply') {
        sendJson(res, await applyArtifactPayload(body));
        return true;
      }
      return false;
    } catch (error) {
      sendRouteError(res, error, 500);
      return true;
    }
  }

  return { handle };
}
