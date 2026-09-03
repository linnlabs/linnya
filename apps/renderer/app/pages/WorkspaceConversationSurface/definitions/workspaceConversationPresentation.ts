/**
 * 工作区对话在应用壳中的呈现位置。
 *
 * 该类型属于 app-level 场景合同：它决定是否装配首页专属能力，以及空态 composer
 * 位于中间还是 footer；conversation domain 不感知工作台布局。
 */
export type WorkspaceConversationPresentation = 'home' | 'side-pane';
