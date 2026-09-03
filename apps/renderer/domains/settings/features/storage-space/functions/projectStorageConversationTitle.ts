/** 后端允许空标题；展示层统一投影，避免每个消费组件各写一套 trim 规则。 */
export function projectStorageConversationTitle(title: string, unnamedLabel: string): string {
  const normalized = title.trim();
  return normalized.length > 0 ? normalized : unnamedLabel;
}
