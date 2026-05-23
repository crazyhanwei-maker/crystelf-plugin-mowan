function renderLocalMemeScan() {
  const meta = $('meme-local-scan-meta');
  const box = $('meme-local-scan-result');
  if (!meta || !box) return;

  const data = apiSettingsState.localMemeScan;
  if (!data) {
    meta.textContent = '尚未扫描';
    box.textContent = '点击“扫描本地目录”后，可查看角色、情绪目录和图片数量。';
    return;
  }

  if (data.pending) {
    meta.textContent = '扫描中...';
    box.textContent = '正在读取本地表情目录，请稍候。';
    return;
  }

  if (data.success === false) {
    meta.textContent = `扫描失败: ${data.error || '未知错误'}`;
    box.textContent = JSON.stringify(data, null, 2);
    return;
  }

  const summary = data.summary || {};
  const exists = data.exists !== false;
  const baseDir = data.resolvedBaseDir || apiSettingsState.draft['ai.memeConfig.localBaseDir'] || 'data/chat/meme';
  meta.textContent = exists
    ? `已扫描 ${summary.characterCount || 0} 个角色 / ${summary.totalImages || 0} 张图片`
    : '目录不存在或没有可用图片';
  box.textContent = JSON.stringify({
    resolvedBaseDir: baseDir,
    exists,
    summary,
    characters: data.characters || data.items || [],
  }, null, 2);
}

function getRecommendedMemeCharacter() {
  const memeConfig = apiSettingsState.config?.ai?.memeConfig || {};
  return String(
    memeConfig.character
    || memeConfig.defaultCharacter
    || memeConfig.personaCardName
    || memeConfig.botNickname
    || '机器人'
  ).trim() || '机器人';
}

function applyMemeTestDefaults() {
  const memeConfig = apiSettingsState.config?.ai?.memeConfig || {};
  const characterInput = $('meme-test-character');
  const emotionInput = $('meme-test-emotion');
  const pullCountInput = $('meme-pull-count');
  const recommendedCharacter = getRecommendedMemeCharacter();

  if (characterInput instanceof HTMLInputElement && !characterInput.value.trim()) {
    characterInput.placeholder = `例如：${recommendedCharacter}`;
    characterInput.value = recommendedCharacter;
  }

  if (emotionInput instanceof HTMLInputElement && !emotionInput.value.trim()) {
    const defaultEmotion = Array.isArray(memeConfig.availableEmotions) && memeConfig.availableEmotions.length > 0
      ? memeConfig.availableEmotions[0]
      : 'default';
    emotionInput.value = String(defaultEmotion || 'default').trim() || 'default';
  }

  if (pullCountInput instanceof HTMLInputElement && !pullCountInput.value.trim()) {
    pullCountInput.value = '1';
  }
}

function renderMemeTestResult() {
  const meta = $('meme-test-meta');
  const box = $('meme-test-result');
  if (!meta || !box) return;

  const data = apiSettingsState.memeTestResult;
  if (!data) {
    meta.textContent = '尚未测试';
    box.textContent = '点击“测试发图链路”后，可以看到远程图片是否可用、本地是否有备用图片，以及最终会从哪里发图。';
    return;
  }

  meta.textContent = data.detail || (data.success ? '测试完成' : '测试失败');
  box.textContent = [
    `角色: ${data.character || 'N/A'}`,
    `请求情绪: ${data.requestedEmotion || 'N/A'}`,
    `候选情绪: ${(data.emotionCandidates || []).join(', ') || 'N/A'}`,
    `远程 API: ${data.remote?.configured ? (data.remoteUsable ? '可用' : '不可用') : '未配置'}`,
    `远程 URL: ${data.remote?.resolvedUrl || 'N/A'}`,
    `远程探测: ${data.remote?.reachable
      ? `HTTP ${data.remote?.httpStatus || 200} / ${data.remote?.contentType || 'image/*'} / ${data.remote?.latencyMs || 0}ms`
      : (data.remote?.error || '失败')}`,
    `本地兜底: ${data.localUsable ? '可用' : (data.local?.enabled ? '未命中' : '已关闭')}`,
    `本地目录: ${data.local?.resolvedBaseDir || 'N/A'}`,
    `本地文件: ${data.local?.candidatePath || 'N/A'}`,
    `最终来源: ${data.final?.source || 'none'}`,
    `最终资源: ${data.final?.imagePath || 'N/A'}`,
    `结论: ${data.detail || data.error || 'N/A'}`,
  ].join('\n');
}

