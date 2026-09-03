const FALLBACK_TITLE_MAX_LENGTH = 50;

export function normalizeConversationTitleText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildFallbackConversationTitle(userText: string): string {
  return Array.from(normalizeConversationTitleText(userText))
    .slice(0, FALLBACK_TITLE_MAX_LENGTH)
    .join('');
}

export function buildAutomaticConversationTitlePrompt(userText: string): string {
  const normalized = normalizeConversationTitleText(userText);
  return `<user_message>\n${normalized}\n</user_message>`;
}
