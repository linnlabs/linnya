import type { WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';
import type { ConversationListItem } from '../../history/services/historyApiService';

export type SidebarChatListSurface = 'outer-list' | 'project-panel';

export interface SidebarChatListProps {
  scope: WorkspaceScope;
  limit?: number;
  variant?: 'sidebar' | 'dropdown';
  surface?: SidebarChatListSurface;
  active?: boolean;
  selectionEnabled?: boolean;
  searchQuery?: string;
  revealPulseKey?: number;
  displayMode?: 'collapsible' | 'full';
}

export interface SidebarChatListEmit {
  (event: 'selected', conversation: ConversationListItem): void;
  (event: 'display-change'): void;
}
