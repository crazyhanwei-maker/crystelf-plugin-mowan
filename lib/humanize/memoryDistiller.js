// 长期记忆蒸馏器：
// - 攒批异步提炼：prompt 窗口（chatHistory）之外的旧消息，攒满一批用 1 次 LLM 提炼成事实条目
// - 本地打分注入：回复时按当前消息与记忆条目的关键词重合度选取，零 LLM、零额外请求
// 设计取舍：不做每条回复的实时检索（旧 ReAct 链路最坏 +4 次 LLM），记忆在离线批处理中沉淀
export class MemoryDistiller {
  constructor(ai, config, db) {
    this.ai = ai;
    this.config = config;
    this.db = db;
    this.distilling = new Set();
    this.batchSize = Number(config?.memory?.extractBatchSize) || 40;
  }

  get enabled() {
    return this.config?.memory?.enabled !== false;
  }

  // 每条群消息调用：仅计数，达到批量阈值时异步提炼（不阻塞回复）
  onMessage(sessionId) {
    if (!this.enabled || !sessionId || this.distilling.has(sessionId)) return;
    const history = this.db.getMessages(sessionId, this.batchSize + 30);
    if (!history.length) return;
    const cursor = this.db.getMemoryCursor(sessionId);
    const promptWindow = Number(this.config?.chatHistory) || 30;
    const candidates = history.filter(message => (message.id || 0) > cursor);
    const distillableCount = candidates.length - promptWindow;
    if (distillableCount < Math.floor(this.batchSize / 2)) return;

    const batch = candidates.slice(0, distillableCount);
    this.distilling.add(sessionId);
    this.distill(sessionId, batch)
      .catch(error => logger?.warn?.(`[MemoryDistiller] 提炼失败: ${error.message}`))
      .finally(() => this.distilling.delete(sessionId));
  }

  async distill(sessionId, messages) {
    if (!messages.length) return;
    const lines = messages.map(message => {
      const time = new Date(message.timestamp || Date.now());
      const stamp = `${time.getMonth() + 1}/${time.getDate()} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
      return `[${stamp}] ${message.userName || message.userId || '群友'}: ${message.content}`;
    }).join('\n');

    const content = await this.ai.generateText({
      prompt: `以下是某QQ群一段时期的历史聊天记录。请提炼出值得长期记住的信息条目（事件、约定、重要偏好、群内动向等）。

聊天记录：
${lines}

要求：
1. 只记录有长期价值的信息，寒暄灌水忽略。
2. 每条一句话，包含必要的谁/什么事，将来单独看也能懂。
3. 最多 8 条，没有值得记的就输出空数组。
4. 输出语言与记录一致。

输出严格 JSON：{"memories":["...","..."]}`,
      messages: [],
      model: this.config?.workingModel || this.config?.modelType || this.config?.model,
      temperature: 0.2,
      max_tokens: 16384,
    });

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const parsed = JSON.parse(jsonMatch[0]);
    const entries = (Array.isArray(parsed?.memories) ? parsed.memories : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 8)
      .map(text => ({
        content: text,
        createdAt: messages[messages.length - 1]?.timestamp || Date.now(),
      }));

    const cursor = Math.max(...messages.map(message => message.id || 0));
    this.db.saveMemories(sessionId, entries, cursor);
    logger?.info?.(`[MemoryDistiller] ${sessionId} 提炼 ${entries.length} 条长期记忆（cursor=${cursor}）`);
  }

  // 回复时注入：当前消息与记忆条目做本地关键词重合打分，取 topN；无命中时回退到最近几条
  getMemoryContext(sessionId, currentText = '', userName = '') {
    if (!this.enabled) return '';
    const memories = this.db.getMemories(sessionId, 60);
    if (!memories.length) return '';

    const tokens = tokenizeForMemory(currentText);
    const scored = memories.map(memory => {
      const text = String(memory.content || '').toLowerCase();
      const hits = tokens.filter(token => text.includes(token)).length;
      const recency = Math.max(0, 1 - (Date.now() - (memory.createdAt || 0)) / (30 * 24 * 3600 * 1000));
      return { memory, score: hits * 3 + recency };
    });
    scored.sort((left, right) => right.score - left.score);
    const selected = scored.slice(0, 6).filter(item => item.score > 0.5);
    if (!selected.length) return '';

    const lines = selected.map(item => {
      const memory = item.memory;
      const time = memory.createdAt ? new Date(memory.createdAt) : null;
      const stamp = time ? `${time.getMonth() + 1}/${time.getDate()}` : '';
      return `- ${stamp ? `(${stamp}) ` : ''}${memory.content}`;
    });
    const who = userName ? `${userName}及相关群友` : '群友';
    return `## Long-term Memory\n与${who}有关的既往事件/约定/事实，回复时可自然引用：\n${lines.join('\n')}\n(仅作背景参考，不要刻意复述)`;
  }
}

function tokenizeForMemory(value = '') {
  const text = String(value || '').toLowerCase().trim();
  if (!text) return [];
  const tokens = new Set();
  const phrases = text.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/g) || [];
  phrases.forEach(token => tokens.add(token));
  const compact = text.replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');
  if (/^[\u4e00-\u9fa5]+$/.test(compact) && compact.length >= 2) {
    for (let size = Math.min(3, compact.length); size >= 2; size--) {
      for (let index = 0; index <= compact.length - size; index++) {
        tokens.add(compact.slice(index, index + size));
      }
    }
  }
  return [...tokens];
}
