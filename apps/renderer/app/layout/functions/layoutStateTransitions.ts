import type {
  ActiveDocument,
  BypassView,
  LayoutState,
  SidebarNav,
} from '../definitions/layoutState';
import { DEFAULT_WORKSPACE_RIGHT_PANE_WIDTH } from '../definitions/workspacePaneGeometry';

interface OpenConversationInMainPaneOptions {
  secondaryPane?: 'preserve-document' | 'close-document';
}

interface OpenDocumentInMainPaneOptions {
  secondaryPane?: 'show-conversation' | 'preserve-conversation' | 'close-conversation';
}

export function createInitialLayoutState(): LayoutState {
  return {
    scene: { kind: 'workspace' },
    layoutMode: 'chat-centric',
    sidebarNav: 'list',
    sidebarMode: 'chat',
    activeDocument: null,
    documentPane: {
      visible: false,
      placement: 'right-pane',
      emptyStateVisible: false,
    },
    conversationPane: {
      visible: false,
    },
    workspaceSplit: {
      preferredRightPaneWidth: DEFAULT_WORKSPACE_RIGHT_PANE_WIDTH,
    },
    bypassView: null,
  };
}

export function setSidebarNavState(state: LayoutState, sidebarNav: SidebarNav): LayoutState {
  return {
    ...cloneState(state),
    sidebarNav,
  };
}

function cloneState(state: LayoutState): LayoutState {
  return {
    ...state,
    activeDocument: state.activeDocument ? { ...state.activeDocument } : null,
    documentPane: { ...state.documentPane },
    conversationPane: { ...state.conversationPane },
    workspaceSplit: { ...state.workspaceSplit },
    scene: { ...state.scene },
    bypassView: state.bypassView ? { ...state.bypassView } : null,
  };
}

export function openChatWorkspaceState(state: LayoutState): LayoutState {
  const next = cloneState(state);
  next.scene = { kind: 'workspace' };
  next.layoutMode = 'chat-centric';
  next.activeDocument = null;
  next.documentPane = {
    ...next.documentPane,
    visible: false,
    placement: 'right-pane',
    emptyStateVisible: false,
  };
  next.conversationPane = {
    ...next.conversationPane,
    visible: false,
  };
  next.bypassView = null;
  return next;
}

export function openDocumentState(state: LayoutState, document: ActiveDocument): LayoutState {
  return openDocumentInMainPaneStateWithOptions(state, document, { secondaryPane: 'show-conversation' });
}

export function replaceDocumentInMainPaneState(state: LayoutState, document: ActiveDocument): LayoutState {
  return openDocumentInMainPaneStateWithOptions(state, document, { secondaryPane: 'preserve-conversation' });
}

export function openDocumentInMainPaneWithoutSecondaryState(
  state: LayoutState,
  document: ActiveDocument,
): LayoutState {
  return openDocumentInMainPaneStateWithOptions(state, document, { secondaryPane: 'close-conversation' });
}

function openDocumentInMainPaneStateWithOptions(
  state: LayoutState,
  document: ActiveDocument,
  options: OpenDocumentInMainPaneOptions,
): LayoutState {
  const next = cloneState(state);
  const shouldPreserveConversation = (
    options.secondaryPane === 'preserve-conversation'
    && state.layoutMode === 'editor-centric'
    && (state.activeDocument !== null || state.documentPane.emptyStateVisible)
  );
  next.scene = { kind: 'workspace' };
  next.layoutMode = 'editor-centric';
  next.activeDocument = { ...document };
  next.documentPane = {
    ...next.documentPane,
    visible: false,
    placement: 'main-pane',
    emptyStateVisible: false,
  };
  next.conversationPane = {
    ...next.conversationPane,
    visible: shouldPreserveConversation
      ? state.conversationPane.visible
      : options.secondaryPane === 'show-conversation',
  };
  next.bypassView = null;
  return next;
}

export function openDocumentInRightPaneState(state: LayoutState, document: ActiveDocument): LayoutState {
  const next = cloneState(state);
  next.scene = { kind: 'workspace' };
  next.layoutMode = 'chat-centric';
  next.activeDocument = { ...document };
  next.documentPane = {
    ...next.documentPane,
    visible: true,
    placement: 'right-pane',
    emptyStateVisible: false,
  };
  next.conversationPane = {
    ...next.conversationPane,
    visible: false,
  };
  next.bypassView = null;
  return next;
}

export function openConversationInMainPaneState(
  state: LayoutState,
  options: OpenConversationInMainPaneOptions = {},
): LayoutState {
  const next = cloneState(state);
  const shouldCloseDocument = options.secondaryPane === 'close-document';
  next.scene = { kind: 'workspace' };
  next.layoutMode = 'chat-centric';
  next.activeDocument = shouldCloseDocument ? null : next.activeDocument;
  next.documentPane = {
    ...next.documentPane,
    visible: shouldCloseDocument ? false : next.documentPane.visible,
    placement: 'right-pane',
    emptyStateVisible: shouldCloseDocument ? false : next.documentPane.emptyStateVisible,
  };
  next.conversationPane = {
    ...next.conversationPane,
    visible: false,
  };
  next.bypassView = null;
  return next;
}

