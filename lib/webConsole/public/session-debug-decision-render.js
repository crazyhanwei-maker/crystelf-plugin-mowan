function formatDecisionSource(source) {
  const sourceMap = {
    direct: '直接触发',
    nickname: '昵称触发',
    follow_up: '连续对话接话',
    cooldown_replay: '冷却后补处理',
    delayed_batch: '延迟聚合处理',
    queued_replay: '队列补处理',
  };
  return sourceMap[String(source || '').trim()] || String(source || '未知');
}

function formatDecisionStatus(status) {
  const statusMap = {
    running: '运行中',
    generated: '已生成候选结果',
    success: '已成功发送',
    fallback: '进入兜底回复',
    invalid: '运行异常',
  };
  return statusMap[String(status || '').trim()] || String(status || '未知');
}

function formatResponseStyle(style) {
  const styleMap = {
    normal: '正常',
    concise: '简洁',
    detailed: '详细',
  };
  return styleMap[String(style || '').trim()] || String(style || '正常');
}

function formatMs(value) {
  const ms = Number(value || 0);
  if (!ms) return '暂无';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(ms < 600000 ? 1 : 0)} 分钟`;
  return `${(ms / 3600000).toFixed(1)} 小时`;
}

function renderDecisionExplanation(decision) {
  if (!decision || typeof decision !== 'object') {
    return '<span class="setting-help">暂无</span>';
  }

  const trigger = decision.trigger || {};
  const context = decision.context || {};
  const sessionControl = decision.sessionControl || {};
  const capabilities = decision.capabilities || {};
  const result = decision.result || {};
  const triggerTags = [
    `来源：${formatDecisionSource(trigger.source)}`,
    trigger.atBot ? '命中 @' : '',
    trigger.ruleTriggered ? '命中规则' : '',
    trigger.nicknameMentioned ? '命中昵称' : '',
    trigger.followUpActive ? '连续对话生效' : '',
  ].filter(Boolean);
  const toolNames = Array.isArray(result.toolNames) ? result.toolNames.filter(Boolean) : [];
  const knowledgeTitles = Array.isArray(context.knowledgeTitles) ? context.knowledgeTitles.filter(Boolean) : [];
  const groups = [
    {
      title: '触发',
      lines: [
        trigger.reason || '暂无',
        trigger.customReason ? `附加标记：${trigger.customReason}` : '',
        `连续对话：${trigger.followUpEnabled ? (trigger.followUpActive ? '当前生效' : '已开启但本轮未生效') : '未开启'} / ${trigger.followUpPaused ? '已暂停接话' : '未暂停'}`,
        `距上次回复：${formatMs(trigger.timeSinceLastBotMs)} / 回复后消息数：${Number(trigger.messageCountAfterBot || 0)} / ${Number(trigger.followUpMaxMessages || 0) || '未限制'}`,
      ].filter(Boolean),
    },
    {
      title: '上下文',
      lines: [
        `历史消息：${Number(context.historyCount || 0)} 条`,
        `知识库：${context.knowledgeEnabled ? `已开启，命中 ${Number(context.knowledgeMatchCount || 0)} 条` : '未开启'}`,
        knowledgeTitles.length ? `知识条目：${knowledgeTitles.join('、')}` : '',
        `记忆/好感/话题/表达/画像：${context.memoryUsed ? '记忆' : '无记忆'} / ${context.affinityUsed ? '好感' : '无好感'} / ${context.topicUsed ? '话题' : '无话题'} / ${context.expressionUsed ? '表达' : '无表达'} / ${context.userProfileUsed ? '画像' : '无画像'}`,
        `图片上下文：${Number(context.imageContextCount || 0)} 张`,
      ].filter(Boolean),
    },
    {
      title: '控制',
      lines: [
        `联网搜索：${sessionControl.disableSearch ? '已禁用' : '允许'}`,
        `知识库模式：${sessionControl.knowledgeOnly ? '只用知识库' : '正常模式'}`,
        `回复风格：${formatResponseStyle(sessionControl.responseStyle)}`,
        `自动接话：${sessionControl.pauseFollowUp ? '已暂停' : '正常'}`,
      ],
    },
    {
      title: '结果',
      lines: [
        `状态：${formatDecisionStatus(result.status)}`,
        `输出：文本 ${result.hasTextOutput ? '有' : '无'} / 语音 ${result.hasVoiceOutput ? '有' : '无'} / 表情 ${result.hasEmojiOutput ? '有' : '无'}`,
        `工具调用：${Number(result.toolCallCount || 0)} 次${toolNames.length ? `（${toolNames.join('、')}）` : ''}`,
        `能力选择：${capabilities.forceSearch ? '强制联网判定' : '无需强制联网'} / ${capabilities.multimodalInput ? '多模态输入' : '纯文本输入'} / ${capabilities.ttsAllowed ? '允许 AI 触发语音' : '未开启 AI 触发语音'}`,
        `排查提示：${capabilities.toolStatusHintsEnabled ? '工具状态提示已开' : '工具状态提示已关'} / ${capabilities.knowledgeDebugHintsEnabled ? '知识提示已开' : '知识提示已关'}`,
        result.fallbackUsed ? '本轮使用了兜底路径' : '',
        result.failureReason ? `失败原因：${result.failureReason}` : '',
      ].filter(Boolean),
    },
  ];

  return `
    <div class="session-debug-decision-tags">
      ${triggerTags.length ? triggerTags.map(item => `<span class="sandbox-rag-token">${escapeHtml(item)}</span>`).join('') : '<span class="setting-help">暂无标签</span>'}
    </div>
    <div class="session-debug-decision-grid">
      ${groups.map(group => `
        <div class="session-debug-decision-card">
          <h4>${escapeHtml(group.title)}</h4>
          ${group.lines.length ? group.lines.map(line => `<div class="setting-help">${escapeHtml(line)}</div>`).join('') : '<div class="setting-help">暂无</div>'}
        </div>
      `).join('')}
    </div>
  `;
}

function buildDecisionLogLines(decision) {
  if (!decision || typeof decision !== 'object') {
    return ['- 暂无'];
  }

  const trigger = decision.trigger || {};
  const context = decision.context || {};
  const sessionControl = decision.sessionControl || {};
  const capabilities = decision.capabilities || {};
  const result = decision.result || {};

  return [
    `- 触发来源: ${formatDecisionSource(trigger.source)}`,
    `- 触发原因: ${trigger.reason || '暂无'}`,
    trigger.customReason ? `- 附加标记: ${trigger.customReason}` : '',
    `- 连续对话: ${trigger.followUpEnabled ? (trigger.followUpActive ? '当前生效' : '已开启但未生效') : '未开启'} / ${trigger.followUpPaused ? '已暂停接话' : '未暂停'}`,
    `- 距上次回复: ${formatMs(trigger.timeSinceLastBotMs)} / 回复后消息数: ${Number(trigger.messageCountAfterBot || 0)} / ${Number(trigger.followUpMaxMessages || 0) || '未限制'}`,
    `- 历史消息: ${Number(context.historyCount || 0)} 条 / 图片上下文: ${Number(context.imageContextCount || 0)} 张`,
    `- 知识库: ${context.knowledgeEnabled ? `已开启，命中 ${Number(context.knowledgeMatchCount || 0)} 条` : '未开启'}`,
    Array.isArray(context.knowledgeTitles) && context.knowledgeTitles.length ? `- 知识条目: ${context.knowledgeTitles.join('、')}` : '',
    `- 记忆/好感/话题/表达/画像: ${context.memoryUsed ? '记忆' : '无记忆'} / ${context.affinityUsed ? '好感' : '无好感'} / ${context.topicUsed ? '话题' : '无话题'} / ${context.expressionUsed ? '表达' : '无表达'} / ${context.userProfileUsed ? '画像' : '无画像'}`,
    `- 会话控制: 联网${sessionControl.disableSearch ? '禁用' : '允许'} / ${sessionControl.knowledgeOnly ? '只用知识库' : '正常模式'} / 风格${formatResponseStyle(sessionControl.responseStyle)} / 接话${sessionControl.pauseFollowUp ? '暂停' : '正常'}`,
    `- 能力选择: ${capabilities.forceSearch ? '强制联网判定' : '无需强制联网'} / ${capabilities.multimodalInput ? '多模态输入' : '纯文本输入'} / ${capabilities.ttsAllowed ? '允许 AI 触发语音' : '未开启 AI 触发语音'}`,
    `- 排查提示: ${capabilities.toolStatusHintsEnabled ? '工具状态提示已开' : '工具状态提示已关'} / ${capabilities.knowledgeDebugHintsEnabled ? '知识提示已开' : '知识提示已关'}`,
    `- 最终状态: ${formatDecisionStatus(result.status)}`,
    `- 输出: 文本${result.hasTextOutput ? '有' : '无'} / 语音${result.hasVoiceOutput ? '有' : '无'} / 表情${result.hasEmojiOutput ? '有' : '无'}`,
    `- 工具调用: ${Number(result.toolCallCount || 0)} 次${Array.isArray(result.toolNames) && result.toolNames.length ? ` (${result.toolNames.join('、')})` : ''}`,
    result.fallbackUsed ? '- 本轮使用了兜底路径' : '',
    result.failureReason ? `- 失败原因: ${result.failureReason}` : '',
  ].filter(Boolean);
}
