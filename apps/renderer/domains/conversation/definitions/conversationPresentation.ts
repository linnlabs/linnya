/**
 * 客户端本地派生的卡片头，不是持久化消息，也不拥有 conversation message identity。
 *
 * `id` 只用于本地组件 key/状态复位；正文、turn 与回放锚点必须来自 `BaseMessage`。
 */
export interface ConversationCardGroupHeader {
  readonly id: string;
  readonly headerText: string;
  readonly collapsedByDefault: boolean;
}

/**
 * 对话领域表面的视觉密度。
 *
 * 这里只表达 conversation UI 自身的展示密度，不能用它表达“首页 / 右侧栏”等位置；
 * 应用场景由 app-level 装配层单独映射，避免位置变化顺带改变输入控件规格。
 */
export type ConversationSurfaceVariant = 'regular' | 'compact';

/**
 * 空对话中 composer 的摆放位置。
 *
 * 位置与视觉密度是两个独立维度：右侧栏只改变 composer 的摆放位置，不能因此
 * 缩小消息列、输入框或选择器，否则同一个 AiAssistantInput 会出现两套交互规格。
 */
export type ConversationEmptyComposerPlacement = 'center' | 'footer';
