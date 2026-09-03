/**
 * @file workspaceNavigation.ts
 * @description 插件工具卡打开宿主 workspace 目标的渲染端门面。
 *
 * 中文说明：
 * - workspaceNavigation 是 app-level 编排能力；
 * - 插件 UI 只表达“打开某个文档/页面”的意图，不直接 import app/layout。
 */

export type {
  WorkspaceConversationNavigationRequest,
  WorkspaceDocumentNavigationRequest,
  WorkspaceDocumentNavigationParameters,
  WorkspaceNavigationPort,
  WorkspaceNavigationScope,
} from '@linnya/plugin-host-contract/renderer/workspaceNavigation';
export {
  getWorkspaceNavigationPort,
} from '@/shared/ports/workspaceNavigationPort';
