const EMOJI_REACTION_REGEX =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu;

function normalizeReactionEmojiId(emoji = '') {
  const text = String(emoji || '').trim();
  if (!text) return null;

  const sanitized = text.replace(/[\uFE0E\uFE0F]/g, '');
  const codePoints = Array.from(sanitized, char => char.codePointAt(0)).filter(Number.isFinite);
  if (codePoints.length !== 1) {
    return null;
  }

  return {
    emoji: text,
    id: String(codePoints[0]),
  };
}

export function extractReactionEmojiEntries(text = '') {
  const emojis = String(text || '').match(EMOJI_REACTION_REGEX) || [];
  const supported = [];
  const unsupported = [];

  for (const emoji of emojis) {
    const normalized = normalizeReactionEmojiId(emoji);
    if (normalized) {
      supported.push(normalized);
    } else {
      unsupported.push(emoji);
    }
  }

  return {
    supported,
    unsupported,
  };
}