function renderMemePullResult() {
  const meta = $('meme-pull-meta');
  const box = $('meme-pull-result');
  if (!meta || !box) return;

  const data = apiSettingsState.memePullResult;
  if (!data) {
    meta.textContent = '尚未拉取';
    box.textContent = '点击“拉取到本地”后，会把远程表情图保存到本地目录，并显示每张图保存到了哪里。';
    return;
  }

  if (data.pending) {
    meta.textContent = '拉取中...';
    box.textContent = '正在从远程表情服务下载并写入本地目录。';
    return;
  }

  meta.textContent = data.detail || (data.success ? '拉取完成' : '拉取失败');
  box.textContent = [
    `角色: ${data.character || 'N/A'}`,
    `请求情绪: ${data.requestedEmotion || 'default'}`,
    `请求数量: ${data.requestedCount || 0}`,
    `保存数量: ${data.savedCount || 0}`,
    `本地目录: ${data.local?.resolvedBaseDir || 'N/A'}`,
    `结果说明: ${data.detail || data.error || 'N/A'}`,
    ...(data.warning ? [`警告: ${data.warning}`] : []),
    '',
    ...(Array.isArray(data.items) && data.items.length > 0
      ? data.items.flatMap((item, index) => ([
          `#${index + 1} ${item.fileName || 'unnamed'}`,
          `情绪: ${item.emotion || 'default'}`,
          `来源: ${item.sourceUrl || 'N/A'}`,
          `保存位置: ${item.filePath || 'N/A'}`,
          `大小: ${item.bytes || 0} bytes`,
          '',
        ]))
      : ['没有保存任何图片。', '']),
    ...(Array.isArray(data.errors) && data.errors.length > 0 ? ['错误列表:', ...data.errors] : []),
  ].join('\n').trim();
}

async function scanLocalMemeDirectory() {
  const payload = {
    localEnabled: apiSettingsState.draft['ai.memeConfig.localEnabled'],
    preferLocal: apiSettingsState.draft['ai.memeConfig.preferLocal'],
    localBaseDir: apiSettingsState.draft['ai.memeConfig.localBaseDir'],
  };

  apiSettingsState.localMemeScan = {
    pending: true,
    resolvedBaseDir: payload.localBaseDir || 'data/chat/meme',
  };
  renderLocalMemeScan();

  try {
    const result = await postJson('/api/api-settings/meme-local-scan', payload);
    apiSettingsState.localMemeScan = result;
    renderLocalMemeScan();
    if (result.success !== false) {
      showSuccess(result.exists
        ? `本地表情目录扫描完成：${result.summary?.characterCount || 0} 个角色`
        : '扫描完成：当前目录不存在或还没有图片');
    }
  } catch (error) {
    apiSettingsState.localMemeScan = {
      success: false,
      error: error.message,
    };
    renderLocalMemeScan();
    showRisk(`本地目录扫描失败: ${error.message}`);
  }
}

async function refreshLocalMemeScanSilently() {
  try {
    apiSettingsState.localMemeScan = await postJson('/api/api-settings/meme-local-scan', {
      localEnabled: apiSettingsState.draft['ai.memeConfig.localEnabled'],
      preferLocal: apiSettingsState.draft['ai.memeConfig.preferLocal'],
      localBaseDir: apiSettingsState.draft['ai.memeConfig.localBaseDir'],
    });
  } catch {
    apiSettingsState.localMemeScan = null;
  }
  renderLocalMemeScan();
}

