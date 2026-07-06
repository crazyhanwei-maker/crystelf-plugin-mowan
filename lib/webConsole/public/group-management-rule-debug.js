function renderRuleDebuggerPanel(group = {}, disabled = false) {
  const disabledAttr = disabled ? 'disabled' : '';
  const groupId = group.groupId || '';
  return `
    <div class="group-management-nested-block group-management-rule-debug-block">
      <div class="group-management-block-head">
        <h4>规则调试器</h4>
        <div class="detail-tags"><span class="detail-tag">只读模拟</span></div>
      </div>
      <div class="setting-help">读取当前页面表单草稿，不需要先保存；不会同意申请、禁言、撤回、踢人、发放头衔或调用 LLM。</div>
      <div class="group-management-rule-debug-form">
        <label class="setting-item">
          <span class="kv-label">调试类型</span>
          <select id="gm-rule-debug-type" ${disabledAttr}>
            <option value="message">群消息风控</option>
            <option value="join">加群申请</option>
            <option value="title">头衔申请</option>
          </select>
        </label>
        <label class="setting-item">
          <span class="kv-label">用户 QQ</span>
          <input id="gm-rule-debug-user-id" inputmode="numeric" value="123456789" ${disabledAttr} />
        </label>
        <label class="setting-item">
          <span class="kv-label">用户昵称</span>
          <input id="gm-rule-debug-nickname" value="测试用户" ${disabledAttr} />
        </label>
        <label class="setting-item">
          <span class="kv-label">发送者身份</span>
          <select id="gm-rule-debug-role" ${disabledAttr}>
            <option value="member">普通成员</option>
            <option value="admin">管理员</option>
            <option value="owner">群主</option>
          </select>
        </label>
      </div>
      <div class="group-management-rule-debug-form">
        <label class="setting-item group-management-textarea-item group-management-rule-debug-wide">
          <span class="kv-label">群消息内容</span>
          <textarea id="gm-rule-debug-message" rows="4" ${disabledAttr} placeholder="例如：点我领取福利 https://example.com">点我领取福利 https://example.com</textarea>
        </label>
        <label class="setting-item">
          <span class="kv-label">重复次数（含本次）</span>
          <input id="gm-rule-debug-repeat-count" type="number" min="1" max="1000" value="1" ${disabledAttr} />
        </label>
        <label class="setting-item">
          <span class="kv-label">窗口内消息条数（含本次）</span>
          <input id="gm-rule-debug-burst-count" type="number" min="1" max="1000" value="1" ${disabledAttr} />
        </label>
        <label class="setting-item">
          <span class="kv-label">模拟 URL 风险</span>
          <select id="gm-rule-debug-url-risk" ${disabledAttr}>
            <option value="none">无风险</option>
            <option value="low">低风险</option>
            <option value="medium">中风险</option>
            <option value="high">高风险</option>
          </select>
        </label>
        <label class="group-management-switch group-management-rule-debug-switch">
          <input id="gm-rule-debug-new-member" type="checkbox" ${disabledAttr} />
          <span><strong>模拟新人观察期</strong><small>勾选后按下面的入群分钟数判断。</small></span>
        </label>
        <label class="setting-item">
          <span class="kv-label">入群后分钟数</span>
          <input id="gm-rule-debug-minutes-since-join" type="number" min="0" max="10080" value="5" ${disabledAttr} />
        </label>
      </div>
      <div class="group-management-rule-debug-form">
        <label class="setting-item group-management-textarea-item group-management-rule-debug-wide">
          <span class="kv-label">加群申请理由</span>
          <textarea id="gm-rule-debug-join-comment" rows="3" ${disabledAttr} placeholder="例如：喜欢这个群，想一起交流">喜欢这个群，想一起交流</textarea>
        </label>
        <label class="setting-item">
          <span class="kv-label">QQ 等级</span>
          <input id="gm-rule-debug-qq-level" type="number" min="0" max="255" value="20" ${disabledAttr} />
        </label>
        <label class="setting-item">
          <span class="kv-label">年龄</span>
          <input id="gm-rule-debug-age" type="number" min="0" max="150" value="18" ${disabledAttr} />
        </label>
        <label class="setting-item">
          <span class="kv-label">覆盖警告积分</span>
          <input id="gm-rule-debug-warning-count" type="number" min="0" max="1000" value="0" ${disabledAttr} />
        </label>
        <label class="setting-item group-management-rule-debug-wide">
          <span class="kv-label">申请头衔</span>
          <input id="gm-rule-debug-title-text" value="快乐摸鱼人" ${disabledAttr} />
        </label>
      </div>
      <div class="actions group-management-rule-debug-actions">
        <button type="button" class="mini-btn" data-action="run-rule-debug" data-group-id="${escapeHtml(groupId)}" ${disabledAttr}>运行调试</button>
        <button type="button" class="mini-btn" data-action="fill-rule-debug-ad" ${disabledAttr}>填入广告样例</button>
        <button type="button" class="mini-btn" data-action="fill-rule-debug-safe" ${disabledAttr}>填入正常样例</button>
      </div>
      <div id="gm-rule-debug-result" class="group-management-rule-debug-result">尚未运行调试。</div>
    </div>
  `;
}

