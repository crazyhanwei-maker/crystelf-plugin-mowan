import { createRouteUtils } from './routeUtils.js';

export function createSettingsRoutes(options = {}) {
  const {
    buildApiSettingsPayload,
    buildEditableConfigPayload,
    buildFeatureToggleHelpPreviewPayload,
    buildLocalMemeScanPayload,
    buildOverviewPayload,
    buildPluginSettingsPayload,
    buildPrivateAiSafetyPayload,
    buildSkillConfigEditorPayload,
    ConfigControl,
    generateKnowledgeBaseFromWebPayload,
    getHttpErrorStatus,
    getSkillSecretSourceConfigs,
    logger,
    manageFeatureToggle,
    parseRequestBody,
    precheckApiSettings,
    precheckPluginSettings,
    clearPrivateAiSafetyRecordsPayload,
    clearPrivateAiSafetyReviewCachePayload,
    pullRemoteMemeToLocal,
    restoreMaskedSkillConfigSecrets,
    saveApiSettings,
    saveEditableConfig,
    savePluginSettings,
    sendJson,
    testApiTargetConnection,
    testApiConnection,
    testImageApiConnection,
    testImageGenerationRuntime,
    testImageMonitorApiConnection,
    testMemeApiConnection,
    testSearchApiConnection,
    toggleFeatureState,
    unblockPrivateAiSafetyPayload,
    validateSkillConfigPayload,
  } = options;

  const routeUtils = createRouteUtils(options);

  function rejectReadOnly(res, bootstrapMode = false) {
    return routeUtils.rejectReadOnly(res, { allowBootstrap: bootstrapMode });
  }

  async function handle(req, res, url, context = {}) {
    const bootstrapMode = context.bootstrapMode === true;
    if (url.pathname === '/api/config/editable') {
      sendJson(res, buildEditableConfigPayload());
      return true;
    }
    if (url.pathname === '/api/plugin-settings') {
      if (rejectReadOnly(res, bootstrapMode)) return true;
      sendJson(res, await buildPluginSettingsPayload());
      return true;
    }
    if (url.pathname === '/api/api-settings') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, buildApiSettingsPayload());
      return true;
    }
    if (url.pathname === '/api/api-settings/precheck' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, precheckApiSettings(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/api-settings/save' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const saved = await saveApiSettings(body);
        sendJson(res, { success: true, data: saved });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/api-settings/test') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, await testApiConnection());
      return true;
    }
    if (url.pathname === '/api/api-settings/test-target') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = req.method === 'POST' ? await parseRequestBody(req) : {};
        const target = body?.target || url.searchParams.get('target') || 'ai-main';
        const role = body?.role || url.searchParams.get('role') || 'primary';
        sendJson(res, await testApiTargetConnection(target, role, body?.payload || body?.draft || null));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/api-settings/test-image') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, await testImageApiConnection());
      return true;
    }
    if (url.pathname === '/api/api-settings/test-image-runtime' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await testImageGenerationRuntime(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/api-settings/test-image-monitor') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, await testImageMonitorApiConnection());
      return true;
    }
    if (url.pathname === '/api/api-settings/test-search') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, await testSearchApiConnection());
      return true;
    }
    if (url.pathname === '/api/api-settings/test-meme' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await testMemeApiConnection(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/api-settings/test-meme') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, await testMemeApiConnection({
        character: url.searchParams.get('character'),
        emotion: url.searchParams.get('emotion'),
      }));
      return true;
    }
    if (url.pathname === '/api/api-settings/meme-local-scan' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await buildLocalMemeScanPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/api-settings/meme-pull' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await pullRemoteMemeToLocal(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/knowledge-generate' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await generateKnowledgeBaseFromWebPayload(body));
      } catch (error) {
        logger.error(`[knowledge-generate] failed: ${error.stack || error.message}`);
        sendJson(
          res,
          { success: false, error: error.message, code: error.code || '' },
          getHttpErrorStatus(error, 500),
        );
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/skills-config') {
      if (rejectReadOnly(res)) return true;
      sendJson(res, { success: true, data: buildSkillConfigEditorPayload() });
      return true;
    }
    if (url.pathname === '/api/plugin-settings/skills-config/validate' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const config = validateSkillConfigPayload(body?.config || {});
        const definitions = Array.isArray(config.definitions) ? config.definitions : [];
        const toolCount = definitions.reduce((sum, item) => sum + (Array.isArray(item?.tools) ? item.tools.length : 0), 0);
        sendJson(res, {
          success: true,
          data: {
            config,
            summary: {
              definitionCount: definitions.length,
              toolCount,
            },
          },
        });
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/skills-config/save' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const sourceConfigs = getSkillSecretSourceConfigs(body?.source);
        const restoredConfig = restoreMaskedSkillConfigSecrets(body?.config || {}, sourceConfigs);
        const config = validateSkillConfigPayload(restoredConfig);
        await ConfigControl.set('skills', config);
        sendJson(res, {
          success: true,
          data: buildSkillConfigEditorPayload(),
          settings: await buildPluginSettingsPayload(),
        });
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/skills-config/reset' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        await ConfigControl.set('skills', {});
        sendJson(res, {
          success: true,
          data: buildSkillConfigEditorPayload(),
          settings: await buildPluginSettingsPayload(),
        });
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/private-ai-safety') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, await buildPrivateAiSafetyPayload());
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/private-ai-safety/unblock' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await unblockPrivateAiSafetyPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/private-ai-safety/clear-records' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, await clearPrivateAiSafetyRecordsPayload(body));
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/private-ai-safety/clear-cache' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, await clearPrivateAiSafetyReviewCachePayload());
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/config/save' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const saved = await saveEditableConfig(body);
        sendJson(res, { success: true, data: saved });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/precheck' && req.method === 'POST') {
      if (rejectReadOnly(res, bootstrapMode)) return true;
      try {
        const body = await parseRequestBody(req);
        sendJson(res, precheckPluginSettings({
          ...body,
          bootstrapMode,
        }));
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/save' && req.method === 'POST') {
      if (rejectReadOnly(res, bootstrapMode)) return true;
      try {
        const body = await parseRequestBody(req);
        const saved = await savePluginSettings({
          ...body,
          bootstrapMode,
        });
        sendJson(res, { success: true, data: saved });
      } catch (error) {
        sendJson(res, { success: false, error: error.message, code: error.code || '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/feature-manage' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        const result = await manageFeatureToggle(String(body?.action || ''));
        sendJson(res, { success: true, data: result, settings: await buildPluginSettingsPayload(), overview: buildOverviewPayload() });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    if (url.pathname === '/api/plugin-settings/help-preview') {
      if (rejectReadOnly(res)) return true;
      try {
        sendJson(res, { success: true, data: await buildFeatureToggleHelpPreviewPayload() });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/features/toggle' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const body = await parseRequestBody(req);
        if (!body.feature || typeof body.enabled !== 'boolean') {
          sendJson(res, { success: false, error: 'Bad request' }, 400);
          return true;
        }
        await toggleFeatureState(String(body.feature), body.enabled);
        sendJson(res, { success: true, features: buildOverviewPayload().features });
      } catch (error) {
        sendJson(res, { success: false, error: error.message }, 500);
      }
      return true;
    }
    if (url.pathname === '/api/tts/models/refresh' && req.method === 'POST') {
      if (rejectReadOnly(res)) return true;
      try {
        const { refreshTtsModelsAndGetSummary } = await import('../ai/ttsRegistry.js');
        const result = await refreshTtsModelsAndGetSummary();
        sendJson(res, {
          success: Boolean(result?.success),
          error: result?.success ? '' : (result?.error || '刷新失败'),
          count: result?.count || 0,
          summary: result?.summary || '',
        });
      } catch (error) {
        logger.error(`[tts-models-refresh] failed: ${error.stack || error.message}`);
        sendJson(res, { success: false, error: error.message, count: 0, summary: '' }, getHttpErrorStatus(error, 500));
      }
      return true;
    }
    return false;
  }

  return {
    handle,
  };
}