function buildMemeTestPayload() {
  return {
    apiBase: apiSettingsState.draft['ai.memeConfig.apiBase'],
    localEnabled: apiSettingsState.draft['ai.memeConfig.localEnabled'],
    preferLocal: apiSettingsState.draft['ai.memeConfig.preferLocal'],
    localBaseDir: apiSettingsState.draft['ai.memeConfig.localBaseDir'],
    character: $('meme-test-character')?.value?.trim() || '',
    emotion: $('meme-test-emotion')?.value?.trim() || '',
  };
}

function buildMemePullPayload() {
  return {
    apiBase: apiSettingsState.draft['ai.memeConfig.apiBase'],
    localEnabled: apiSettingsState.draft['ai.memeConfig.localEnabled'],
    preferLocal: apiSettingsState.draft['ai.memeConfig.preferLocal'],
    localBaseDir: apiSettingsState.draft['ai.memeConfig.localBaseDir'],
    character: $('meme-test-character')?.value?.trim() || '',
    emotion: $('meme-test-emotion')?.value?.trim() || '',
    count: Math.min(readNumberInput('meme-pull-count', 1), 20),
  };
}

async function runMemeDeliveryTest() {
  try {
    updateDraftFromInputs();
    applyMemeTestDefaults();
    apiSettingsState.memeTestResult = null;
    renderMemeTestResult();
    showSuccess('正在测试表情发图链路...');
    updateStatusBadge('meme', 'testing');

    const result = await testMemeApi(buildMemeTestPayload());
    apiSettingsState.memeTestResult = result;
    apiSettingsState.testResults.meme = result;
    renderMemeTestResult();

    if (result.remoteUsable) {
      showSuccess(`表情 API 可用: ${result.detail}`);
      updateStatusBadge('meme', 'connected');
    } else if (result.localUsable) {
      showRisk(`远程不可用，但本地兜底可用: ${result.detail}`);
      updateStatusBadge('meme', 'warning');
    } else {
      showRisk(`表情发图链路不可用: ${result.error || result.detail || '未知错误'}`);
      updateStatusBadge('meme', 'failed');
    }
  } catch (error) {
    apiSettingsState.memeTestResult = {
      success: false,
      error: error.message,
      detail: error.message,
    };
    renderMemeTestResult();
    showRisk(`表情发图链路测试失败: ${error.message}`);
    updateStatusBadge('meme', 'failed');
  }
}

async function runMemePullToLocal() {
  try {
    updateDraftFromInputs();
    applyMemeTestDefaults();
    apiSettingsState.memePullResult = { pending: true };
    renderMemePullResult();
    showSuccess('正在从远程表情 API 拉取图片到本地...');

    const result = await pullMemeApi(buildMemePullPayload());
    apiSettingsState.memePullResult = result;
    renderMemePullResult();

    if (result.success) {
      await refreshLocalMemeScanSilently();
      updateStatusBadge('meme', 'connected');
      showSuccess(`表情图已保存到本地: ${result.detail}`);
    } else {
      updateStatusBadge('meme', 'failed');
      showRisk(`表情图拉取失败: ${result.error || result.detail || '未知错误'}`);
    }
  } catch (error) {
    apiSettingsState.memePullResult = {
      success: false,
      error: error.message,
      detail: error.message,
      errors: [error.message],
    };
    renderMemePullResult();
    updateStatusBadge('meme', 'failed');
    showRisk(`表情图拉取失败: ${error.message}`);
  }
}

async function testMemeApi(payload = null) {
  try {
    if (payload) {
      return await postJson('/api/api-settings/test-meme', payload);
    }
    return await fetchJson('/api/api-settings/test-meme');
  } catch (error) {
    return { success: false, error: `测试接口不可用：${error.message || '未知错误'}` };
  }
}

async function pullMemeApi(payload) {
  try {
    return await postJson('/api/api-settings/meme-pull', payload);
  } catch (error) {
    return { success: false, error: `拉取接口不可用：${error.message || '未知错误'}` };
  }
}
