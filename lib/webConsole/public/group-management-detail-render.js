function renderConfigBackups(backups = []) {
  const items = Array.isArray(backups) ? backups : [];
  if (items.length === 0) {
    return '<div class="group-management-empty">暂无配置备份；保存当前群后会自动生成。</div>';
  }
  return `
    <div class="group-management-backup-list">
      ${items.map(item => `
        <div class="group-management-backup-item">
          <div>
            <strong>${escapeHtml(formatDateTime(item.createdAt))}</strong>
            <div class="setting-help">${escapeHtml(item.note || item.action || '保存前自动备份')}</div>
          </div>
          <button type="button" class="mini-btn" data-action="rollback-config" data-backup-id="${escapeHtml(item.id || '')}">回滚</button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderDetail() {
  const group = getSelectedGroup();
  const saveButton = $('group-management-save-btn');
  if (saveButton) {
    saveButton.disabled = !group || groupManagementState.payload?.readOnly === true;
  }
  if (!group) {
    $('group-management-detail').innerHTML = '<div class="group-management-empty">请选择一个群，或直接输入群号后打开。</div>';
    return;
  }

  const config = group.config || {};
  const auth = config.auth?.config || {};
  const carbon = auth.carbon || {};
  const autoApprove = auth.autoApprove || {};
  const welcome = config.welcome || {};
  const dailySummary = config.dailySummary || {};
  const moderation = config.moderation || {};
  const contentModeration = moderation.content || {};
  const authSourceLabel = config.auth?.hasCustom ? '本群覆盖' : '继承默认';
  const welcomeSourceLabel = welcome.hasCustom ? '本群覆盖' : '继承默认';
  const contentSourceLabel = moderation.hasCustomContent ? '本群覆盖' : '继承默认';
  const disabled = groupManagementState.payload?.readOnly === true;
  const disabledAttr = disabled ? 'disabled' : '';
  const readOnlyNote = disabled ? '<div class="risk-box">控制台处于只读模式，不能保存群配置。</div>' : '';

  $('group-management-detail').innerHTML = `
    <div class="group-management-detail-head">
      <div>
        <h2>${escapeHtml(group.displayName || group.groupId)}</h2>
        <div class="setting-help">群号 ${escapeHtml(group.groupId)} / ${escapeHtml(group.sourceText || 'manual')}</div>
      </div>
      <div class="group-management-detail-actions">
        <div class="detail-tags">${getGroupToneTags(group)}</div>
        <a class="mini-btn group-management-simulator-link" href="${escapeHtml(buildGroupSimulatorUrl(group))}" target="_blank" rel="noopener">用此群测试</a>
      </div>
    </div>
    ${readOnlyNote}
    <div class="group-management-control-grid">
      <section class="group-management-control-block group-management-local-block">
        <h3>权限自检与模板</h3>
        <div class="group-management-ops-grid">
          <div class="group-management-nested-block">
            <h4>机器人权限自检</h4>
            ${renderPermissionSummary(group)}
          </div>
          <div class="group-management-nested-block group-management-effective-block">
            <h4>当前生效配置快照</h4>
            <div class="setting-help">按默认设置和本群覆盖后的最终结果展示，只用于核对，不会写入配置。</div>
            ${renderEffectiveConfigSnapshot(group)}
          </div>
          <div class="group-management-nested-block">
            <h4>群管规则模板</h4>
            <div class="setting-help">模板只填入当前表单，确认无误后再点“保存当前群”。</div>
            <div class="group-management-template-actions">
              <select id="gm-rule-template" ${disabledAttr}>
                ${renderGroupManagementTemplateOptions()}
              </select>
              <button type="button" class="mini-btn" data-action="apply-rule-template" ${disabledAttr}>填入模板</button>
            </div>
            <div id="gm-rule-template-help" class="setting-help">${escapeHtml(GROUP_MANAGEMENT_RULE_TEMPLATES.relaxed.help)}</div>
          </div>
          <div class="group-management-nested-block">
            <h4>配置备份/回滚</h4>
            <div class="setting-help">每次保存当前群前都会自动备份一次当前配置。</div>
            ${renderConfigBackups(config.backups || [])}
          </div>
          ${typeof renderRuleDebuggerPanel === 'function' ? renderRuleDebuggerPanel(group, disabled) : ''}
        </div>
      </section>

      <section class="group-management-control-block">
        <h3>AI 群策略</h3>
        <div class="setting-help">白名单不为空时，只有白名单群会启用 AI；黑名单会直接禁用本群 AI。</div>
        ${renderFeatureSwitch('gm-ai-blocked', '加入 AI 黑名单', config.ai?.blocked, '本群不会触发 AI 回复', disabled)}
        ${renderFeatureSwitch('gm-ai-whitelisted', '加入 AI 白名单', config.ai?.whitelisted, '白名单模式下允许本群使用 AI', disabled)}
        <div class="group-management-nested-block">
          <h4>伪人模式</h4>
          <div class="setting-help">对未 @ 机器人的普通聊天，读取最近 10 条群消息后按概率触发一次 AI 回复。明确 @、昵称触发和持续接话不受此概率影响。</div>
          ${renderFeatureSwitch('gm-pseudo-human-enabled', '启用本群伪人模式', config.ai?.pseudoHuman?.enabled, '按设置的概率主动参与普通群聊', disabled)}
          <label class="setting-item">
            <span class="kv-label">普通聊天触发概率（0-100%）</span>
            <input id="gm-pseudo-human-probability" type="number" min="0" max="100" step="1" value="${escapeHtml(config.ai?.pseudoHuman?.probability ?? 10)}" ${disabledAttr} />
          </label>
        </div>
      </section>

      <section class="group-management-control-block">
        <h3>每日群聊总结</h3>
        <div class="setting-help">全局开关和定时点在插件设置里配置；这里控制当前群是否进入每日总结启用/禁用列表。</div>
        ${renderFeatureSwitch('gm-summary-allowed', '开启本群每日总结', dailySummary.allowed, '保存后会开启每日总结全局开关，并把范围设为启用群模式', disabled)}
        ${renderFeatureSwitch('gm-summary-blocked', '禁用本群每日总结', dailySummary.blocked, '无论总结范围如何，本群都不会发送每日总结', disabled)}
      </section>

      <section class="group-management-control-block">
        <h3>图片监控</h3>
        <div class="setting-help">只调整本群在图片监控白/黑名单中的状态，不修改全局监控开关。</div>
        ${renderFeatureSwitch('gm-image-allowed', '加入监控白名单', config.imageMonitor?.allowed, '白名单模式下允许监控本群', disabled)}
        ${renderFeatureSwitch('gm-image-blocked', '加入监控黑名单', config.imageMonitor?.blocked, '本群不做图片监控', disabled)}
      </section>

      <section class="group-management-control-block group-management-local-block">
        <h3>本群管理</h3>
        <div class="setting-help">集中管理当前群的入群验证、申请自动通过和入群欢迎配置。</div>
        <div class="group-management-nested-grid">
          <div class="group-management-nested-block">
            <div class="group-management-block-head">
              <h4>入群验证</h4>
              <div class="detail-tags"><span class="detail-tag">${escapeHtml(authSourceLabel)}</span></div>
              <button type="button" class="mini-btn" data-action="clear-auth" ${disabledAttr}>恢复默认</button>
            </div>
            <div class="setting-help">未单独保存时使用默认群设置；保存差异后才会写入 auth.groups.${escapeHtml(group.groupId)}。</div>
            ${renderFeatureSwitch('gm-auth-enable', '启用本群入群验证', auth.enable, '新成员入群时触发验证流程', disabled)}
            ${renderFeatureSwitch('gm-auth-carbon-enable', '使用手性碳验证', carbon.enable, '关闭时使用数字计算验证', disabled)}
            ${renderFeatureSwitch('gm-auth-carbon-hint', '显示手性碳提示', carbon.hint !== false, '仅手性碳验证模式有效', disabled)}
            ${renderFeatureSwitch('gm-auth-carbon-hard', '手性碳困难模式', carbon['hard-mode'] === true, '需要找出全部正确区域', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">验证超时（秒）</span>
                <input id="gm-auth-timeout" type="number" min="30" max="1800" step="10" value="${escapeHtml(auth.timeout || 180)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">答错次数</span>
                <input id="gm-auth-frequency" type="number" min="1" max="20" step="1" value="${escapeHtml(auth.frequency || 5)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-auth-recall', '撤回答错消息', auth.recall !== false, '验证失败时尝试撤回成员错误答案', disabled)}
          </div>

          <div class="group-management-nested-block">
            <h4>加群申请自动通过</h4>
            <div class="setting-help">只自动同意满足条件的申请；条件不满足或适配器拿不到 QQ 等级时，会保留人工审核。</div>
            ${renderFeatureSwitch('gm-auto-approve-enable', '启用自动通过', autoApprove.enable === true, '可用于 QQ 等级、年龄、申请理由关键词等条件', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">最低 QQ 等级</span>
                <input id="gm-auto-min-qq-level" type="number" min="0" max="255" step="1" value="${escapeHtml(autoApprove.minQqLevel || 0)}" ${disabledAttr} />
                <div class="setting-help">0 表示不检查；例如 20 表示 QQ 等级大于等于 20。</div>
              </label>
              <label class="setting-item">
                <span class="kv-label">最低年龄</span>
                <input id="gm-auto-min-age" type="number" min="0" max="150" step="1" value="${escapeHtml(autoApprove.minAge || 0)}" ${disabledAttr} />
                <div class="setting-help">0 表示不检查；资料无法读取时不会自动通过。</div>
              </label>
            </div>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">申请理由必要关键词</span>
              <textarea id="gm-auto-comment-keywords" rows="4" ${disabledAttr} placeholder="一行一个关键词，留空表示不检查">${escapeHtml((autoApprove.commentKeywords || []).join('\n'))}</textarea>
            </label>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">拦截关键词</span>
              <textarea id="gm-auto-blocked-keywords" rows="4" ${disabledAttr} placeholder="命中这些词时不自动通过">${escapeHtml((autoApprove.blockedKeywords || []).join('\n'))}</textarea>
            </label>
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">自定义条件</span>
              <textarea id="gm-auto-custom-rules" rows="5" ${disabledAttr} placeholder="例如：qq等级 >= 20&#10;年龄 >= 18&#10;申请理由 包含 原神">${escapeHtml((autoApprove.customRules || []).join('\n'))}</textarea>
              <div class="setting-help">支持字段：qq等级、年龄、申请理由、昵称、QQ；支持 >= <= > < = != 包含 不包含。</div>
            </label>
            ${renderFeatureSwitch('gm-auto-risk-enabled', '启用入群风险评分', autoApprove.risk?.enabled === true, '申请记录会显示风险分，并接入本群黑白名单和警告积分。', disabled)}
            ${renderFeatureSwitch('gm-auto-risk-score-enabled', '记录风险分', autoApprove.risk?.scoreEnabled === true, '关闭后只保留普通自动通过条件，不再计算风险分。', disabled)}
            ${renderFeatureSwitch('gm-auto-risk-block-blacklist', '黑名单不自动通过', autoApprove.risk?.blockBlacklistAutoApprove === true, '申请人命中本群黑名单时保留人工审核。', disabled)}
            ${renderFeatureSwitch('gm-auto-risk-auto-whitelist', '白名单直接通过', autoApprove.risk?.autoApproveWhitelisted === true, '申请人命中本群白名单时可跳过等级、年龄和申请理由条件。', disabled)}
            ${renderFeatureSwitch('gm-auto-risk-hold-high', '高风险保留人工审核', autoApprove.risk?.holdHighRisk === true, '风险分达到阈值时不自动通过。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">高风险阈值</span>
                <input id="gm-auto-risk-high-score" type="number" min="1" max="100" step="1" value="${escapeHtml(autoApprove.risk?.highRiskScore || 70)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">警告拦截阈值</span>
                <input id="gm-auto-risk-warning-threshold" type="number" min="0" max="100" step="1" value="${escapeHtml(autoApprove.risk?.warningBlockThreshold ?? 3)}" ${disabledAttr} />
                <div class="setting-help">0 表示不按警告积分拦截自动通过。</div>
              </label>
            </div>
          </div>

          <div class="group-management-nested-block group-management-moderation-block">
            <h4>黑白名单与警告积分</h4>
            <div class="setting-help">一行一个 QQ，可在 QQ 后面写备注；黑名单不会自动通过，白名单可按上方策略直接通过。</div>
            <div class="settings-grid group-management-moderation-lists">
              <label class="setting-item group-management-textarea-item">
                <span class="kv-label">黑名单</span>
                <textarea id="gm-moderation-blacklist" rows="6" ${disabledAttr} placeholder="123456789 广告号">${escapeHtml(formatModerationListForEdit(moderation.blacklist || []))}</textarea>
              </label>
              <label class="setting-item group-management-textarea-item">
                <span class="kv-label">白名单</span>
                <textarea id="gm-moderation-whitelist" rows="6" ${disabledAttr} placeholder="123456789 老成员小号">${escapeHtml(formatModerationListForEdit(moderation.whitelist || []))}</textarea>
              </label>
            </div>
            <div class="group-management-warning-editor">
              <input id="gm-warning-user-id" placeholder="QQ 号" inputmode="numeric" ${disabledAttr} />
              <input id="gm-warning-reason" placeholder="警告原因" ${disabledAttr} />
              <button type="button" class="mini-btn" data-action="add-member-warning" ${disabledAttr}>增加警告</button>
              <button type="button" class="mini-btn danger" data-action="clear-member-warning" ${disabledAttr}>清空警告</button>
            </div>
            ${renderWarningList(moderation.warnings || [])}
          </div>

          <div class="group-management-nested-block group-management-content-block">
            <h4>防广告/防刷屏</h4>
            <div class="detail-tags"><span class="detail-tag">${escapeHtml(contentSourceLabel)}</span></div>
            <div class="setting-help">这个群没有单独设置时，会使用默认群设置；撤回、禁言、踢人会先经过安全开关。</div>
            ${(() => {
              const urlSafety = contentModeration.urlSafety || {};
              return `
                ${renderFeatureSwitch('gm-content-url-safety-enabled', '启用链接安全检查', urlSafety.enabled === true, '检查群员发送的网页链接，并判断是否存在钓鱼、诈骗、恶意下载等风险。默认关闭。', disabled)}
                <div class="settings-grid group-management-small-grid">
                  <label class="setting-item">
                    <span class="kv-label">URL 风险阈值</span>
                    <select id="gm-content-url-safety-threshold" ${disabledAttr}>
                      ${renderUrlSafetyRiskOptions(urlSafety.riskThreshold || 'high')}
                    </select>
                  </label>
                  <label class="setting-item">
                    <span class="kv-label">每条消息检查 URL 数</span>
                    <input id="gm-content-url-safety-max-urls" type="number" min="1" max="5" step="1" value="${escapeHtml(urlSafety.maxUrlsPerMessage || 2)}" ${disabledAttr} />
                  </label>
                  <label class="setting-item">
                    <span class="kv-label">网页读取最大字符</span>
                    <input id="gm-content-url-safety-md-length" type="number" min="1000" max="20000" step="500" value="${escapeHtml(urlSafety.markdownMaxLength || 6000)}" ${disabledAttr} />
                  </label>
                  <label class="setting-item">
                    <span class="kv-label">检查超时（毫秒）</span>
                    <input id="gm-content-url-safety-timeout" type="number" min="20000" max="60000" step="1000" value="${escapeHtml(urlSafety.timeoutMs || 20000)}" ${disabledAttr} />
                  </label>
                </div>
                <label class="setting-item group-management-textarea-item">
                  <span class="kv-label">链接检查白名单</span>
                  <textarea id="gm-content-url-safety-whitelist" rows="4" ${disabledAttr} placeholder="一行一个域名或 URL，例如：bilibili.com&#10;*.qq.com&#10;example.com/path">${escapeHtml((urlSafety.whitelist || []).join('\n'))}</textarea>
                  <div class="setting-help">白名单里的链接不会检查；其他链接检查过一次后会复用结果，减少重复请求。</div>
                </label>
              `;
            })()}
            ${renderFeatureSwitch('gm-content-enabled', '启用群消息风控', contentModeration.enabled === true, '检测广告链接、关键词、重复消息和刷屏。', disabled)}
            ${renderFeatureSwitch('gm-content-exempt-admins', '跳过群主和管理员', contentModeration.exemptAdmins === true, '避免误处理群管理人员。', disabled)}
            ${renderFeatureSwitch('gm-content-detect-links', '检测链接', contentModeration.detectLinks === true, '命中 URL、QQ群链接、短链等会触发。', disabled)}
            ${renderFeatureSwitch('gm-content-detect-keywords', '检测关键词', contentModeration.detectBlockedKeywords === true, '命中下方关键词会触发。', disabled)}
            <label class="setting-item group-management-textarea-item">
              <span class="kv-label">广告/违规关键词</span>
              <textarea id="gm-content-blocked-keywords" rows="5" ${disabledAttr} placeholder="一行一个关键词">${escapeHtml((contentModeration.blockedKeywords || []).join('\n'))}</textarea>
            </label>
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">重复次数</span>
                <input id="gm-content-repeat-limit" type="number" min="2" max="20" step="1" value="${escapeHtml(contentModeration.repeatLimit || 4)}" ${disabledAttr} />
              </label>
              <label class="setting-item">
                <span class="kv-label">重复窗口秒</span>
                <input id="gm-content-repeat-window" type="number" min="5" max="600" step="5" value="${escapeHtml(contentModeration.repeatWindowSeconds || 45)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-content-detect-spam', '启用刷屏检测', contentModeration.detectSpamMessages === true, '同一成员在指定时间内发送超过阈值条数时触发。', disabled)}
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">刷屏阈值</span>
                <input id="gm-content-burst-limit" type="number" min="2" max="60" step="1" value="${escapeHtml(contentModeration.burstLimit || 8)}" ${disabledAttr} />
                <div class="setting-help">同一成员超过这个条数才触发，例如填 8 表示第 9 条触发。</div>
              </label>
              <label class="setting-item">
                <span class="kv-label">刷屏窗口秒</span>
                <input id="gm-content-burst-window" type="number" min="5" max="600" step="5" value="${escapeHtml(contentModeration.burstWindowSeconds || 60)}" ${disabledAttr} />
              </label>
            </div>
            <div class="settings-grid group-management-small-grid">
              <label class="setting-item">
                <span class="kv-label">触发动作</span>
                <select id="gm-content-action" ${disabledAttr}>
                  ${renderModerationActionOptions(contentModeration.action || 'log')}
                </select>
              </label>
              <label class="setting-item">
                <span class="kv-label">禁言秒数</span>
                <input id="gm-content-mute-seconds" type="number" min="60" max="2592000" step="60" value="${escapeHtml(contentModeration.muteSeconds || 600)}" ${disabledAttr} />
              </label>
            </div>
            ${renderFeatureSwitch('gm-content-add-warning', '触发后增加警告积分', contentModeration.addWarning === true, '风险评分和申请审核会读取该成员的警告积分。', disabled)}
            ${renderContentSafetyWarning(contentModeration)}
          </div>

          <div class="group-management-nested-block group-management-content-block">
            <h4>新人观察期</h4>
            <div class="setting-help">新成员入群后的一段时间内可单独限制链接，适合防小号进群即广告。</div>
            ${renderFeatureSwitch('gm-content-observe-new', '启用新人观察期', contentModeration.observeNewMembers === true, '启用后会读取新成员入群时间或运行时入群事件。', disabled)}
            ${renderFeatureSwitch('gm-content-observe-block-links', '观察期禁止链接', contentModeration.observeBlockLinks === true, '新人观察期内发送链接会触发群消息风控。', disabled)}
            <label class="setting-item">
              <span class="kv-label">观察时长（分钟）</span>
              <input id="gm-content-observe-minutes" type="number" min="1" max="10080" step="5" value="${escapeHtml(contentModeration.observeMinutes || 60)}" ${disabledAttr} />
            </label>
          </div>

          <div class="group-management-nested-block">
            <div class="group-management-block-head">
              <h4>入群欢迎</h4>
              <div class="detail-tags"><span class="detail-tag">${escapeHtml(welcomeSourceLabel)}</span></div>
              <button type="button" class="mini-btn danger" data-action="clear-welcome" ${disabledAttr}>恢复默认</button>
            </div>
            <div class="setting-help">未单独保存时使用默认欢迎；保存差异后才会写入 newcomer.${escapeHtml(group.groupId)}。</div>
            ${renderFeatureSwitch('gm-welcome-enabled', '启用本群入群欢迎', welcome.enabled === true, '关闭时即使保留文案和图片，也不会自动发送欢迎。', disabled)}
            ${renderFeatureSwitch('gm-welcome-ai-enabled', '启用 AI 入群欢迎', welcome.aiEnabled === true, '开启后 AI 会生成新人欢迎文案；接口故障或不可用时自动回退到普通欢迎。', disabled)}
            <textarea id="gm-welcome-text" rows="6" maxlength="1000" ${disabledAttr} placeholder="输入新人欢迎文案">${escapeHtml(welcome.text || '')}</textarea>
            <div class="group-management-welcome-image-editor">
              <div class="group-management-welcome-preview">
                ${groupManagementState.welcomeDeleteImage
                  ? '<div class="group-management-welcome-preview-empty">保存后删除欢迎图片</div>'
                  : (groupManagementState.welcomeImagePreviewUrl || welcome.imagePreviewUrl)
                    ? `<img src="${escapeHtml(groupManagementState.welcomeImagePreviewUrl || welcome.imagePreviewUrl)}" alt="欢迎图片预览" />`
                    : '<div class="group-management-welcome-preview-empty">未设置欢迎图片</div>'}
              </div>
              <div class="group-management-welcome-image-actions">
                <input id="gm-welcome-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" ${disabledAttr} />
                <div class="actions">
                  <button type="button" class="mini-btn danger" data-action="delete-welcome-image" ${disabledAttr} ${welcome.hasImage || groupManagementState.welcomeImageFile ? '' : 'disabled'}>删除图片</button>
                </div>
                <div class="setting-help">当前图片：${groupManagementState.welcomeImageFile ? escapeHtml(groupManagementState.welcomeImageFile.name) : welcome.hasImage ? escapeHtml(welcome.imageName || '已设置') : '未设置'}。支持 png / jpg / webp / gif，最大 5MB。</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="group-management-members-panel">
      <div class="group-management-members-head">
        <div>
          <h3>加群申请</h3>
          <div id="group-management-join-requests-meta" class="setting-help">显示已收到但尚未处理的加群申请。</div>
        </div>
        <div class="toolbar group-management-members-toolbar">
          <input id="group-management-join-request-search" placeholder="搜索 QQ / 昵称 / 申请理由" value="${escapeHtml(groupManagementState.joinRequestQuery)}" />
          <button type="button" class="mini-btn" data-action="load-join-requests">刷新申请</button>
        </div>
      </div>
      <div id="group-management-join-requests" class="list">尚未读取。</div>
      <div id="group-management-join-request-pagination" class="pagination"></div>
    </section>

    <section class="group-management-members-panel">
      <div class="group-management-members-head">
        <div>
          <h3>头衔申请</h3>
          <div id="group-management-title-applications-meta" class="setting-help">查看待审核和历史头衔申请，可在控制台手动通过或拒绝。</div>
        </div>
        <div class="toolbar group-management-members-toolbar">
          <select id="group-management-title-application-status">
            <option value="pending" ${groupManagementState.titleApplicationStatus === 'pending' ? 'selected' : ''}>待审核</option>
            <option value="failed" ${groupManagementState.titleApplicationStatus === 'failed' ? 'selected' : ''}>发放失败</option>
            <option value="approved" ${groupManagementState.titleApplicationStatus === 'approved' ? 'selected' : ''}>已通过</option>
            <option value="rejected" ${groupManagementState.titleApplicationStatus === 'rejected' ? 'selected' : ''}>已拒绝</option>
            <option value="all" ${groupManagementState.titleApplicationStatus === 'all' ? 'selected' : ''}>全部</option>
          </select>
          <input id="group-management-title-application-search" placeholder="搜索编号 / QQ / 昵称 / 头衔" value="${escapeHtml(groupManagementState.titleApplicationQuery)}" />
          <button type="button" class="mini-btn" data-action="load-title-applications">刷新头衔申请</button>
        </div>
      </div>
      <div id="group-management-title-applications" class="list">尚未读取。</div>
      <div id="group-management-title-application-pagination" class="pagination"></div>
    </section>

    <section class="group-management-members-panel">
      <div class="group-management-members-head">
        <div>
          <h3>成员列表</h3>
          <div id="group-management-members-meta" class="setting-help">点击读取成员列表。</div>
        </div>
        <div class="toolbar group-management-members-toolbar">
          <input id="group-management-member-search" placeholder="搜索 QQ / 昵称 / 群名片" value="${escapeHtml(groupManagementState.memberQuery)}" />
          <button type="button" class="mini-btn" data-action="load-members">读取成员</button>
        </div>
      </div>
      <div id="group-management-members" class="list">尚未读取。</div>
      <div id="group-management-member-pagination" class="pagination"></div>
    </section>
  `;

  renderJoinRequests();
  renderTitleApplications();
  renderMembers();
  enhanceGroupManagementDetailCollapses();
}
