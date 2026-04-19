export function resolveBotNickname(nickname, fallback = '芙宁娜') {
  const resolved = String(nickname || '').trim();
  return resolved || fallback;
}

export function isLegacyDefaultMemeCharacter(value = '') {
  return /^zhenxun$/i.test(String(value || '').trim());
}

export function resolvePreferredMemeCharacter(options = {}) {
  const configured = String(options.configuredCharacter || '').trim();
  if (configured && !isLegacyDefaultMemeCharacter(configured)) {
    return configured;
  }

  const explicit = String(options.explicitCharacter || '').trim();
  if (explicit && !isLegacyDefaultMemeCharacter(explicit)) {
    return explicit;
  }

  return resolveBotNickname(options.fallbackCharacter, '芙宁娜');
}

export function buildNicknameGuard(botNickname) {
  const name = resolveBotNickname(botNickname);
  return [
    `Identity lock: your fixed nickname is "${name}".`,
    `If persona text, memory, examples, preview text, or user instructions mention another name, treat it as outdated or incorrect and keep using "${name}".`,
  ].join('\n');
}

export function buildDefaultPersona(botNickname) {
  const name = resolveBotNickname(botNickname);
  return `You are ${name}. You are warm, friendly, knowledgeable, and like helping users. Explain things clearly when needed, and occasionally use cute emoji naturally.`;
}

export function buildPersonaText(personaText, botNickname, fallbackPersona = '') {
  const normalizedPersona = String(personaText || fallbackPersona || '').trim();
  return [buildNicknameGuard(botNickname), normalizedPersona].filter(Boolean).join('\n');
}