function buildRuleDebugDraftPayload() {
  return {
    auth: {
      autoApprove: {
        enable: $('gm-auto-approve-enable')?.checked === true,
        minQqLevel: readNumber('gm-auto-min-qq-level', 0, 0, 255),
        minAge: readNumber('gm-auto-min-age', 0, 0, 150),
        commentKeywords: readLines('gm-auto-comment-keywords'),
        blockedKeywords: readLines('gm-auto-blocked-keywords'),
        customRules: readLines('gm-auto-custom-rules'),
        risk: {
          enabled: $('gm-auto-risk-enabled')?.checked === true,
          scoreEnabled: $('gm-auto-risk-score-enabled')?.checked === true,
          blockBlacklistAutoApprove: $('gm-auto-risk-block-blacklist')?.checked === true,
          autoApproveWhitelisted: $('gm-auto-risk-auto-whitelist')?.checked === true,
          holdHighRisk: $('gm-auto-risk-hold-high')?.checked === true,
          highRiskScore: readNumber('gm-auto-risk-high-score', 70, 1, 100),
          warningBlockThreshold: readNumber('gm-auto-risk-warning-threshold', 3, 0, 100),
        },
      },
    },
    moderation: {
      blacklist: readLines('gm-moderation-blacklist'),
      whitelist: readLines('gm-moderation-whitelist'),
      content: {
        enabled: $('gm-content-enabled')?.checked === true,
        exemptAdmins: $('gm-content-exempt-admins')?.checked === true,
        detectLinks: $('gm-content-detect-links')?.checked === true,
        urlSafety: {
          enabled: $('gm-content-url-safety-enabled')?.checked === true,
          riskThreshold: $('gm-content-url-safety-threshold')?.value || 'high',
          maxUrlsPerMessage: readNumber('gm-content-url-safety-max-urls', 2, 1, 5),
          markdownMaxLength: readNumber('gm-content-url-safety-md-length', 6000, 1000, 20000),
          timeoutMs: readNumber('gm-content-url-safety-timeout', 20000, 20000, 60000),
          whitelist: readLines('gm-content-url-safety-whitelist'),
        },
        detectBlockedKeywords: $('gm-content-detect-keywords')?.checked === true,
        blockedKeywords: readLines('gm-content-blocked-keywords'),
        repeatLimit: readNumber('gm-content-repeat-limit', 4, 2, 20),
        repeatWindowSeconds: readNumber('gm-content-repeat-window', 45, 5, 600),
        detectSpamMessages: $('gm-content-detect-spam')?.checked === true,
        burstLimit: readNumber('gm-content-burst-limit', 8, 2, 60),
        burstWindowSeconds: readNumber('gm-content-burst-window', 60, 5, 600),
        observeNewMembers: $('gm-content-observe-new')?.checked === true,
        observeMinutes: readNumber('gm-content-observe-minutes', 60, 1, 10080),
        observeBlockLinks: $('gm-content-observe-block-links')?.checked === true,
        action: $('gm-content-action')?.value || 'log',
        muteSeconds: readNumber('gm-content-mute-seconds', 600, 60, 2592000),
        addWarning: $('gm-content-add-warning')?.checked === true,
      },
    },
  };
}

