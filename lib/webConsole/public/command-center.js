const commandCenterState = {
  payload: null,
  requestId: 0,
  controller: null,
  bridgeSaving: false,
};

function getInitialCommandQuery() {
  try {
    return String(new URLSearchParams(window.location.search).get('q') || '').trim();
  } catch {
    return '';
  }
}

const { fetchJson, postJson } = window.CrystelfRequest || {};
const ui = window.CrystelfUi || {};

function escapeHtml(value) {
  if (typeof ui.escapeHtml === 'function') {
    return ui.escapeHtml(value);
  }
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('zh-CN').format(number);
}

function formatTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function getElement(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const element = getElement(id);
  if (element) element.textContent = text;
}

function setStatus(text, tone = 'neutral') {
  const element = getElement('command-center-status');
  if (!element) return;
  element.textContent = text;
  element.className = tone === 'error' ? 'setting-error' : 'setting-help';
}

function setBridgeStatus(text, tone = 'neutral') {
  const element = getElement('command-bridge-status');
  if (!element) return;
  element.textContent = text;
  element.className = tone === 'error' ? 'setting-error' : 'setting-help';
}

function setBridgeSaveState(saving) {
  commandCenterState.bridgeSaving = saving;
  const button = getElement('command-bridge-save-btn');
  if (!button) return;
  button.disabled = saving;
  button.textContent = saving ? '保存中...' : '保存桥接设置';
}

function setRefreshButtonState(refreshing) {
  const button = getElement('command-center-refresh-btn');
  if (!button) return;
  button.disabled = refreshing;
  button.textContent = refreshing ? '扫描中...' : '刷新命令';
}

function createAbortController() {
  return typeof AbortController === 'function' ? new AbortController() : null;
}

function replaceController() {
  try {
    commandCenterState.controller?.abort?.();
  } catch {}
  const controller = createAbortController();
  commandCenterState.controller = controller;
  return controller;
}

function getCancelableOptions(controller) {
  return controller?.signal ? { signal: controller.signal, cancelOnAbort: true } : {};
}

function isCanceled(error) {
  return window.CrystelfRequest?.isCanceled?.(error) === true || error?.code === 'REQUEST_ABORTED';
}

