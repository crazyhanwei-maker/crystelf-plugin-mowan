export function createBotIdentityConsole() {
  function isLegacyDefaultMemeCharacter(value = '') {
    return /^zhenxun$/i.test(String(value || '').trim());
  }

  function normalizePersonaDisplayName(value = '') {
    const cleaned = String(value || '')
      .trim()
      .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/gu, '');
    if (!cleaned) {
      return '';
    }

    if (Array.from(cleaned).length > 24) {
      return '';
    }

    if (/^(AI|Bot|Assistant|ChatGPT|机器人|助手)$/iu.test(cleaned)) {
      return '';
    }

    return cleaned;
  }

  function extractPersonaDisplayName(personaText = '') {
    const text = String(personaText || '').trim();
    if (!text) {
      return '';
    }

    const patterns = [
      /(?:名字|昵称|名称)\s*(?:是|叫|为|:|：)\s*[`"'“”‘’]?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})(?=[\s,，。！？!?:：]|$)/u,
      /(?:我是|叫我)\s*[`"'“”‘’]?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})(?=[\s,，。！？!?:：]|$)/u,
      /(?:扮演|饰演)\s*[`"'“”‘’]?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})(?=[\s,，。！？!?:：]|$)/u,
      /you are (?:an? )?(?:ai|assistant|bot)?\s*named\s*[`"']?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,32})/iu,
      /your name is\s*[`"']?([A-Za-z0-9_\-\u4e00-\u9fa5]{1,32})/iu,
    ];

    for (const pattern of patterns) {
      const matched = text.match(pattern);
      const normalized = normalizePersonaDisplayName(matched?.[1] || '');
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  function getConfiguredMemeCharacterState(aiConfig = {}, memeConfigOverride = null) {
    const memeConfig = memeConfigOverride || aiConfig.memeConfig || {};
    const raw = String(memeConfig.character || aiConfig.character || '').trim();
    return {
      raw,
      effective: raw && !isLegacyDefaultMemeCharacter(raw) ? raw : '',
      isLegacyDefault: Boolean(raw) && isLegacyDefaultMemeCharacter(raw),
    };
  }

  function buildBotIdentitySnapshot(allConfigs = {}, memeConfigOverride = null) {
    const aiConfig = allConfigs.ai || {};
    const profileConfig = allConfigs.profile || {};
    const configuredCharacter = getConfiguredMemeCharacterState(aiConfig, memeConfigOverride);
    const botNickname = String(profileConfig.nickName || '').trim() || '灵晶';
    const personaCardName = extractPersonaDisplayName(aiConfig.botPersona || aiConfig.persona || '');
    const recommendedCharacter = configuredCharacter.effective || personaCardName || botNickname || '灵晶';
    const recommendedCharacterSource = configuredCharacter.effective
      ? 'configured'
      : personaCardName
        ? 'persona'
        : botNickname
          ? 'nickname'
          : 'fallback';

    return {
      botNickname,
      personaCardName,
      configuredCharacter: configuredCharacter.raw,
      legacyConfiguredCharacter: configuredCharacter.isLegacyDefault,
      recommendedCharacter,
      recommendedCharacterSource,
    };
  }

  function resolveRuntimeMemeCharacter(payloadCharacter = '', allConfigs = {}, memeConfigOverride = null) {
    const explicit = String(payloadCharacter || '').trim();
    if (explicit) {
      return explicit;
    }

    return buildBotIdentitySnapshot(allConfigs, memeConfigOverride).recommendedCharacter || '灵晶';
  }

  function replaceControlCharacters(value = '', replacement = ' ') {
    return Array.from(String(value || ''))
      .map((char) => {
        const code = char.charCodeAt(0);
        return code <= 31 || code === 127 ? replacement : char;
      })
      .join('');
  }

  return {
    buildBotIdentitySnapshot,
    resolveRuntimeMemeCharacter,
    replaceControlCharacters,
  };
}
