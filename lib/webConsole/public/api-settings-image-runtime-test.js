const IMAGE_RUNTIME_TEST_MAX_SOURCE_BYTES = 4 * 1024 * 1024;

function readImageRuntimeTestFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取参考图片失败。'));
    reader.readAsDataURL(file);
  });
}

function syncImageRuntimeTestOperation() {
  const operation = $('image-runtime-test-operation')?.value || 'generate';
  $('image-runtime-test-source-field')?.classList.toggle('hidden', operation !== 'edit');
}

function clearImageRuntimeTestResult() {
  const result = $('image-runtime-test-result');
  if (result) {
    result.className = 'image-runtime-test-result hidden';
    result.replaceChildren();
  }
  const status = $('image-runtime-test-status');
  if (status) status.textContent = '尚未执行';
}

function renderImageRuntimeTestResult(payload = {}) {
  const container = $('image-runtime-test-result');
  if (!container) return;
  container.replaceChildren();
  container.className = `image-runtime-test-result ${payload.success ? 'tone-success' : 'tone-failed'}`;

  const summary = document.createElement('div');
  summary.className = 'image-runtime-test-summary';
  const title = document.createElement('strong');
  title.textContent = payload.success ? '真实生图测试成功' : '真实生图测试失败';
  const meta = document.createElement('span');
  const roleText = payload.role === 'fallback' ? '备用接口' : '主接口';
  const operationText = payload.operation === 'edit' ? '图生图' : '文生图';
  meta.textContent = `${roleText} · ${operationText} · ${payload.latencyMs || 0} ms`;
  summary.append(title, meta);
  container.appendChild(summary);

  if (payload.success && payload.previewUrl) {
    const preview = document.createElement('div');
    preview.className = 'image-runtime-test-preview';
    const image = document.createElement('img');
    image.src = payload.previewUrl;
    image.alt = '真实生图测试结果';
    image.loading = 'lazy';
    preview.appendChild(image);
    container.appendChild(preview);
  }

  const details = document.createElement('div');
  details.className = 'image-runtime-test-details';
  const detailRows = [
    ['配置来源', payload.configSourceLabel || '当前页面草稿'],
    ['接口模式', payload.mode || '-'],
    ['模型', payload.model || '-'],
    ['返回类型', payload.sourceType || '-'],
    ['图片大小', payload.imageBytes ? `${(payload.imageBytes / 1024 / 1024).toFixed(2)} MB` : '-'],
    ['说明', payload.error || (payload.previewOmitted ? '图片数据过大，测试已成功但未在页面中加载预览。' : '接口已返回可用图片。')],
  ];
  for (const [label, value] of detailRows) {
    const row = document.createElement('div');
    const labelNode = document.createElement('span');
    labelNode.textContent = label;
    const valueNode = document.createElement('strong');
    valueNode.textContent = String(value || '-');
    row.append(labelNode, valueNode);
    details.appendChild(row);
  }
  container.appendChild(details);
}

async function runImageRuntimeTest() {
  const button = $('image-runtime-test-run-btn');
  const status = $('image-runtime-test-status');
  const role = $('image-runtime-test-role')?.value || 'primary';
  const operation = $('image-runtime-test-operation')?.value || 'generate';
  const prompt = String($('image-runtime-test-prompt')?.value || '').trim();
  if (!prompt) {
    showRisk('请填写真实生图测试提示词。');
    return;
  }

  let imageDataUrl = '';
  if (operation === 'edit') {
    const file = $('image-runtime-test-source')?.files?.[0];
    if (!file) {
      showRisk('图生图测试需要选择一张参考图片。');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      showRisk('参考图片只支持 PNG、JPEG 或 WebP。');
      return;
    }
    if (file.size > IMAGE_RUNTIME_TEST_MAX_SOURCE_BYTES) {
      showRisk('参考图片不能超过 4MB。');
      return;
    }
    imageDataUrl = await readImageRuntimeTestFile(file);
  }

  const confirmed = await window.CrystelfDialog.confirm(
    `即将使用${role === 'fallback' ? '备用' : '主'}接口执行一次${operation === 'edit' ? '图生图' : '文生图'}测试，可能消耗额度或产生费用。是否继续？`,
    {
      title: '确认执行真实生图测试',
      confirmText: '确认执行',
      cancelText: '取消',
    },
  );
  if (!confirmed) return;

  try {
    updateDraftFromInputs();
    if (button) button.disabled = true;
    if (status) status.textContent = '测试进行中...';
    const result = await postJson('/api/api-settings/test-image-runtime', {
      role,
      operation,
      prompt,
      imageDataUrl,
      payload: buildApiSettingsPayloadFromDraft(),
    });
    renderImageRuntimeTestResult(result);
    if (status) status.textContent = result.success ? '测试成功' : '测试失败';
    if (result.success) showSuccess('真实生图测试成功。');
    else showRisk(`真实生图测试失败：${result.error || '接口没有返回图片。'}`);
  } catch (error) {
    const result = { success: false, role, operation, error: error.message };
    renderImageRuntimeTestResult(result);
    if (status) status.textContent = '测试失败';
    showRisk(`真实生图测试失败：${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

$('image-runtime-test-operation')?.addEventListener('change', syncImageRuntimeTestOperation);
$('image-runtime-test-run-btn')?.addEventListener('click', () => {
  runImageRuntimeTest().catch(error => showRisk(`真实生图测试失败：${error.message}`));
});
$('image-runtime-test-clear-btn')?.addEventListener('click', clearImageRuntimeTestResult);
syncImageRuntimeTestOperation();