function renderKpiCard(title, value, detail, tone = 'neutral') {
  return `
    <div class="command-center-kpi-card tone-${escapeHtml(tone)}">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function renderKpis(summary = {}) {
  const target = getElement('command-center-kpis');
  if (!target) return;
  target.innerHTML = [
    renderKpiCard('命令总数', formatNumber(summary.total || 0), `扫描文件 ${formatNumber(summary.fileCount || 0)} 个`, 'neutral'),
    renderKpiCard('可用命令', formatNumber(summary.enabledCount || 0), `主开关关闭 ${formatNumber(summary.disabledCount || 0)} 条`, summary.disabledCount > 0 ? 'warn' : 'success'),
    renderKpiCard('模块数量', formatNumber(summary.moduleCount || 0), '按 apps 文件归类', 'neutral'),
    renderKpiCard('宽泛监听', formatNumber(summary.broadCount || 0), '可能影响命令抢占排查', summary.broadCount > 0 ? 'warn' : 'success'),
    renderKpiCard('高优先级', formatNumber(summary.highPriorityCount || 0), '优先级 >= 1000', summary.highPriorityCount > 0 ? 'warn' : 'neutral'),
    renderKpiCard('风险项', formatNumber(summary.riskCount || 0), '重复命令和宽泛规则', summary.riskCount > 0 ? 'warn' : 'success'),
  ].join('');
}

function getBridgePayload() {
  return commandCenterState.payload?.bridge || {};
}

function getBridgeSearchText() {
  return String(getElement('command-bridge-search')?.value || '').trim().toLowerCase();
}

function applyBridgeConfigInputs(config = {}) {
  const enabledInput = getElement('command-bridge-enabled');
  const timeoutInput = getElement('command-bridge-confirm-timeout');
  const lengthInput = getElement('command-bridge-max-length');
  if (enabledInput) enabledInput.checked = config.enabled === true;
  if (timeoutInput) timeoutInput.value = Number(config.confirmationTimeoutMs || 60000);
  if (lengthInput) lengthInput.value = Number(config.maxCommandLength || 200);
}

function bridgeCommandMatches(item = {}, query = '') {
  if (!query) return true;
  return [item.pluginId, item.pluginName, item.pattern, item.fnc, item.description, item.permission]
    .map(value => String(value || '').toLowerCase())
    .join('\n')
    .includes(query);
}

function renderBridgeSummary(bridge = {}) {
  const target = getElement('command-bridge-summary');
  if (!target) return;
  const summary = bridge.summary || {};
  target.innerHTML = [
    renderToneBadge(`运行时 ${bridge.available ? '可用' : '不可用'}`, bridge.available ? 'success' : 'warn'),
    renderToneBadge(`发现 ${formatNumber(summary.discovered || 0)} 条`, 'neutral'),
    renderToneBadge(`可授权 ${formatNumber(summary.eligible || 0)} 条`, 'neutral'),
    renderToneBadge(`已授权 ${formatNumber(summary.authorized || 0)} 条`, summary.authorized > 0 ? 'success' : 'neutral'),
    renderToneBadge(`需确认 ${formatNumber(summary.confirmationRequired || 0)} 条`, summary.confirmationRequired > 0 ? 'warn' : 'neutral'),
    summary.stale > 0 ? renderToneBadge(`失效授权 ${formatNumber(summary.stale)} 条`, 'warn') : '',
  ].join('');
}

function renderBridgeCommand(item = {}) {
  const disabled = item.eligible !== true;
  return `
    <label class="command-bridge-row ${disabled ? 'is-disabled' : ''}" data-bridge-id="${escapeHtml(item.id || '')}">
      <input class="command-bridge-command-toggle" type="checkbox" ${item.authorized ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      <span class="command-bridge-command">
        <strong>${escapeHtml(item.pluginName || item.pluginId || '未知插件')}</strong>
        <span>${escapeHtml(item.pluginId || '-')} · ${escapeHtml(item.fnc || '-')} · 权限 ${escapeHtml(item.permission || '所有人')}</span>
        <code>/${escapeHtml(item.pattern || '')}/</code>
        ${disabled ? `<span>${escapeHtml(item.disabledReason || '该规则不能授权')}</span>` : ''}
      </span>
      <select class="command-bridge-mode" ${disabled || !item.authorized || item.modeLocked ? 'disabled' : ''} aria-label="执行模式">
        <option value="direct" ${item.mode === 'direct' ? 'selected' : ''} ${item.modeLocked ? 'disabled' : ''}>直接执行</option>
        <option value="confirm" ${item.mode !== 'direct' ? 'selected' : ''}>二次确认</option>
      </select>
    </label>
  `;
}

function renderCommandBridge() {
  const bridge = getBridgePayload();
  const config = bridge.config || {};
  const enabledInput = getElement('command-bridge-enabled');
  renderBridgeSummary(bridge);

  const target = getElement('command-bridge-list');
  if (!target) return;
  if (!bridge.available) {
    target.innerHTML = `<div class="command-center-empty"><strong>未连接 Yunzai 插件运行时</strong><span>${escapeHtml(bridge.error || '请在实际 Bot 环境中打开控制台后再授权命令。')}</span></div>`;
    if (enabledInput) enabledInput.disabled = true;
    getElement('command-bridge-save-btn').disabled = true;
    setBridgeStatus('当前控制台未检测到 Yunzai 插件加载器，桥接保持停用。', 'warn');
    return;
  }
  if (enabledInput) enabledInput.disabled = false;
  if (!commandCenterState.bridgeSaving) getElement('command-bridge-save-btn').disabled = false;
  const query = getBridgeSearchText();
  const commands = (Array.isArray(bridge.commands) ? bridge.commands : []).filter(item => bridgeCommandMatches(item, query));
  target.innerHTML = commands.length > 0
    ? commands.map(renderBridgeCommand).join('')
    : '<div class="command-center-empty"><strong>没有匹配的运行时命令</strong><span>可以清空搜索条件后重试。</span></div>';
  setBridgeStatus(`桥接${config.enabled ? '已开启' : '已关闭'}，当前授权 ${formatNumber(bridge.summary?.authorized || 0)} 条命令。新发现命令不会自动授权。`);
}

function readBridgeDraft() {
  const bridge = getBridgePayload();
  const policies = (Array.isArray(bridge.commands) ? bridge.commands : [])
    .filter(item => item.authorized && item.eligible)
    .map(item => ({ id: item.id, enabled: true, mode: item.mode === 'direct' ? 'direct' : 'confirm' }));
  return {
    enabled: getElement('command-bridge-enabled')?.checked === true,
    confirmationTimeoutMs: Number(getElement('command-bridge-confirm-timeout')?.value || 60000),
    maxCommandLength: Number(getElement('command-bridge-max-length')?.value || 200),
    policies,
  };
}

async function saveCommandBridge() {
  if (typeof postJson !== 'function') throw new Error('控制台写入模块未加载');
  setBridgeSaveState(true);
  setBridgeStatus('正在保存桥接白名单...');
  try {
    const result = await postJson('/api/command-center/bridge', readBridgeDraft());
    const bridge = result?.data || result;
    commandCenterState.payload.bridge = bridge;
    renderCommandBridge();
    setBridgeStatus('命令桥接设置已保存。');
    return bridge;
  } catch (error) {
    setBridgeStatus(`保存失败：${error.message}`, 'error');
    throw error;
  } finally {
    setBridgeSaveState(false);
  }
}

function rebuildSelectOptions(id, values = [], labelPrefix = '全部') {
  const select = getElement(id);
  if (!select) return;
  const previous = select.value;
  const firstLabel = select.querySelector('option')?.textContent || labelPrefix;
  select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
  if (Array.from(select.options).some(option => option.value === previous)) {
    select.value = previous;
  }
}

function renderFilters(filters = {}) {
  rebuildSelectOptions('command-center-category', filters.categories || []);
  rebuildSelectOptions('command-center-module', filters.modules || []);
  rebuildSelectOptions('command-center-event', filters.events || []);
  rebuildSelectOptions('command-center-permission', filters.permissions || []);
}

function getFilterState() {
  return {
    query: String(getElement('command-center-search')?.value || '').trim().toLowerCase(),
    category: String(getElement('command-center-category')?.value || '').trim(),
    module: String(getElement('command-center-module')?.value || '').trim(),
    event: String(getElement('command-center-event')?.value || '').trim(),
    permission: String(getElement('command-center-permission')?.value || '').trim(),
    status: String(getElement('command-center-status-filter')?.value || 'all').trim(),
  };
}

function commandMatchesQuery(item = {}, query = '') {
  if (!query) return true;
  const haystack = [
    item.displayCommand,
    item.pattern,
    item.description,
    item.moduleLabel,
    item.category,
    item.fileName,
    item.fnc,
    item.pluginName,
    item.pluginDsc,
    item.permissionLabel,
    item.eventLabel,
  ].map(value => String(value || '').toLowerCase()).join('\n');
  return haystack.includes(query);
}

function commandMatchesStatus(item = {}, status = 'all') {
  if (status === 'enabled') return item.enabled === true;
  if (status === 'disabled') return item.enabled === false;
  if (status === 'broad') return item.broad === true;
  if (status === 'high') return Number(item.priority || 0) >= 1000;
  return true;
}

function filterCommands(commands = []) {
  const filters = getFilterState();
  return commands.filter(item => {
    if (!commandMatchesQuery(item, filters.query)) return false;
    if (filters.category && item.category !== filters.category) return false;
    if (filters.module && item.moduleLabel !== filters.module) return false;
    if (filters.event && item.eventLabel !== filters.event) return false;
    if (filters.permission && item.permissionLabel !== filters.permission) return false;
    if (!commandMatchesStatus(item, filters.status)) return false;
    return true;
  });
}

function renderToneBadge(text, tone = 'neutral') {
  return `<span class="command-center-badge tone-${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

function renderRiskItem(item = {}) {
  return `
    <div class="command-center-risk-item">
      <strong>${escapeHtml(item.command || '-')}</strong>
      <span>${escapeHtml(item.moduleLabel || '-')} / ${escapeHtml(item.fileName || '-')}</span>
      <small>优先级 ${escapeHtml(item.priority ?? '-')} · ${escapeHtml(item.fnc || '-')}</small>
    </div>
  `;
}

function renderRisks(risks = []) {
  const target = getElement('command-center-risks');
  if (!target) return;
  const list = Array.isArray(risks) ? risks : [];
  if (list.length === 0) {
    target.innerHTML = `
      <div class="command-center-empty">
        <strong>暂未发现明显命令风险</strong>
        <span>没有扫描到重复精确命令或需要重点关注的宽泛监听。</span>
      </div>
    `;
    return;
  }
  target.innerHTML = list.map(risk => `
    <article class="command-center-risk-card tone-${escapeHtml(risk.level || 'warning')}">
      <div class="command-center-risk-head">
        <div>
          <h3>${escapeHtml(risk.title || '风险提示')}</h3>
          <p>${escapeHtml(risk.message || '')}</p>
        </div>
        ${renderToneBadge(risk.level === 'info' ? '提示' : '注意', risk.level === 'info' ? 'neutral' : 'warn')}
      </div>
      <div class="command-center-risk-items">
        ${(risk.items || []).map(renderRiskItem).join('')}
      </div>
    </article>
  `).join('');
}

function renderCommandCard(item = {}) {
  const featureTone = item.feature?.tone || (item.enabled ? 'success' : 'disabled');
  const statusTone = item.statusTone || (item.enabled ? 'success' : 'disabled');
  return `
    <article class="command-center-command-card ${item.broad ? 'is-broad' : ''}">
      <div class="command-center-command-main">
        <div>
          <h3>${escapeHtml(item.displayCommand || item.pattern || item.fnc || '-')}</h3>
          <p>${escapeHtml(item.description || '')}</p>
        </div>
        <div class="command-center-command-badges">
          ${renderToneBadge(item.statusLabel || '可用', statusTone)}
          ${item.broad ? renderToneBadge('宽泛监听', 'warn') : ''}
          ${Number(item.priority || 0) >= 1000 ? renderToneBadge('高优先级', 'warn') : ''}
        </div>
      </div>
      <div class="command-center-command-meta">
        <span>模块：${escapeHtml(item.moduleLabel || '-')}</span>
        <span>分类：${escapeHtml(item.category || '-')}</span>
        <span>事件：${escapeHtml(item.eventLabel || '-')}</span>
        <span>权限：${escapeHtml(item.permissionLabel || '-')}</span>
        <span>优先级：${escapeHtml(item.priority ?? '-')}</span>
        <span>函数：${escapeHtml(item.fnc || '-')}</span>
        <span>文件：${escapeHtml(item.filePath || item.fileName || '-')}</span>
      </div>
      <div class="command-center-command-pattern">
        <span>匹配规则</span>
        <code>${escapeHtml(item.pattern || item.kind || '-')}</code>
      </div>
      <div class="command-center-command-foot">
        ${renderToneBadge(item.feature?.label || '模块开关', featureTone)}
        <span>${escapeHtml(item.feature?.stateLabel || '随模块启用')}</span>
      </div>
    </article>
  `;
}

function renderCommandTable(items = []) {
  return `
    <div class="command-center-table-wrap">
      <table class="command-center-table">
        <thead>
          <tr>
            <th>命令</th>
            <th>模块</th>
            <th>事件</th>
            <th>权限</th>
            <th>优先级</th>
            <th>状态</th>
            <th>函数</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr class="${item.broad ? 'is-broad' : ''}">
              <td>
                <strong>${escapeHtml(item.displayCommand || item.pattern || '-')}</strong>
                <small>${escapeHtml(item.description || '')}</small>
                <code>${escapeHtml(item.pattern || '-')}</code>
              </td>
              <td>
                <strong>${escapeHtml(item.moduleLabel || '-')}</strong>
                <small>${escapeHtml(item.filePath || item.fileName || '-')}</small>
              </td>
              <td>${escapeHtml(item.eventLabel || '-')}</td>
              <td>${escapeHtml(item.permissionLabel || '-')}</td>
              <td>${escapeHtml(item.priority ?? '-')}</td>
              <td>${renderToneBadge(item.statusLabel || '可用', item.statusTone || 'success')}</td>
              <td><code>${escapeHtml(item.fnc || '-')}</code></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderCommandList() {
  const payload = commandCenterState.payload || {};
  const commands = Array.isArray(payload.commands) ? payload.commands : [];
  const filtered = filterCommands(commands);
  const target = getElement('command-center-list');
  if (!target) return;
  setText('command-center-list-meta', `当前显示 ${formatNumber(filtered.length)} 条 / 总计 ${formatNumber(commands.length)} 条命令`);
  if (filtered.length === 0) {
    target.innerHTML = `
      <div class="command-center-empty">
        <strong>没有匹配的命令</strong>
        <span>可以清空筛选，或换一个关键词再查。</span>
      </div>
    `;
    return;
  }
  target.innerHTML = `
    ${renderCommandTable(filtered)}
    <div class="command-center-card-list">
      ${filtered.map(renderCommandCard).join('')}
    </div>
  `;
}

function renderScanErrors(errors = []) {
  const panel = getElement('command-center-scan-error-panel');
  const target = getElement('command-center-scan-errors');
  if (!panel || !target) return;
  const list = Array.isArray(errors) ? errors : [];
  panel.classList.toggle('hidden', list.length === 0);
  target.innerHTML = list.map(item => `
    <div class="command-center-scan-error">
      <strong>${escapeHtml(item.fileName || '未知文件')}</strong>
      <span>${escapeHtml(item.error || '读取失败')}</span>
    </div>
  `).join('');
}

function renderSource(data = {}) {
  const source = data.source || {};
  const target = getElement('command-center-source');
  if (!target) return;
  target.innerHTML = `
    <div class="command-center-source-item">
      <span>扫描目录</span>
      <strong>${escapeHtml(source.appsDir || 'apps')}</strong>
    </div>
    <div class="command-center-source-item">
      <span>扫描方式</span>
      <strong>${escapeHtml(source.scanMode === 'static' ? '静态扫描' : source.scanMode || '未知')}</strong>
    </div>
    <div class="command-center-source-note">${escapeHtml(source.note || '不会执行插件代码。')}</div>
  `;
}

function renderPayload(data = {}) {
  commandCenterState.payload = data;
  renderKpis(data.summary || {});
  renderFilters(data.filters || {});
  renderRisks(data.risks || []);
  renderSource(data);
  renderScanErrors(data.scanErrors || []);
  renderCommandList();
  applyBridgeConfigInputs(data.bridge?.config || {});
  renderCommandBridge();
  setText('command-center-meta', `扫描完成：${formatNumber(data.summary?.total || 0)} 条命令，生成时间 ${formatTime(data.generatedAt)}`);
  setStatus(`最近扫描：${formatTime(data.generatedAt)}。静态命令列表只读；桥接设置只保存人工授权白名单。`);
}

function setLoading() {
  getElement('command-center-kpis').innerHTML = renderKpiCard('扫描中', '...', '正在读取命令声明', 'neutral');
  getElement('command-center-risks').innerHTML = '<div class="setting-help">正在分析命令风险...</div>';
  getElement('command-center-list').innerHTML = '<div class="setting-help">正在加载命令列表...</div>';
  setText('command-center-list-meta', '等待扫描完成。');
  setStatus('正在扫描 apps 目录中的命令声明...');
}

async function refreshCommandCenter() {
  if (typeof fetchJson !== 'function') {
    throw new Error('控制台请求模块未加载');
  }
  const requestId = ++commandCenterState.requestId;
  const controller = replaceController();
  setRefreshButtonState(true);
  setLoading();
  const startedAt = Date.now();
  try {
    const result = await fetchJson('/api/command-center', getCancelableOptions(controller));
    if (requestId !== commandCenterState.requestId) return null;
    const data = result?.data || result;
    renderPayload(data);
    setStatus(`扫描完成，用时 ${Date.now() - startedAt} ms。静态扫描只读，桥接授权需要手动保存。`);
    return data;
  } catch (error) {
    if (requestId !== commandCenterState.requestId || isCanceled(error)) return null;
    setText('command-center-meta', '命令中心加载失败');
    setStatus(`加载失败：${error.message}`, 'error');
    getElement('command-center-list').innerHTML = `<div class="setting-error">${escapeHtml(error.message)}</div>`;
    throw error;
  } finally {
    if (requestId === commandCenterState.requestId) {
      commandCenterState.controller = null;
      setRefreshButtonState(false);
    }
  }
}

function resetFilters() {
  ['command-center-search', 'command-center-category', 'command-center-module', 'command-center-event', 'command-center-permission'].forEach(id => {
    const element = getElement(id);
    if (element) element.value = '';
  });
  const status = getElement('command-center-status-filter');
  if (status) status.value = 'all';
  renderCommandList();
}

function bindEvents() {
  getElement('command-center-refresh-btn')?.addEventListener('click', () => {
    refreshCommandCenter().catch(error => webConsoleAlert(error.message));
  });
  getElement('command-center-reset-btn')?.addEventListener('click', resetFilters);
  ['command-center-search', 'command-center-category', 'command-center-module', 'command-center-event', 'command-center-permission', 'command-center-status-filter'].forEach(id => {
    getElement(id)?.addEventListener('input', renderCommandList);
    getElement(id)?.addEventListener('change', renderCommandList);
  });
  getElement('command-bridge-search')?.addEventListener('input', renderCommandBridge);
  getElement('command-bridge-save-btn')?.addEventListener('click', () => {
    saveCommandBridge().catch(error => webConsoleAlert(error.message));
  });
  getElement('command-bridge-list')?.addEventListener('change', event => {
    const row = event.target.closest?.('[data-bridge-id]');
    const id = row?.dataset?.bridgeId;
    const command = getBridgePayload().commands?.find(item => item.id === id);
    if (!command) return;
    if (event.target.classList.contains('command-bridge-command-toggle')) {
      command.authorized = event.target.checked === true;
      command.mode = command.mode || command.defaultMode || 'confirm';
      row.querySelector('.command-bridge-mode').disabled = !command.authorized || command.modeLocked === true;
    }
    if (event.target.classList.contains('command-bridge-mode')) {
      command.mode = event.target.value === 'direct' ? 'direct' : 'confirm';
    }
    const summary = getBridgePayload().summary || {};
    summary.authorized = getBridgePayload().commands.filter(item => item.authorized).length;
    summary.confirmationRequired = getBridgePayload().commands.filter(item => item.authorized && item.mode === 'confirm').length;
    renderBridgeSummary(getBridgePayload());
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const initialQuery = getInitialCommandQuery();
  const searchInput = getElement('command-center-search');
  if (initialQuery && searchInput) {
    searchInput.value = initialQuery;
  }
  bindEvents();
  refreshCommandCenter().catch(error => {
    document.body.innerHTML = `<pre>命令中心初始化失败：${escapeHtml(error.message)}</pre>`;
  });
});