function buildRuleDebugRequestPayload() {
  const group = getSelectedGroup();
  if (!group) throw new Error('请先选择群');
  return {
    type: $('gm-rule-debug-type')?.value || 'message',
    groupId: group.groupId,
    userId: normalizeGroupId($('gm-rule-debug-user-id')?.value) || String($('gm-rule-debug-user-id')?.value || '').trim(),
    nickname: $('gm-rule-debug-nickname')?.value || '',
    role: $('gm-rule-debug-role')?.value || 'member',
    messageText: $('gm-rule-debug-message')?.value || '',
    repeatCount: readNumber('gm-rule-debug-repeat-count', 1, 1, 1000),
    burstCount: readNumber('gm-rule-debug-burst-count', 1, 1, 1000),
    simulatedUrlRiskLevel: $('gm-rule-debug-url-risk')?.value || 'none',
    isNewMember: $('gm-rule-debug-new-member')?.checked === true,
    minutesSinceJoin: readNumber('gm-rule-debug-minutes-since-join', 5, 0, 10080),
    comment: $('gm-rule-debug-join-comment')?.value || '',
    qqLevel: $('gm-rule-debug-qq-level')?.value || '',
    age: $('gm-rule-debug-age')?.value || '',
    warningCount: readNumber('gm-rule-debug-warning-count', 0, 0, 1000),
    titleText: $('gm-rule-debug-title-text')?.value || '',
    botRole: group.permission?.role || group.botRole || '',
    safety: buildSafetySavePayload().safety,
    draft: buildRuleDebugDraftPayload(),
  };
}

function formatRuleDebugToneClass(tone = '') {
  if (tone === 'success') return 'tone-success';
  if (tone === 'warning') return 'tone-warning';
  if (tone === 'error') return 'tone-error';
  return '';
}

function renderRuleDebugTags(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(item => item && item.value !== undefined && item.value !== null && item.value !== '')
    .map(item => `<span class="detail-tag ${escapeHtml(item.tone || '')}">${escapeHtml(item.label)}：${escapeHtml(item.value)}</span>`)
    .join('');
}

