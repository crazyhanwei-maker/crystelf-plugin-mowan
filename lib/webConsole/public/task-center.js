(function () {
  const ui = window.CrystelfUi || {};

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    if (typeof ui.escapeHtml === 'function') return ui.escapeHtml(value);
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(value) {
    const time = new Date(value || 0);
    if (!value || Number.isNaN(time.getTime())) return '—';
    return time.toLocaleString('zh-CN', { hour12: false });
  }

  function formatRelative(value) {
    const time = new Date(value || 0).getTime();
    if (!value || !Number.isFinite(time)) return '—';
    const diff = time - Date.now();
    const abs = Math.abs(diff);
    const minutes = Math.round(abs / 60000);
    const label = minutes < 60 ? `${minutes} 分钟` : `${Math.round(minutes / 60)} 小时`;
    return diff >= 0 ? `约 ${label}后` : `约 ${label}前`;
  }

  let refreshController = null;
  let runningAction = '';

  async function fetchJson(url, init) {
    const response = await fetch(url, { cache: 'no-store', ...init });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `${url} -> ${response.status}`);
    }
    return data;
  }

  function renderRecentRuns(task) {
    const runs = Array.isArray(task.recentRuns) ? task.recentRuns : [];
    if (!runs.length) return '';
    const lines = runs.slice(0, 3).map(run => {
      const tone = String(run.status || '') === 'failed' ? 'tone-failed' : 'tone-sent';
      return `<span>${escapeHtml(formatTime(run.time))} · 群 ${escapeHtml(run.groupName || run.groupId)} · <strong class="${tone}">${escapeHtml(run.status || '-')}</strong></span>`;
    }).join('');
    return `<div class="task-center-recent"><span class="task-center-meta-line">最近执行：</span>${lines}</div>`;
  }

  function renderTaskCard(task) {
    const stateClass = String(task.status || '').startsWith('en') ? 'is-enabled' : 'is-disabled';
    const detailFacts = Object.entries(task.detail || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => {
        const labels = {
          enabledGroups: '启用范围',
          sentToday: '今日已发送',
          failedToday: '今日失败',
          retentionDays: '保留天数',
          feedCount: '订阅源数',
        };
        const label = labels[key] || key;
        const text = key === 'enabledGroups'
          ? String(value)
          : key === 'feedCount'
            ? `${value} 个`
            : key === 'retentionDays'
              ? `${value} 天`
              : `${value} 次`;
        return `<span>${label} <b>${escapeHtml(text)}</b></span>`;
      })
      .join('');
    const manual = task.manual?.supported
      ? `<button type="button" class="mini-btn task-center-run-btn" data-action="${escapeHtml(task.manual.action)}" ${runningAction === task.manual.action ? 'disabled' : ''}>${escapeHtml(task.manual.label)}</button>`
      : '';
    const nextRun = task.nextRunAt
      ? `<span class="next-run">下次运行：${escapeHtml(formatTime(task.nextRunAt))}（${escapeHtml(formatRelative(task.nextRunAt))}）</span>`
      : '';
    return `
      <div class="task-center-card ${task.status === 'enabled' ? '' : 'is-disabled'}">
        <div class="task-center-card-main">
          <div class="task-center-card-head">
            <strong>${escapeHtml(task.name || task.id)}</strong>
            <span class="task-center-state ${stateClass}">${escapeHtml(task.statusLabel || '-')}</span>
            <span class="task-center-meta-line">${escapeHtml(task.schedule || '')}</span>
          </div>
          <div class="task-center-card-desc">${escapeHtml(task.description || '')}</div>
          ${detailFacts ? `<div class="task-center-card-facts">${detailFacts}</div>` : ''}
          ${renderRecentRuns(task)}
        </div>
        <div class="task-center-card-actions">
          ${nextRun}
          ${manual}
        </div>
      </div>
    `;
  }

  function render(payload = {}) {
    const list = $('task-center-list');
    const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    if (!list) return;
    if (!tasks.length) {
      list.innerHTML = '<div class="task-center-empty">暂无定时任务。</div>';
      return;
    }
    list.innerHTML = tasks.map(renderTaskCard).join('');
    const meta = $('task-center-meta');
    if (meta) {
      meta.textContent = `共 ${tasks.length} 个定时任务 · 生成于 ${formatTime(payload.generatedAt)}`;
    }
  }

  async function loadTasks() {
    if (refreshController) refreshController.abort();
    refreshController = new AbortController();
    const list = $('task-center-list');
    try {
      const data = await fetchJson('/api/task-center', { signal: refreshController.signal });
      render(data);
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (list) list.innerHTML = `<div class="task-center-empty">任务状态加载失败：${escapeHtml(error.message || '未知错误')}</div>`;
    }
  }

  async function runAction(action) {
    if (!action || runningAction) return;
    runningAction = action;
    const list = $('task-center-list');
    document.querySelectorAll('.task-center-run-btn').forEach(btn => {
      btn.disabled = btn.dataset.action === action;
    });
    try {
      const result = await fetchJson('/api/task-center/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (ui.toast) {
        ui.toast(result.message || '已触发', 'success');
      } else {
        const meta = $('task-center-meta');
        if (meta) meta.textContent = result.message || '已触发';
      }
      await loadTasks();
    } catch (error) {
      if (ui.toast) {
        ui.toast(`执行失败：${error.message || '未知错误'}`, 'error');
      } else {
        const meta = $('task-center-meta');
        if (meta) meta.textContent = `执行失败：${error.message || '未知错误'}`;
      }
    } finally {
      runningAction = '';
      document.querySelectorAll('.task-center-run-btn').forEach(btn => {
        btn.disabled = false;
      });
    }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('.task-center-run-btn');
    if (target?.dataset.action) {
      runAction(target.dataset.action);
    }
  });

  $('task-center-refresh-btn')?.addEventListener('click', loadTasks);

  // ===== 自定义定时任务管理 =====
  const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const ACTION_TYPE_LABELS = {
    message: '发消息',
    command: '内置命令',
    shell: '命令行',
    agent: 'Agent',
  };
  let customTasks = [];
  let editingTaskId = '';

  function customField(id) {
    return document.getElementById(id);
  }

  function readCustomTaskById(id) {
    return customTasks.find(task => task.id === id) || null;
  }

  function renderCustomActionFields(actionType = 'message', action = {}) {
    const box = customField('custom-task-action-fields');
    if (!box) return;
    if (actionType === 'message') {
      const target = action.target === 'group' ? 'group' : 'master';
      box.innerHTML = `
        <label class="custom-task-field custom-task-narrow">发送到
          <select id="custom-task-msg-target">
            <option value="master" ${target === 'master' ? 'selected' : ''}>主人私聊</option>
            <option value="group" ${target === 'group' ? 'selected' : ''}>指定群</option>
          </select>
        </label>
        <label class="custom-task-field custom-task-narrow ${target === 'group' ? '' : 'hidden'}" id="custom-task-msg-group-wrap">群号
          <input id="custom-task-msg-group" inputmode="numeric" placeholder="例如 123456789" value="${escapeHtml(action.groupId || '')}" />
        </label>
        <label class="custom-task-field">消息内容
          <textarea id="custom-task-msg-content" rows="3" maxlength="2000" placeholder="到点发送的文本内容">${escapeHtml(action.content || '')}</textarea>
        </label>
      `;
    } else if (actionType === 'command') {
      box.innerHTML = `
        <label class="custom-task-field">命令内容
          <input id="custom-task-command" maxlength="2000" placeholder="例如：#群总结" value="${escapeHtml(action.command || '')}" />
        </label>
        <div class="custom-task-hint">以主人身份触发（回复会发到主人私聊）。填写带 # 前缀的完整命令。</div>
      `;
    } else if (actionType === 'shell') {
      const timeoutSec = Math.round((Number(action.timeoutMs) || 300000) / 1000);
      box.innerHTML = `
        <label class="custom-task-field">命令行
          <input id="custom-task-shell" maxlength="500" placeholder="例如：node scripts/cleanup.js" value="${escapeHtml(action.shell || '')}" />
        </label>
        <label class="custom-task-field custom-task-narrow">超时（秒）
          <input id="custom-task-shell-timeout" type="number" min="1" max="1800" value="${timeoutSec}" />
        </label>
        <div class="custom-task-hint">在灵晶根目录执行，超时可设 1~1800 秒；输出末尾会记入执行记录。</div>
      `;
    } else if (actionType === 'agent') {
      const agent = action.agent || {};
      box.innerHTML = `
        <label class="custom-task-field">任务指令
          <textarea id="custom-task-agent-prompt" rows="3" maxlength="2000" placeholder="描述要交给 Agent 的任务，例如：检查依赖健康并汇总风险">${escapeHtml(agent.prompt || '')}</textarea>
        </label>
        <label class="custom-task-field custom-task-narrow">模式
          <select id="custom-task-agent-mode">
            <option value="plan" ${agent.mode !== 'write' ? 'selected' : ''}>分析（只读）</option>
            <option value="write" ${agent.mode === 'write' ? 'selected' : ''}>实际修改</option>
          </select>
        </label>
        <label class="custom-task-field custom-task-narrow">工作目录 ID（可选）
          <input id="custom-task-agent-workspace" maxlength="80" placeholder="留空使用默认" value="${escapeHtml(agent.workspaceId || '')}" />
        </label>
        <label class="custom-task-field custom-task-narrow">提供方（可选）
          <input id="custom-task-agent-provider" maxlength="40" placeholder="留空使用默认" value="${escapeHtml(agent.providerId || '')}" />
        </label>
        <div class="custom-task-hint">到点启动 Agent 任务，进度去 Agent 工作台查看。</div>
      `;
    }
  }

  function renderCustomScheduleFields(scheduleType = 'daily', schedule = {}) {
    const box = customField('custom-task-schedule-fields');
    if (!box) return;
    const pad = value => String(value).padStart(2, '0');
    if (scheduleType === 'interval') {
      box.innerHTML = `
        <label class="custom-task-field custom-task-narrow">间隔（分钟）
          <input id="custom-task-interval" type="number" min="5" max="10080" value="${Number(schedule.intervalMinutes) || 30}" />
        </label>
        <div class="custom-task-hint">最小 5 分钟，按上次执行时间往后推算。</div>
      `;
      return;
    }
    const weekdayOptions = WEEKDAY_NAMES
      .map((name, index) => `<option value="${index}" ${Number(schedule.weekday) === index ? 'selected' : ''}>周${name.slice(1)}</option>`)
      .join('');
    box.innerHTML = `
      ${scheduleType === 'weekly' ? `<label class="custom-task-field custom-task-narrow">星期
        <select id="custom-task-weekday">${weekdayOptions}</select>
      </label>` : ''}
      <label class="custom-task-field custom-task-narrow">时
        <input id="custom-task-hour" type="number" min="0" max="23" value="${Number.isFinite(Number(schedule.hour)) ? Number(schedule.hour) : 8}" />
      </label>
      <label class="custom-task-field custom-task-narrow">分
        <input id="custom-task-minute" type="number" min="0" max="59" value="${Number.isFinite(Number(schedule.minute)) ? Number(schedule.minute) : 0}" />
      </label>
      <div class="custom-task-hint">每天/每周固定时刻触发，按服务器时间。</div>
    `;
  }

  function openCustomTaskEditor(task = null) {
    const editor = customField('custom-task-editor');
    if (!editor) return;
    editingTaskId = task?.id || '';
    customField('custom-task-add-btn').textContent = editingTaskId ? '正在编辑' : '新建任务';
    customField('custom-task-name').value = task?.name || '';
    const actionType = task?.action?.type || 'message';
    customField('custom-task-action-type').value = actionType;
    customField('custom-task-schedule-type').value = task?.schedule?.type || 'daily';
    customField('custom-task-enabled').checked = task ? task.enabled !== false : true;
    renderCustomActionFields(actionType, task?.action || {});
    renderCustomScheduleFields(task?.schedule?.type || 'daily', task?.schedule || {});
    editor.classList.remove('hidden');
    editor.scrollIntoView({ block: 'nearest' });
  }

  function closeCustomTaskEditor() {
    const editor = customField('custom-task-editor');
    if (!editor) return;
    editingTaskId = '';
    editor.classList.add('hidden');
    const addBtn = customField('custom-task-add-btn');
    if (addBtn) addBtn.textContent = '新建任务';
  }

  function collectCustomTaskPayload() {
    const actionType = customField('custom-task-action-type')?.value || 'message';
    const scheduleType = customField('custom-task-schedule-type')?.value || 'daily';
    const action = { type: actionType };
    if (actionType === 'message') {
      action.target = customField('custom-task-msg-target')?.value || 'master';
      action.groupId = (customField('custom-task-msg-group')?.value || '').trim();
      action.content = (customField('custom-task-msg-content')?.value || '').trim();
    } else if (actionType === 'command') {
      action.command = (customField('custom-task-command')?.value || '').trim();
    } else if (actionType === 'shell') {
      action.shell = (customField('custom-task-shell')?.value || '').trim();
      action.timeoutMs = Math.round(Number(customField('custom-task-shell-timeout')?.value || 300) * 1000);
    } else if (actionType === 'agent') {
      action.agent = {
        prompt: (customField('custom-task-agent-prompt')?.value || '').trim(),
        mode: customField('custom-task-agent-mode')?.value || 'plan',
        workspaceId: (customField('custom-task-agent-workspace')?.value || '').trim(),
        providerId: (customField('custom-task-agent-provider')?.value || '').trim(),
      };
    }
    const schedule = { type: scheduleType };
    if (scheduleType === 'interval') {
      schedule.intervalMinutes = Number(customField('custom-task-interval')?.value || 30);
    } else {
      schedule.hour = Number(customField('custom-task-hour')?.value || 0);
      schedule.minute = Number(customField('custom-task-minute')?.value || 0);
      if (scheduleType === 'weekly') {
        schedule.weekday = Number(customField('custom-task-weekday')?.value || 1);
      }
    }
    return {
      id: editingTaskId,
      name: (customField('custom-task-name')?.value || '').trim(),
      enabled: customField('custom-task-enabled')?.checked !== false,
      action,
      schedule,
    };
  }

  function renderCustomRecentRuns(task) {
    const runs = Array.isArray(task.runs) ? task.runs.slice(-3).reverse() : [];
    if (!runs.length) return '';
    const lines = runs.map(run => {
      const tone = String(run.status) === 'failed' ? 'tone-failed' : 'tone-sent';
      const message = String(run.message || '').replace(/\s+/g, ' ').slice(0, 80);
      return `<span>${escapeHtml(formatTime(run.time))} · <strong class="${tone}">${escapeHtml(run.status === 'failed' ? '失败' : '成功')}</strong>${message ? ` · ${escapeHtml(message)}` : ''}</span>`;
    }).join('');
    return `<div class="task-center-recent">${lines}</div>`;
  }

  function renderCustomTasks() {
    const list = customField('custom-task-list');
    if (!list) return;
    if (!customTasks.length) {
      list.innerHTML = '<div class="task-center-empty">还没有自定义任务，点右上角"新建任务"创建。</div>';
      return;
    }
    list.innerHTML = customTasks.map(task => {
      const typeLabel = ACTION_TYPE_LABELS[task.action?.type] || task.action?.type || '';
      const lastStatus = task.lastStatus === 'failed'
        ? '<strong class="tone-failed">上次失败</strong>'
        : task.lastStatus === 'success'
          ? '<strong class="tone-sent">上次成功</strong>'
          : '';
      return `
        <div class="custom-task-row ${task.enabled ? '' : 'is-disabled'}">
          <div class="custom-task-row-main">
            <div class="task-center-card-head">
              <strong>${escapeHtml(task.name)}</strong>
              <span class="custom-task-type-badge">${escapeHtml(typeLabel)}</span>
              <span class="task-center-meta-line">${escapeHtml(task.scheduleText || '')}</span>
              ${lastStatus}
            </div>
            <div class="task-center-card-desc">${escapeHtml(task.actionText || '')}</div>
            ${renderCustomRecentRuns(task)}
          </div>
          <div class="custom-task-row-actions">
            <button type="button" class="mini-btn" data-custom-action="run" data-id="${escapeHtml(task.id)}" ${task.enabled ? '' : ''}>立即执行</button>
            <button type="button" class="mini-btn" data-custom-action="toggle" data-id="${escapeHtml(task.id)}">${task.enabled ? '停用' : '启用'}</button>
            <button type="button" class="mini-btn" data-custom-action="edit" data-id="${escapeHtml(task.id)}">编辑</button>
            <button type="button" class="mini-btn" data-custom-action="delete" data-id="${escapeHtml(task.id)}">删除</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function loadCustomTasks() {
    try {
      const data = await fetchJson('/api/custom-tasks');
      customTasks = Array.isArray(data.tasks) ? data.tasks : [];
      renderCustomTasks();
    } catch (error) {
      const list = customField('custom-task-list');
      if (list) list.innerHTML = `<div class="task-center-empty">自定义任务加载失败：${escapeHtml(error.message || '未知错误')}</div>`;
    }
  }

  async function refreshAllTaskViews() {
    await Promise.all([loadCustomTasks(), loadTasks()]);
  }

  async function customTaskPost(pathname, body, successMessage) {
    const result = await fetchJson(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (ui.toast) ui.toast(result.message || successMessage || '已保存', 'success');
    return result;
  }

  $('custom-task-add-btn')?.addEventListener('click', () => {
    if (editingTaskId) closeCustomTaskEditor();
    else openCustomTaskEditor(null);
  });

  $('custom-task-action-type')?.addEventListener('change', event => {
    renderCustomActionFields(event.target.value, {});
  });

  $('custom-task-schedule-type')?.addEventListener('change', event => {
    renderCustomScheduleFields(event.target.value, {});
  });

  document.addEventListener('change', event => {
    const target = event.target;
    if (target?.id === 'custom-task-msg-target') {
      const wrap = customField('custom-task-msg-group-wrap');
      if (wrap) wrap.classList.toggle('hidden', target.value !== 'group');
    }
  });

  $('custom-task-save-btn')?.addEventListener('click', async () => {
    const payload = collectCustomTaskPayload();
    if (!payload.name) {
      if (ui.toast) ui.toast('请填写任务名称', 'error');
      return;
    }
    try {
      await customTaskPost('/api/custom-tasks', payload, '任务已保存');
      closeCustomTaskEditor();
      await refreshAllTaskViews();
    } catch (error) {
      if (ui.toast) ui.toast(`保存失败：${error.message || '未知错误'}`, 'error');
    }
  });

  $('custom-task-cancel-btn')?.addEventListener('click', closeCustomTaskEditor);

  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-custom-action]');
    if (!target) return;
    const id = target.dataset.id;
    const action = target.dataset.customAction;
    if (action === 'edit') {
      openCustomTaskEditor(readCustomTaskById(id));
      return;
    }
    if (action === 'toggle') {
      const task = readCustomTaskById(id);
      try {
        await customTaskPost('/api/custom-tasks/enabled', { id, enabled: !(task?.enabled !== false) }, '已更新');
        await refreshAllTaskViews();
      } catch (error) {
        if (ui.toast) ui.toast(`操作失败：${error.message || '未知错误'}`, 'error');
      }
      return;
    }
    if (action === 'delete') {
      if (!window.confirm('确定删除该自定义任务吗？执行记录会一并删除。')) return;
      try {
        await customTaskPost('/api/custom-tasks/delete', { id }, '任务已删除');
        if (editingTaskId === id) closeCustomTaskEditor();
        await refreshAllTaskViews();
      } catch (error) {
        if (ui.toast) ui.toast(`删除失败：${error.message || '未知错误'}`, 'error');
      }
      return;
    }
    if (action === 'run') {
      if (target.disabled) return;
      target.disabled = true;
      try {
        const result = await fetchJson('/api/custom-tasks/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (ui.toast) ui.toast(result.message || (result.success ? '已执行' : (result.error || '执行失败')), result.success ? 'success' : 'error');
        await refreshAllTaskViews();
      } catch (error) {
        if (ui.toast) ui.toast(`执行失败：${error.message || '未知错误'}`, 'error');
      } finally {
        target.disabled = false;
      }
    }
  });


  let reportText = '';

  async function generateHealthReport() {
    const box = $('health-report-box');
    const generateBtn = $('health-report-generate-btn');
    const copyBtn = $('health-report-copy-btn');
    if (!box || generateBtn?.disabled) return;
    if (generateBtn) generateBtn.disabled = true;
    box.textContent = '正在生成体检报告...';
    try {
      const data = await fetchJson('/api/health-report/text');
      reportText = String(data.text || '');
      box.textContent = reportText || '（空报告）';
      if (copyBtn) copyBtn.disabled = !reportText;
    } catch (error) {
      box.textContent = `体检报告生成失败：${error.message || '未知错误'}`;
      reportText = '';
      if (copyBtn) copyBtn.disabled = true;
    } finally {
      if (generateBtn) generateBtn.disabled = false;
    }
  }

  async function copyHealthReport() {
    if (!reportText) return;
    const copyBtn = $('health-report-copy-btn');
    try {
      await navigator.clipboard.writeText(reportText);
      if (copyBtn) {
        const original = copyBtn.textContent;
        copyBtn.textContent = '已复制';
        setTimeout(() => { copyBtn.textContent = original; }, 1600);
      }
    } catch {
      if (ui.toast) {
        ui.toast('复制失败，请手动选中文本复制', 'error');
      }
    }
  }

  $('health-report-generate-btn')?.addEventListener('click', generateHealthReport);
  $('health-report-copy-btn')?.addEventListener('click', copyHealthReport);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      loadTasks();
      loadCustomTasks();
    });
  } else {
    loadTasks();
    loadCustomTasks();
  }
})();
