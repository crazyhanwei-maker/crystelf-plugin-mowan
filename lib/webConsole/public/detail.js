async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return await response.json();
}

function formatTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function renderMissingDetail(targetId, message, backHref) {
  document.getElementById('detail-meta').textContent = '等待选择记录';
  const target = document.getElementById(targetId);
  if (target) {
    target.textContent = `${message}\n\n返回列表：${backHref}`;
  }
}

async function initProfileDetail() {
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('sessionId') || '';
  const userId = params.get('userId') || '';
  if (!sessionId || !userId) {
    renderMissingDetail('profile-detail-page', '请先从用户画像列表打开某个用户的详情。', '/profile-center.html');
    return;
  }
  const data = await fetchJson(`/api/profile-detail?sessionId=${encodeURIComponent(sessionId)}&userId=${encodeURIComponent(userId)}`);
  const profile = data.profile;
  const messages = data.recentMessages || [];
  document.getElementById('detail-meta').textContent = `${profile.userName || profile.userId} · ${profile.sessionId}`;
  document.getElementById('profile-detail-page').textContent = [
    `用户：${profile.userName || profile.userId}`,
    `会话：${profile.sessionId}`,
    `概括：${profile.summary || '暂无'}`,
    `特征：${(profile.traits || []).join('、') || '暂无'}`,
    `说话风格：${(profile.speakingStyle || []).join('、') || '暂无'}`,
    `互动偏好：${(profile.interactionPreferences || []).join('、') || '暂无'}`,
    `常聊话题：${(profile.notableTopics || []).join('、') || '暂无'}`,
    `置信度：${profile.confidence || '中'}`,
    `参考消息数：${profile.sourceMessageCount || 0}`,
    `更新时间：${formatTime(profile.updatedAt)}`,
    '',
    '最近相关消息：',
    ...messages.map(item => `[${formatTime(item.timestamp)}] ${item.userName || profile.userName || profile.userId}: ${item.content}`),
  ].join('\n');
}

async function initAffinityDetail() {
  const params = new URLSearchParams(location.search);
  const groupId = params.get('groupId') || '';
  const userId = params.get('userId') || '';
  if (!groupId || !userId) {
    renderMissingDetail('affinity-detail-page', '请先从好感度列表打开某个用户的历史详情。', '/affinity-center.html');
    return;
  }
  const data = await fetchJson(`/api/affinity-history?groupId=${encodeURIComponent(groupId)}&userId=${encodeURIComponent(userId)}`);
  document.getElementById('detail-meta').textContent = `${groupId} / ${userId}`;
  const current = data.current;
  const entries = data.entries || [];
  document.getElementById('affinity-detail-page').textContent = [
    current
      ? `当前分值：${current.score || 0} · 互动：${current.interaction_count || 0} · 最近原因：${current.last_reason || '无'}`
      : '当前记录：已不存在或未建立',
    '',
    '变更历史：',
    ...(entries.length > 0
      ? entries.map(item => [
          `时间：${formatTime(item.time)}`,
          `变化：${item.delta ?? 0} · 结果：${item.current_score ?? 0} · 档位：${item.level || '未知'}`,
          `原因：${item.reason || '无'}${item.guard ? ` · 保护：${item.guard}` : ''}`,
          `文本：${item.text_preview || '无'}`,
          '',
        ].join('\n'))
      : ['暂无历史记录']),
  ].join('\n');
}

const pathName = location.pathname;
const runner = pathName.includes('profile-detail') ? initProfileDetail : initAffinityDetail;

runner().catch(error => {
  const pre = document.createElement('pre');
  pre.textContent = `详情加载失败: ${error?.message || String(error)}`;
  document.body.replaceChildren(pre);
});
