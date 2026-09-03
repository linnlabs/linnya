import type { WorkspaceSplitState } from './workspacePaneGeometry';

/**
 * 对话居中工作台的布局状态契约。
 *
 * 中文说明：
 * - app/layout 拥有“窗口如何摆放”的状态；
 * - 业务归属（项目、对话、文档）只以窄契约进入布局层；
 * - 这里不直接依赖任何 domain store，避免布局壳反向拥有业务实现。
 */

export type LayoutMode = 'chat-centric' | 'editor-centric';

export type SidebarNav = 'list' | 'project';

export type SidebarMode = 'chat' | 'files';

export type WorkspaceScene =
  | { kind: 'workspace' }
  | { kind: 'knowledge-base' }
  | { kind: 'plugin-store' }
  | { kind: 'project-setup'; projectId: string };

// 中文说明：ActiveDocumentType 已从闭合 union 改为插件贡献的动态 ID。
// 具体合法值由 app/plugins/documentTypeRegistry 在注册时校验。
export type ActiveDocumentType = string;

export interface ActiveDocument {
  type: ActiveDocumentType;
  id: string;
  projectId: string;
}

export type BypassView =
  | { type: 'knowledge-base' }
  | { type: 'plugin-store' }
  | { type: 'project-setup'; projectId: string }
  | null;

export interface DocumentPaneState {
  visible: boolean;
  placement: 'right-pane' | 'main-pane';
  /** 没有 active page 时，由文档 pane 自己承载“暂无文件”，不能关闭另一侧对话。 */
  emptyStateVisible: boolean;
}

export interface ConversationPaneState {
  visible: boolean;
}

export interface LayoutState {
  scene: WorkspaceScene;
  layoutMode: LayoutMode;
  sidebarNav: SidebarNav;
  /**
   * 中文说明：sidebarMode 只表示项目态内部的“对话 / 文件”子标签。
   * 列表态恒定展示对话维度，不能用它反推当前侧栏导航形态。
   */
  sidebarMode: SidebarMode;
  activeDocument: ActiveDocument | null;
  documentPane: DocumentPaneState;
  conversationPane: ConversationPaneState;
  workspaceSplit: WorkspaceSplitState;
  bypassView: BypassView;
}