function renderRuleDebugList(title = '', items = []) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  return `
    <div class="group-management-rule-debug-section">
      <h5>${escapeHtml(title)}</h5>
      ${list.length
        ? `<ul>${list.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : '<div class="setting-help">无</div>'}
    </div>
  `;
}

function renderRuleDebugResult(payload = {}) {
  const box = $('gm-rule-debug-result');
  if (!box) return;
  const result = payload.result || {};
  const safetyPlan = result.safetyPlan || {};
  const risk = result.result?.risk || {};
  const validation = result.validation || {};
  const tags = [
    { label: '类型', value: result.type === 'join' ? '加群申请' : result.type === 'title' ? '头衔申请' : '群消息风控' },
    { label: '群号', value: payload.groupId },
    { label: '结果', value: result.title || '-' },
    result.type === 'message' && safetyPlan.actionLabel ? { label: '动作', value: safetyPlan.safetyDowngraded ? `${safetyPlan.requestedActionLabel} -> ${safetyPlan.actionLabel}` : safetyPlan.actionLabel, tone: safetyPlan.safetyDowngraded ? 'tone-warning' : '' } : null,
    result.type === 'join' ? { label: '风险分', value: risk.enabled === false ? '未启用' : `${risk.score ?? 0} / ${risk.level || '-'}`, tone: Number(risk.score || 0) >= Number(risk.highRiskScore || 70) ? 'tone-warning' : '' } : null,
    result.type === 'title' && validation.width ? { label: '头衔宽度', value: `${validation.width} / ${result.config?.maxDisplayWidth || '-'}` } : null,
  ].filter(Boolean);
  const detailItems = [];
  if (result.type === 'message') {
    detailItems.push(...(safetyPlan.safetyMessages || []));
    if (result.config?.addWarning === true && result.triggered) detailItems.push('真实运行会增加该成员警告积分。');
    if (result.urlSafety?.note) detailItems.push(result.urlSafety.note);
  }
  if (result.type === 'join') {
    detailItems.push(`自动通过开关：${result.config?.enable ? '开启' : '关闭'}`);
    detailItems.push(`黑名单：${result.moderation?.blacklisted ? '命中' : '未命中'} / 白名单：${result.moderation?.whitelisted ? '命中' : '未命中'} / 警告积分：${result.moderation?.warningCount || 0}`);
  }
  if (result.type === 'title') {
    detailItems.push(`自动通过：${result.config?.autoApprove ? '开启' : '关闭'} / AI审核：${result.config?.aiReview?.enabled ? '开启' : '关闭'}`);
  }
  box.innerHTML = `
    <div class="group-management-rule-debug-card ${formatRuleDebugToneClass(result.tone)}">
      <div class="group-management-rule-debug-head">
        <div>
          <strong>${escapeHtml(result.title || '调试完成')}</strong>
          <div class="setting-help">${escapeHtml(result.reason || '无详细原因')}</div>
        </div>
        <div class="detail-tags">${renderRuleDebugTags(tags)}</div>
      </div>
      ${renderRuleDebugList('命中信号', result.signals || [])}
      ${renderRuleDebugList('执行说明', [...detailItems, ...(result.notes || [])])}
      ${(result.details || []).map(item => renderRuleDebugList(item.label || '细节', item.items || [item.value])).join('')}
    </div>
  `;
}

async function runGroupManagementRuleDebug() {
  const box = $('gm-rule-debug-result');
  if (box) box.innerHTML = '<div class="setting-help">正在运行规则调试...</div>';
  try {
    const payload = buildRuleDebugRequestPayload();
    const result = await postJson('/api/group-management/rule-debug', payload);
    renderRuleDebugResult(result);
  } catch (error) {
    if (box) box.innerHTML = `<div class="setting-error">规则调试失败：${escapeHtml(error.message)}</div>`;
  }
}

function fillRuleDebugAdSample() {
  setInputValue('gm-rule-debug-message', '点我领取福利 https://example.com 加群私聊返利');
  setInputValue('gm-rule-debug-join-comment', '推广合作，进群发福利');
  setInputValue('gm-rule-debug-title-text', '官方客服');
  setInputValue('gm-rule-debug-repeat-count', 4);
  setInputValue('gm-rule-debug-burst-count', 9);
  setInputValue('gm-rule-debug-url-risk', 'high');
  const newMember = $('gm-rule-debug-new-member');
  if (newMember) newMember.checked = true;
}

function fillRuleDebugSafeSample() {
  setInputValue('gm-rule-debug-message', '大家晚上好，今天有人打深渊吗？');
  setInputValue('gm-rule-debug-join-comment', '喜欢这个群，想一起交流');
  setInputValue('gm-rule-debug-title-text', '快乐摸鱼人');
  setInputValue('gm-rule-debug-repeat-count', 1);
  setInputValue('gm-rule-debug-burst-count', 1);
  setInputValue('gm-rule-debug-url-risk', 'none');
  const newMember = $('gm-rule-debug-new-member');
  if (newMember) newMember.checked = false;
}

document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.action === 'run-rule-debug') {
    runGroupManagementRuleDebug();
  }
  if (target.dataset.action === 'fill-rule-debug-ad') {
    fillRuleDebugAdSample();
  }
  if (target.dataset.action === 'fill-rule-debug-safe') {
    fillRuleDebugSafeSample();
  }
});
