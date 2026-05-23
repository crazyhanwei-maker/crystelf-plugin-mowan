// 群管理页面渲染层。由 group-management.html 在 group-management.js 前加载。

function renderDefaultsPanel() {
  const box = $('group-management-defaults');
  if (!box) return;
  const saveButton = $('group-management-default-save-btn');
  const defaults = groupManagementState.payload?.defaults || {};
  const auth = defaults.auth || {};
  const carbon = auth.carbon || {};
  const autoApprove = auth.autoApprove || {};
  const risk = autoApprove.risk || {};
  const welcome = defaults.welcome || {};
  const moderation = defaults.moderation || {};
  const content = moderation.content || {};
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  if (saveButton) saveButton.disabled = disabled;

  box.innerHTML = `
    <div class="group-management-control-grid group-management-default-grid">
      <section class="group-management-control-block group-management-local-block">
        <h3>默认入群验证</h3>
        <div class="setting-help">没有单独设置入群验证的群，会使用这里的默认规则。</div>
        <div class="group-management-nested-grid">
          <div class="group-management-nested-block">
            <h4>验证流程</h4>
            ${renderFeatureSwitch('gm-default-auth-enable', '默认启用入群验证', auth.enable === true, '开启后未单独配置的群会触发入群验证。', disabled)}
            ${renderFeatureSwitch('gm-default-auth-carbon-enable', '默认使用手性碳验证', carbon.enable === true, '关闭时使用数字计算验证。', disabled)}
            ${renderFeatureSwitch('gm-default-auth-carbon-hint', '默认显示手性碳提示', carbon.hint !== false, '仅手性碳验证模式有效。', disabled)}
            ${renderFeatureSwitch('gm-default-auth-carbon-hard', '默认手性碳困难模式', carbon['hard-mode'] === true, '需要找出全部正确区域。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认验证超时（秒）</span>
                <input id="gm-default-auth-timeout" type="number" min="30" max="1800" step="10" value="${escapeHtml(auth.timeout || 180)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认答错次数</span>
                <input id="gm-default-auth-frequency" type="number" min="1" max="20" step="1" value="${escapeHtml(auth.frequency || 5)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-default-auth-recall', '默认撤回答错消息', auth.recall !== false, '验证失败时尝试撤回成员错误答案。', disabled)}
          </div>

          <div class="group-management-nested-block">
            <h4>默认加群申请自动通过</h4>
            ${renderFeatureSwitch('gm-default-auto-approve-enable', '默认启用自动通过', autoApprove.enable === true, '未单独配置的群按这些条件自动同意加群申请。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认最低 QQ 等级</span>
                <input id="gm-default-auto-min-qq-level" type="number" min="0" max="255" step="1" value="${escapeHtml(autoApprove.minQqLevel || 0)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认最低年龄</span>
                <input id="gm-default-auto-min-age" type="number" min="0" max="150" step="1" value="${escapeHtml(autoApprove.minAge || 0)}" ${disabledAttr} />
              </label>
            </div>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">默认必要关键词</span>
              <textarea id="gm-default-auto-comment-keywords" rows="3" ${disabledAttr} placeholder="一行一个关键词，留空表示不检查">${escapeHtml((autoApprove.commentKeywords || []).join('\n'))}</textarea>
            </label>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">默认拦截关键词</span>
              <textarea id="gm-default-auto-blocked-keywords" rows="3" ${disabledAttr} placeholder="命中这些词时不自动通过">${escapeHtml((autoApprove.blockedKeywords || []).join('\n'))}</textarea>
            </label>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">默认自定义条件</span>
              <textarea id="gm-default-auto-custom-rules" rows="4" ${disabledAttr} placeholder="例如：qq等级 >= 20&#10;申请理由 包含 原神">${escapeHtml((autoApprove.customRules || []).join('\n'))}</textarea>
            </label>
            ${renderFeatureSwitch('gm-default-auto-risk-enabled', '默认启用风险评分', risk.enabled === true, '申请记录会显示风险分，并接入黑白名单和警告积分。', disabled)}
            ${renderFeatureSwitch('gm-default-auto-risk-score-enabled', '默认记录风险分', risk.scoreEnabled === true, '关闭后只保留普通自动通过条件。', disabled)}
            ${renderFeatureSwitch('gm-default-auto-risk-block-blacklist', '默认黑名单不自动通过', risk.blockBlacklistAutoApprove === true, '申请人命中本群黑名单时保留人工审核。', disabled)}
            ${renderFeatureSwitch('gm-default-auto-risk-auto-whitelist', '默认白名单直接通过', risk.autoApproveWhitelisted === true, '申请人命中本群白名单时可跳过普通条件。', disabled)}
            ${renderFeatureSwitch('gm-default-auto-risk-hold-high', '默认高风险保留人工', risk.holdHighRisk === true, '风险分达到阈值时不自动通过。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认高风险阈值</span>
                <input id="gm-default-auto-risk-high-score" type="number" min="1" max="100" step="1" value="${escapeHtml(risk.highRiskScore || 70)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认警告拦截阈值</span>
                <input id="gm-default-auto-risk-warning-threshold" type="number" min="0" max="100" step="1" value="${escapeHtml(risk.warningBlockThreshold ?? 3)}" ${disabledAttr} />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section class="group-management-control-block group-management-local-block">
        <h3>默认欢迎与风控</h3>
        <div class="setting-help">未单独保存欢迎或群消息风控的群会继承这里。</div>
        <div class="group-management-nested-grid">
          <div class="group-management-nested-block">
            <h4>默认入群欢迎</h4>
            ${renderFeatureSwitch('gm-default-welcome-enabled', '默认启用入群欢迎', welcome.enabled === true, '未单独配置欢迎的群会发送默认欢迎。', disabled)}
            ${renderFeatureSwitch('gm-default-welcome-ai-enabled', '默认启用 AI 欢迎', welcome.aiEnabled === true, '接口故障时回退普通欢迎文案。', disabled)}
            <textarea id="gm-default-welcome-text" rows="5" maxlength="1000" ${disabledAttr} placeholder="输入默认新人欢迎文案">${escapeHtml(welcome.text || '')}</textarea>
          </div>

          <div class="group-management-nested-block group-management-content-block">
            <h4>默认防广告/防刷屏</h4>
            ${(() => {
              const urlSafety = content.urlSafety || {};
              return `
                ${renderFeatureSwitch('gm-default-content-url-safety-enabled', '默认启用链接安全检查', urlSafety.enabled === true, '检查群员发送的网页链接，并判断是否存在钓鱼、诈骗、恶意下载等风险。默认关闭。', disabled)}
                <div class="settings-grid group-management-small-grid">
                  <label class="setting-item">
                    <span class="kv-label">默认 URL 风险阈值</span>
                    <select id="gm-default-content-url-safety-threshold" ${disabledAttr}>
                      ${renderUrlSafetyRiskOptions(urlSafety.riskThreshold || 'high')}
                    </select>
                  </label>
                  <label class="setting-item">
                    <span class="kv-label">默认每条消息检查 URL 数</span>
                    <input id="gm-default-content-url-safety-max-urls" type="number" min="1" max="5" step="1" value="${escapeHtml(urlSafety.maxUrlsPerMessage || 2)}" ${disabledAttr} />
                  </label>
                  <label class="setting-item">
                    <span class="kv-label">默认网页读取最大字符</span>
                    <input id="gm-default-content-url-safety-md-length" type="number" min="1000" max="20000" step="500" value="${escapeHtml(urlSafety.markdownMaxLength || 6000)}" ${disabledAttr} />
                  </label>
                  <label class="setting-item">
                    <span class="kv-label">默认检查超时（毫秒）</span>
                    <input id="gm-default-content-url-safety-timeout" type="number" min="20000" max="60000" step="1000" value="${escapeHtml(urlSafety.timeoutMs || 20000)}" ${disabledAttr} />
                  </label>
                </div>
                <label class="setting-item group-management-textarea-item">
                  <span class="kv-label">默认链接检查白名单</span>
                  <textarea id="gm-default-content-url-safety-whitelist" rows="4" ${disabledAttr} placeholder="一行一个域名或 URL，例如：bilibili.com&#10;*.qq.com&#10;example.com/path">${escapeHtml((urlSafety.whitelist || []).join('\n'))}</textarea>
                  <div class="setting-help">白名单里的链接不会检查；其他链接检查过一次后会复用结果，减少重复请求。</div>
                </label>
              `;
            })()}
            ${renderFeatureSwitch('gm-default-content-enabled', '默认启用群消息风控', content.enabled === true, '未单独配置风控的群会使用默认规则。', disabled)}
            ${renderFeatureSwitch('gm-default-content-exempt-admins', '默认跳过群主和管理员', content.exemptAdmins !== false, '避免误处理群管理人员。', disabled)}
            ${renderFeatureSwitch('gm-default-content-detect-links', '默认检测链接', content.detectLinks !== false, '命中 URL、QQ群链接、短链等会触发。', disabled)}
            ${renderFeatureSwitch('gm-default-content-detect-keywords', '默认检测关键词', content.detectBlockedKeywords !== false, '命中下方关键词会触发。', disabled)}
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">默认广告/违规关键词</span>
              <textarea id="gm-default-content-blocked-keywords" rows="4" ${disabledAttr} placeholder="一行一个关键词">${escapeHtml((content.blockedKeywords || []).join('\n'))}</textarea>
            </label>
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认重复次数</span>
                <input id="gm-default-content-repeat-limit" type="number" min="2" max="20" step="1" value="${escapeHtml(content.repeatLimit || 4)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">默认重复窗口秒</span>
                <input id="gm-default-content-repeat-window" type="number" min="5" max="600" step="5" value="${escapeHtml(content.repeatWindowSeconds || 45)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-default-content-detect-spam', '默认启用刷屏检测', content.detectSpamMessages === true, '同一成员在指定时间内发送超过阈值条数时触发。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认刷屏阈值</span>
                <input id="gm-default-content-burst-limit" type="number" min="2" max="60" step="1" value="${escapeHtml(content.burstLimit || 8)}" ${disabledAttr} />
                <div class="setting-help">同一成员超过这个条数才触发，例如填 8 表示第 9 条触发。</div>
              </label>
              <label class="setting-item">
                <span class="kv-label">默认刷屏窗口秒</span>
                <input id="gm-default-content-burst-window" type="number" min="5" max="600" step="5" value="${escapeHtml(content.burstWindowSeconds || 60)}" ${disabledAttr} />
              </label>
            </div>
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">默认触发动作</span>
                <select id="gm-default-content-action" ${disabledAttr}>
                  ${renderModerationActionOptions(content.action || 'log')}
                </select>
              </label>
              <label class="setting-item">
                <span class="kv-label">默认禁言秒数</span>
                <input id="gm-default-content-mute-seconds" type="number" min="60" max="2592000" step="60" value="${escapeHtml(content.muteSeconds || 600)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-default-content-add-warning', '默认触发后增加警告积分', content.addWarning === true, '风险评分和申请审核会读取成员警告积分。', disabled)}
            ${renderFeatureSwitch('gm-default-content-observe-new', '默认启用新人观察期', content.observeNewMembers === true, '新成员入群后一段时间内应用观察期规则。', disabled)}
            ${renderFeatureSwitch('gm-default-content-observe-block-links', '默认观察期禁止链接', content.observeBlockLinks === true, '新人观察期内发链接会触发风控。', disabled)}
            <label class="setting-item">
              <span class="kv-label">默认观察时长（分钟）</span>
              <input id="gm-default-content-observe-minutes" type="number" min="1" max="10080" step="5" value="${escapeHtml(content.observeMinutes || 60)}" ${disabledAttr} />
            </label>
            ${renderContentSafetyWarning({
              action: content.action || 'log',
              muteSeconds: content.muteSeconds || 600,
            }, 'gm-default-content-safety-warning')}
          </div>
        </div>
      </section>
    </div>
  `;
}

