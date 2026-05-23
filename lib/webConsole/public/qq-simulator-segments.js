(function () {
  const { ADAPTER_LABELS } = window.CrystelfQqSimulatorConfig;
  const {
    toArray,
    isPlainObject,
    stringifyItem,
    formatBytes,
    estimateDataUrlSize,
    encodeCqValue,
  } = window.CrystelfQqSimulatorRuntime;

  function normalizeAdapterFormat(value = '') {
    const adapter = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(ADAPTER_LABELS, adapter) ? adapter : 'onebot';
  }

  function decodeCqValue(value = '') {
    return String(value || '')
      .replace(/&#44;/g, ',')
      .replace(/&#91;/g, '[')
      .replace(/&#93;/g, ']')
      .replace(/&amp;/g, '&');
  }

  function parseCqParams(raw = '') {
    const params = {};
    String(raw || '')
      .replace(/^,/, '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(item => {
        const index = item.indexOf('=');
        if (index <= 0) return;
        const key = item.slice(0, index).trim();
        const value = item.slice(index + 1);
        params[key] = decodeCqValue(value);
      });
    return params;
  }

  function normalizeSegmentObject(value = {}) {
    const source = isPlainObject(value) ? value : {};
    const data = isPlainObject(source.data) ? source.data : {};
    const type = String(source.type || source.messageType || source.message_type || '').trim().toLowerCase();
    if (Array.isArray(source.message) || typeof source.message === 'string') {
      return normalizeMessageSegments(source.message);
    }
    if (Array.isArray(source.segments)) {
      return normalizeMessageSegments(source.segments);
    }
    if (type === 'text' || (!type && (source.text || source.content))) {
      return [{ type: 'text', text: String(data.text ?? source.text ?? source.content ?? '') }];
    }
    if (type === 'at') {
      return [{ type: 'at', qq: String(data.qq ?? source.qq ?? source.userId ?? source.user_id ?? '').trim() }];
    }
    if (['image', 'img'].includes(type)) {
      return [{
        type: 'image',
        url: String(data.url ?? source.url ?? data.file ?? source.file ?? source.imageUrl ?? '').trim(),
        label: String(data.file ?? source.file ?? data.url ?? source.url ?? '图片').trim(),
      }];
    }
    if (['record', 'voice', 'audio'].includes(type)) {
      return [{
        type: 'record',
        url: String(data.url ?? source.url ?? data.file ?? source.file ?? source.audioUrl ?? '').trim(),
        label: String(data.file ?? source.file ?? data.url ?? source.url ?? '语音').trim(),
      }];
    }
    if (type === 'reply') {
      return [{ type: 'reply', id: String(data.id ?? source.id ?? source.messageId ?? source.message_id ?? '').trim() }];
    }
    if (type === 'poke') {
      const qq = String(data.qq ?? data.id ?? source.qq ?? source.id ?? source.userId ?? source.user_id ?? '').trim();
      return [{ type: 'poke', qq, id: qq }];
    }
    if (type === 'memory') {
      return [{
        type: 'memory',
        data: String(data.data ?? source.data ?? source.text ?? '').trim(),
        key: Array.isArray(source.key) ? source.key : Array.isArray(data.key) ? data.key : [],
        timeout: Number(data.timeout ?? source.timeout ?? 0) || 0,
      }];
    }
    if (type === 'face') {
      return [{ type: 'face', text: String(data.id ?? source.id ?? source.text ?? '').trim() }];
    }
    if (type === 'meme') {
      return [{
        type: 'meme',
        character: String(data.character ?? source.character ?? source.name ?? '').trim(),
        emotion: String(data.emotion ?? source.emotion ?? source.variant ?? 'default').trim(),
      }];
    }
    if (type === 'cq' || source.cqType) {
      return [{
        type: 'cq',
        cqType: String(source.cqType || data.type || 'cq').trim() || 'cq',
        data: isPlainObject(source.data) ? { ...source.data } : {},
      }];
    }
    return [{ type: 'text', text: stringifyItem(source) }];
  }

  function normalizeCqToken(token = '') {
    const control = String(token || '');
    const atMarker = control.match(/^\[\[\[at:(\d+)\]\]\]$/i)
      || control.match(/^\(\(\(at:(\d+)\)\)\)$/i)
      || control.match(/^\(\(\((\d+)\)\)\)$/);
    if (atMarker) {
      return [{ type: 'at', qq: String(atMarker[1] || '').trim() }];
    }
    const pokeMarker = control.match(/^\[\[\[poke:(\d+)\]\]\]$/i)
      || control.match(/^\(\(\(poke:(\d+)\)\)\)$/i);
    if (pokeMarker) {
      const qq = String(pokeMarker[1] || '').trim();
      return [{ type: 'poke', qq, id: qq }];
    }
    const replyMarker = control.match(/^\[\[\[reply:([^\]]+)\]\]\]$/i)
      || control.match(/^\(\(\(reply:([^)]+)\)\)\)$/i);
    if (replyMarker) {
      return [{ type: 'reply', id: String(replyMarker[1] || '').trim() }];
    }
    const memoryMarker = control.match(/^\[\[\[memory:([^:]+):([^:]+):(\d+)\]\]\]$/i);
    if (memoryMarker) {
      return [{
        type: 'memory',
        data: String(memoryMarker[1] || '').trim(),
        key: String(memoryMarker[2] || '').split(',').map(item => item.trim()).filter(Boolean),
        timeout: Number(memoryMarker[3] || 0) || 0,
      }];
    }
    const cq = String(token || '').match(/^\[CQ:([a-zA-Z0-9_-]+)([\s\S]*)\]$/);
    if (cq) {
      const type = cq[1].toLowerCase();
      const params = parseCqParams(cq[2]);
      if (!['at', 'image', 'record', 'voice', 'audio', 'face', 'reply', 'poke'].includes(type)) {
        return [{ type: 'cq', cqType: type, data: params }];
      }
      return normalizeSegmentObject({ type, data: params });
    }
    const meme = String(token || '').match(/^\[meme:([^:\]]+)(?::([^\]]+))?\]$/);
    if (meme) {
      return [{
        type: 'meme',
        character: decodeCqValue(meme[1]),
        emotion: decodeCqValue(meme[2] || 'default'),
      }];
    }
    return [{ type: 'text', text: token }];
  }

  function normalizeTextSegments(text = '') {
    const source = String(text ?? '');
    const segments = [];
    const tokenPattern = /(\[CQ:[^\]]+\]|\[meme:[^\]]+\]|\[\[\[(?:at|poke):\d+\]\]\]|\[\[\[reply:[^\]]+\]\]\]|\[\[\[memory:[^\]]+\]\]\]|\(\(\((?:at|poke):\d+\)\)\)|\(\(\(reply:[^)]+\)\)\)|\(\(\(\d+\)\)\))/gi;
    let lastIndex = 0;
    let match;
    while ((match = tokenPattern.exec(source)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', text: source.slice(lastIndex, match.index) });
      }
      segments.push(...normalizeCqToken(match[0]));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < source.length) {
      segments.push({ type: 'text', text: source.slice(lastIndex) });
    }
    return segments.filter(segment => segment.type !== 'text' || segment.text);
  }

  function normalizeMessageSegments(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.flatMap(item => normalizeMessageSegments(item));
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return normalizeTextSegments(String(value));
    }
    if (isPlainObject(value)) {
      return normalizeSegmentObject(value);
    }
    return [{ type: 'text', text: String(value) }];
  }

  function getDataUrlMediaType(value = '') {
    const match = String(value || '').match(/^data:([^;,]+)[;,]/i);
    return match ? match[1].toLowerCase() : '';
  }

  function redactPreviewMediaSource(value = '', fallbackType = 'media') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^data:/i.test(text)) {
      const mediaType = getDataUrlMediaType(text) || fallbackType;
      return `[${mediaType}; ${formatBytes(estimateDataUrlSize(text))} data-url]`;
    }
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  }

  function collectPreviewImageSources(payload = {}) {
    const items = [];
    const append = value => {
      if (Array.isArray(value)) {
        value.forEach(append);
        return;
      }
      if (isPlainObject(value)) {
        append(value.dataUrl || value.url || value.imageUrl || value.name || '');
        return;
      }
      const text = String(value || '').trim();
      if (text) items.push(text);
    };
    append(payload.images);
    append(payload.screenshots);
    return items;
  }

  function getPreviewBotId() {
    return '<bot-self-id>';
  }

  function getPreviewBotName() {
    return '机器人';
  }

  function getSegmentFaceId(segment = {}) {
    return String(segment.id || segment.text || '').trim();
  }

  function stringifyPreviewSegmentPlain(segment = {}) {
    if (segment.type === 'text') return String(segment.text || '');
    if (segment.type === 'at') return `@${segment.qq || 'unknown'}`;
    if (segment.type === 'image') return '[图片]';
    if (segment.type === 'record') return '[语音]';
    if (segment.type === 'face') return `[表情:${getSegmentFaceId(segment) || 'face'}]`;
    if (segment.type === 'reply') return `[回复:${segment.id || 'unknown'}]`;
    if (segment.type === 'poke') return `[戳一戳:${segment.qq || segment.id || 'unknown'}]`;
    if (segment.type === 'memory') return `[记忆:${segment.data || 'memory'}]`;
    if (segment.type === 'meme') return `[meme:${segment.character || '未知'}:${segment.emotion || 'default'}]`;
    if (segment.type === 'cq') return `[CQ:${segment.cqType || 'unknown'}]`;
    return stringifyItem(segment);
  }

  function stringifyPreviewSegmentCq(segment = {}) {
    if (segment.type === 'text') return encodeCqValue(segment.text || '');
    if (segment.type === 'at') return `[CQ:at,qq=${encodeCqValue(segment.qq || '')}]`;
    if (segment.type === 'image') return `[CQ:image,file=${encodeCqValue(segment.url || segment.label || '')}]`;
    if (segment.type === 'record') return `[CQ:record,file=${encodeCqValue(segment.url || segment.label || '')}]`;
    if (segment.type === 'face') return `[CQ:face,id=${encodeCqValue(getSegmentFaceId(segment))}]`;
    if (segment.type === 'reply') return `[CQ:reply,id=${encodeCqValue(segment.id || '')}]`;
    if (segment.type === 'poke') return `[CQ:poke,qq=${encodeCqValue(segment.qq || segment.id || '')}]`;
    if (segment.type === 'memory') return '';
    if (segment.type === 'meme') return `[meme:${encodeCqValue(segment.character || '未知')}:${encodeCqValue(segment.emotion || 'default')}]`;
    if (segment.type === 'cq') {
      const params = Object.entries(segment.data || {})
        .map(([key, value]) => `${key}=${encodeCqValue(value)}`)
        .join(',');
      return `[CQ:${segment.cqType || 'unknown'}${params ? `,${params}` : ''}]`;
    }
    return encodeCqValue(stringifyItem(segment));
  }

  function toOnebotPreviewSegment(segment = {}) {
    if (segment.type === 'text') return { type: 'text', data: { text: segment.text || '' } };
    if (segment.type === 'at') return { type: 'at', data: { qq: String(segment.qq || '') } };
    if (segment.type === 'image') {
      const source = redactPreviewMediaSource(segment.url || segment.label || '', 'image');
      return { type: 'image', data: { file: source, url: source } };
    }
    if (segment.type === 'record') {
      const source = redactPreviewMediaSource(segment.url || segment.label || '', 'audio');
      return { type: 'record', data: { file: source, url: source } };
    }
    if (segment.type === 'face') return { type: 'face', data: { id: getSegmentFaceId(segment) } };
    if (segment.type === 'reply') return { type: 'reply', data: { id: String(segment.id || '') } };
    if (segment.type === 'poke') return { type: 'poke', data: { qq: String(segment.qq || segment.id || '') } };
    if (segment.type === 'memory') return { type: 'memory', data: { data: String(segment.data || ''), key: segment.key || [], timeout: segment.timeout || 0 } };
    if (segment.type === 'meme') {
      return { type: 'meme', data: { character: segment.character || '', emotion: segment.emotion || 'default' } };
    }
    if (segment.type === 'cq') return { type: segment.cqType || 'cq', data: segment.data || {} };
    return { type: 'text', data: { text: stringifyPreviewSegmentPlain(segment) } };
  }

  function toIcqqPreviewSegment(segment = {}) {
    if (segment.type === 'text') return { type: 'text', text: segment.text || '' };
    if (segment.type === 'at') return { type: 'at', qq: String(segment.qq || ''), text: `@${segment.qq || 'unknown'}` };
    if (segment.type === 'image') {
      const source = redactPreviewMediaSource(segment.url || segment.label || '', 'image');
      return { type: 'image', file: source, url: source };
    }
    if (segment.type === 'record') {
      const source = redactPreviewMediaSource(segment.url || segment.label || '', 'audio');
      return { type: 'record', file: source, url: source };
    }
    if (segment.type === 'face') return { type: 'face', id: getSegmentFaceId(segment) };
    if (segment.type === 'reply') return { type: 'reply', id: String(segment.id || '') };
    if (segment.type === 'poke') return { type: 'poke', qq: String(segment.qq || segment.id || '') };
    if (segment.type === 'memory') return { type: 'memory', data: String(segment.data || ''), key: segment.key || [], timeout: segment.timeout || 0 };
    if (segment.type === 'meme') return { type: 'meme', character: segment.character || '', emotion: segment.emotion || 'default' };
    if (segment.type === 'cq') return { type: segment.cqType || 'cq', data: segment.data || {} };
    return { type: 'text', text: stringifyPreviewSegmentPlain(segment) };
  }

  function buildOnebotPreviewMessage(payload = {}) {
    const message = [];
    if (payload.includeAt) {
      message.push({ type: 'at', data: { qq: getPreviewBotId() } });
    }
    message.push(...normalizeMessageSegments(payload.messageText).map(toOnebotPreviewSegment));
    collectPreviewImageSources(payload).forEach(source => {
      const redacted = redactPreviewMediaSource(source, 'image');
      message.push({ type: 'image', data: { file: redacted, url: redacted } });
    });
    if (payload.voice) {
      const redacted = payload.voice.dataUrl ? redactPreviewMediaSource(payload.voice.dataUrl, 'audio') : '';
      message.push({
        type: 'record',
        data: {
          file: payload.voice.name || 'voice-message',
          url: redacted,
          mime_type: payload.voice.mimeType || 'audio/*',
        },
      });
    }
    return message;
  }

  function buildIcqqPreviewMessage(payload = {}) {
    const message = [];
    if (payload.includeAt) {
      message.push({ type: 'at', qq: getPreviewBotId(), text: `@${getPreviewBotName()}` });
    }
    message.push(...normalizeMessageSegments(payload.messageText).map(toIcqqPreviewSegment));
    collectPreviewImageSources(payload).forEach(source => {
      const redacted = redactPreviewMediaSource(source, 'image');
      message.push({ type: 'image', file: redacted, url: redacted });
    });
    if (payload.voice) {
      message.push({
        type: 'record',
        file: payload.voice.name || 'voice-message',
        url: payload.voice.dataUrl ? redactPreviewMediaSource(payload.voice.dataUrl, 'audio') : '',
        mimeType: payload.voice.mimeType || 'audio/*',
        transcript: payload.voice.transcript || '',
      });
    }
    return message;
  }

  function buildPreviewRawMessage(payload = {}) {
    const parts = [];
    if (payload.includeAt) parts.push(`@${getPreviewBotName()}`);
    const text = normalizeMessageSegments(payload.messageText).map(stringifyPreviewSegmentPlain).join('');
    if (text) parts.push(text);
    if (payload.voice?.transcript) parts.push(payload.voice.transcript);
    if (payload.voice && !payload.voice?.transcript) parts.push('[语音消息]');
    const imageCount = collectPreviewImageSources(payload).length;
    if (imageCount > 0) parts.push(`[图片 ${imageCount} 张]`);
    return parts.join(' ').trim();
  }

  function buildPreviewCqMessage(payload = {}) {
    const parts = [];
    if (payload.includeAt) {
      parts.push(`[CQ:at,qq=${encodeCqValue(getPreviewBotId())}]`);
    }
    parts.push(...normalizeMessageSegments(payload.messageText).map(stringifyPreviewSegmentCq));
    collectPreviewImageSources(payload).forEach(source => {
      parts.push(`[CQ:image,file=${encodeCqValue(redactPreviewMediaSource(source, 'image'))}]`);
    });
    if (payload.voice) {
      const source = payload.voice.dataUrl
        ? redactPreviewMediaSource(payload.voice.dataUrl, 'audio')
        : payload.voice.name || 'voice-message';
      parts.push(`[CQ:record,file=${encodeCqValue(source)}]`);
    }
    return parts.join('');
  }

  function buildAdapterMessagePreview(payload = {}) {
    const adapterFormat = normalizeAdapterFormat(payload.adapterFormat);
    const message = payload.eventType === 'message'
      ? adapterFormat === 'icqq'
        ? buildIcqqPreviewMessage(payload)
        : buildOnebotPreviewMessage(payload)
      : [];
    const plainMessage = payload.eventType === 'message' ? buildPreviewRawMessage(payload) : String(payload.comment || '');
    const cqMessage = payload.eventType === 'message' ? buildPreviewCqMessage(payload) : String(payload.comment || '');
    return {
      adapterFormat,
      eventType: payload.eventType,
      event: {
        adapterFormat,
        eventType: payload.eventType,
        post_type: payload.eventType === 'message'
          ? 'message'
          : payload.eventType === 'join_request'
            ? 'request'
            : 'notice',
        message_type: payload.eventType === 'message' ? 'group' : undefined,
        group_id: payload.groupId || '<group-id>',
        user_id: payload.userId || '<user-id>',
        sender: {
          user_id: payload.userId || '<user-id>',
          nickname: payload.nickname || '测试用户',
          role: payload.role || 'member',
        },
        bot_role: payload.botRole || 'member',
        isMaster: payload.isMaster === true,
        message,
        raw_message: adapterFormat === 'icqq' ? plainMessage : cqMessage,
        msg: plainMessage,
        group_history: toArray(payload.groupHistory),
        comment: payload.comment || '',
      },
      note: payload.eventType === 'message'
        ? '<bot-self-id> 会在发送时由后端替换为真实机器人 QQ。'
        : '当前事件不是群消息事件，真实事件里通常没有 message 数组。',
    };
  }

  window.CrystelfQqSimulatorSegments = {
    normalizeMessageSegments,
    buildAdapterMessagePreview,
  };
})();