export function openConversationInRightPaneState(state: LayoutState): LayoutState {
  if (!state.activeDocument && !state.documentPane.emptyStateVisible) {
    return openConversationInMainPaneState(state, { secondaryPane: 'close-document' });
  }

  const next = cloneState(state);
  next.scene = { kind: 'workspace' };
  next.layoutMode = 'editor-centric';
  next.documentPane = {
    ...next.documentPane,
    visible: false,
    placement: 'main-pane',
  };
  next.conversationPane = {
    ...next.conversationPane,
    visible: true,
  };
  next.bypassView = null;
  return next;
}

export function toggleWorkspacePanePlacementState(state: LayoutState): LayoutState {
  if (!state.activeDocument && !state.documentPane.emptyStateVisible) {
    return cloneState(state);
  }

  if (!state.activeDocument) {
    const next = cloneState(state);
    if (state.layoutMode === 'chat-centric') {
      next.layoutMode = 'editor-centric';
      next.documentPane = {
        ...next.documentPane,
        visible: false,
        placement: 'main-pane',
      };
      next.conversationPane = {
        ...next.conversationPane,
        visible: true,
      };
      return next;
    }

    next.layoutMode = 'chat-centric';
    next.documentPane = {
      ...next.documentPane,
      visible: true,
      placement: 'right-pane',
    };
    next.conversationPane = {
      ...next.conversationPane,
      visible: false,
    };
    return next;
  }

  if (state.layoutMode === 'chat-centric') {
    return openDocumentState(state, state.activeDocument);
  }

  return openDocumentInRightPaneState(state, state.activeDocument);
}

export function toggleWorkspaceRightPaneVisibilityState(state: LayoutState): LayoutState {
  const next = cloneState(state);
  if (!next.activeDocument && !next.documentPane.emptyStateVisible) {
    return next;
  }

  if (next.layoutMode === 'chat-centric') {
    next.documentPane = {
      ...next.documentPane,
      visible: !next.documentPane.visible,
      placement: 'right-pane',
    };
    next.conversationPane = {
      ...next.conversationPane,
      visible: false,
    };
    return next;
  }

  next.documentPane = {
    ...next.documentPane,
    visible: false,
    placement: 'main-pane',
  };
  next.conversationPane = {
    ...next.conversationPane,
    visible: !next.conversationPane.visible,
  };
  return next;
}

export function closeDocumentState(state: LayoutState): LayoutState {
  const next = cloneState(state);
  next.scene = { kind: 'workspace' };
  next.layoutMode = 'chat-centric';
  next.activeDocument = null;
  next.documentPane = {
    ...next.documentPane,
    visible: false,
    placement: 'right-pane',
    emptyStateVisible: false,
  };
  next.conversationPane = {
    ...next.conversationPane,
    visible: false,
  };
  next.bypassView = null;
  return next;
}

export function clearActiveDocumentState(state: LayoutState): LayoutState {
  const next = cloneState(state);
  next.activeDocument = null;
  next.documentPane = {
    ...next.documentPane,
    visible: false,
    emptyStateVisible: false,
  };
  return next;
}

export function openEmptyFilesWorkspaceState(state: LayoutState): LayoutState {
  const next = cloneState(state);
  next.scene = { kind: 'workspace' };
  next.activeDocument = null;
  next.documentPane = next.layoutMode === 'chat-centric'
    ? {
        ...next.documentPane,
        visible: true,
        placement: 'right-pane',
        emptyStateVisible: true,
      }
    : {
        ...next.documentPane,
        visible: false,
        placement: 'main-pane',
        emptyStateVisible: true,
      };
  next.bypassView = null;
  return next;
}

export function setPreferredRightPaneWidthState(state: LayoutState, width: number): LayoutState {
  const next = cloneState(state);
  next.workspaceSplit = {
    preferredRightPaneWidth: Number.isFinite(width)
      ? Math.max(0, Math.round(width))
      : DEFAULT_WORKSPACE_RIGHT_PANE_WIDTH,
  };
  return next;
}

export function openBypassViewState(state: LayoutState, bypassView: NonNullable<BypassView>): LayoutState {
  const next = cloneState(state);
  if (bypassView.type === 'knowledge-base') {
    next.scene = { kind: 'knowledge-base' };
  } else if (bypassView.type === 'plugin-store') {
    next.scene = { kind: 'plugin-store' };
  } else {
    next.scene = { kind: 'project-setup', projectId: bypassView.projectId };
  }
  next.bypassView = { ...bypassView };
  next.documentPane = {
    ...next.documentPane,
    visible: false,
  };
  next.conversationPane = {
    ...next.conversationPane,
    visible: false,
  };
  return next;
}
