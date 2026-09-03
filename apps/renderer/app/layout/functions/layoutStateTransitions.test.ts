import { describe, expect, it } from 'vitest';
import {
  clearActiveDocumentState,
  closeDocumentState,
  createInitialLayoutState,
  openChatWorkspaceState,
  openBypassViewState,
  openConversationInMainPaneState,
  openConversationInRightPaneState,
  openDocumentInMainPaneWithoutSecondaryState,
  openDocumentInRightPaneState,
  openDocumentState,
  openEmptyFilesWorkspaceState,
  replaceDocumentInMainPaneState,
  setPreferredRightPaneWidthState,
  toggleWorkspacePanePlacementState,
  toggleWorkspaceRightPaneVisibilityState,
} from './layoutStateTransitions';

describe('layoutStateTransitions', () => {
  it('starts in chat-centric workspace scene', () => {
    const state = createInitialLayoutState();

    expect(state.scene).toEqual({ kind: 'workspace' });
    expect(state.layoutMode).toBe('chat-centric');
    expect(state.activeDocument).toBeNull();
  });

  it('opens a project workspace without carrying a document', () => {
    const initial = createInitialLayoutState();
    const state = openChatWorkspaceState(initial);

    expect(state.scene).toEqual({ kind: 'workspace' });
    expect(state.layoutMode).toBe('chat-centric');
    expect(state.activeDocument).toBeNull();
    expect(state.documentPane.visible).toBe(false);
  });

  it('文档在中间时进入文件空态，保留右侧对话', () => {
    const opened = openDocumentState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    const state = openEmptyFilesWorkspaceState(opened);

    expect(state.scene).toEqual({ kind: 'workspace' });
    expect(state.layoutMode).toBe('editor-centric');
    expect(state.activeDocument).toBeNull();
    expect(state.documentPane.placement).toBe('main-pane');
    expect(state.documentPane.emptyStateVisible).toBe(true);
    expect(state.conversationPane.visible).toBe(true);
  });

  it('文档在右侧时进入文件空态，保留中间对话和右侧文档位置', () => {
    const opened = openDocumentInRightPaneState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    const state = openEmptyFilesWorkspaceState(opened);

    expect(state.layoutMode).toBe('chat-centric');
    expect(state.activeDocument).toBeNull();
    expect(state.documentPane.placement).toBe('right-pane');
    expect(state.documentPane.visible).toBe(true);
    expect(state.documentPane.emptyStateVisible).toBe(true);
  });

  it('文件空态仍可交换位置，且对话随另一侧保持可见', () => {
    const emptyRight = openEmptyFilesWorkspaceState(createInitialLayoutState());

    const emptyMain = toggleWorkspacePanePlacementState(emptyRight);

    expect(emptyMain.layoutMode).toBe('editor-centric');
    expect(emptyMain.documentPane.placement).toBe('main-pane');
    expect(emptyMain.documentPane.emptyStateVisible).toBe(true);
    expect(emptyMain.conversationPane.visible).toBe(true);
  });

  it('opens a document in editor-centric mode with the right conversation pane enabled', () => {
    const initial = createInitialLayoutState();
    const state = openDocumentState(initial, {
      type: 'sheet',
      id: 'sheet-1',
      projectId: 'project-1',
    });

    expect(state.layoutMode).toBe('editor-centric');
    expect(state.scene).toEqual({ kind: 'workspace' });
    expect(state.activeDocument).toEqual({
      type: 'sheet',
      id: 'sheet-1',
      projectId: 'project-1',
    });
    expect(state.conversationPane.visible).toBe(true);
    expect(state.documentPane.placement).toBe('main-pane');
  });

  it('can place the same document surface in the right pane', () => {
    const initial = createInitialLayoutState();
    const state = openDocumentInRightPaneState(initial, {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    expect(state.layoutMode).toBe('chat-centric');
    expect(state.documentPane.visible).toBe(true);
    expect(state.documentPane.placement).toBe('right-pane');
    expect(state.conversationPane.visible).toBe(false);
  });

  it('switches the main document without changing the right conversation pane visibility', () => {
    const mainDocument = openDocumentState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });
    const withHiddenConversation = toggleWorkspaceRightPaneVisibilityState(mainDocument);

    const hiddenReplaced = replaceDocumentInMainPaneState(withHiddenConversation, {
      type: 'editor',
      id: 'doc-2',
      projectId: 'project-1',
    });

    expect(hiddenReplaced.activeDocument).toEqual({
      type: 'editor',
      id: 'doc-2',
      projectId: 'project-1',
    });
    expect(hiddenReplaced.conversationPane.visible).toBe(false);

    const visibleReplaced = replaceDocumentInMainPaneState(mainDocument, {
      type: 'editor',
      id: 'doc-3',
      projectId: 'project-1',
    });

    expect(visibleReplaced.activeDocument?.id).toBe('doc-3');
    expect(visibleReplaced.conversationPane.visible).toBe(true);
  });

  it('can open a conversation in the main pane without touching the right document pane', () => {
    const state = openDocumentInRightPaneState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    const next = openConversationInMainPaneState(state, { secondaryPane: 'preserve-document' });

    expect(next.layoutMode).toBe('chat-centric');
    expect(next.activeDocument).toEqual(state.activeDocument);
    expect(next.documentPane.visible).toBe(true);
  });

  it('can open a conversation in the right pane without changing the main document', () => {
    const state = openDocumentInMainPaneWithoutSecondaryState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-main',
      projectId: 'project-1',
    });

    const next = openConversationInRightPaneState(state);

    expect(next.layoutMode).toBe('editor-centric');
    expect(next.activeDocument).toEqual(state.activeDocument);
    expect(next.documentPane.placement).toBe('main-pane');
    expect(next.conversationPane.visible).toBe(true);
  });

  it('closes the secondary document when opening a cross-scope conversation in the main pane', () => {
    const state = openDocumentInRightPaneState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    const next = openConversationInMainPaneState(state, { secondaryPane: 'close-document' });

    expect(next.layoutMode).toBe('chat-centric');
    expect(next.activeDocument).toBeNull();
    expect(next.documentPane.visible).toBe(false);
  });

  it('toggles the active document between right pane and main pane', () => {
    const rightPaneState = openDocumentInRightPaneState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    const mainPaneState = toggleWorkspacePanePlacementState(rightPaneState);
    expect(mainPaneState.layoutMode).toBe('editor-centric');
    expect(mainPaneState.documentPane.placement).toBe('main-pane');
    expect(mainPaneState.conversationPane.visible).toBe(true);

    const backToRightPane = toggleWorkspacePanePlacementState(mainPaneState);
    expect(backToRightPane.layoutMode).toBe('chat-centric');
    expect(backToRightPane.documentPane.placement).toBe('right-pane');
    expect(backToRightPane.documentPane.visible).toBe(true);
    expect(backToRightPane.conversationPane.visible).toBe(false);
  });

  it('toggles the chat-centric right document pane without closing the active document', () => {
    const opened = openDocumentInRightPaneState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    const hidden = toggleWorkspaceRightPaneVisibilityState(opened);
    expect(hidden.layoutMode).toBe('chat-centric');
    expect(hidden.activeDocument).toEqual(opened.activeDocument);
    expect(hidden.documentPane.visible).toBe(false);
    expect(hidden.documentPane.placement).toBe('right-pane');

    const visible = toggleWorkspaceRightPaneVisibilityState(hidden);
    expect(visible.documentPane.visible).toBe(true);
    expect(visible.activeDocument).toEqual(opened.activeDocument);
  });

  it('toggles the editor-centric right conversation pane without hiding the main document', () => {
    const opened = openDocumentState(createInitialLayoutState(), {
      type: 'sheet',
      id: 'sheet-1',
      projectId: 'project-1',
    });

    const hidden = toggleWorkspaceRightPaneVisibilityState(opened);
    expect(hidden.layoutMode).toBe('editor-centric');
    expect(hidden.activeDocument).toEqual(opened.activeDocument);
    expect(hidden.documentPane.placement).toBe('main-pane');
    expect(hidden.conversationPane.visible).toBe(false);

    const visible = toggleWorkspaceRightPaneVisibilityState(hidden);
    expect(visible.conversationPane.visible).toBe(true);
    expect(visible.activeDocument).toEqual(opened.activeDocument);
  });

  it('closes a document back to chat-centric mode without owning business scope', () => {
    const opened = openDocumentState(createInitialLayoutState(), {
      type: 'mindmap',
      id: 'mindmap-1',
      projectId: 'project-1',
    });

    const state = closeDocumentState(opened);

    expect(state.layoutMode).toBe('chat-centric');
    expect(state.activeDocument).toBeNull();
  });

  it('opens the plugin store as a full bypass scene', () => {
    const activeWorkspace = openDocumentInRightPaneState(createInitialLayoutState(), {
      type: 'mindmap',
      id: 'mindmap-1',
      projectId: 'project-1',
    });

    const state = openBypassViewState(activeWorkspace, { type: 'plugin-store' });

    expect(state.scene).toEqual({ kind: 'plugin-store' });
    expect(state.bypassView).toEqual({ type: 'plugin-store' });
    expect(state.documentPane.visible).toBe(false);
    expect(state.conversationPane.visible).toBe(false);
  });

  it('clears unavailable active document without leaving the current bypass scene', () => {
    const activeWorkspace = openDocumentInRightPaneState(createInitialLayoutState(), {
      type: 'slides',
      id: 'deck-1',
      projectId: 'project-1',
    });
    const pluginStore = openBypassViewState(activeWorkspace, { type: 'plugin-store' });

    const state = clearActiveDocumentState(pluginStore);

    expect(state.scene).toEqual({ kind: 'plugin-store' });
    expect(state.bypassView).toEqual({ type: 'plugin-store' });
    expect(state.activeDocument).toBeNull();
    expect(state.documentPane.visible).toBe(false);
  });

  it('stores one physical split preference without a fixed large-screen maximum', () => {
    const initial = createInitialLayoutState();

    expect(setPreferredRightPaneWidthState(initial, 1200).workspaceSplit.preferredRightPaneWidth).toBe(1200);
    expect(setPreferredRightPaneWidthState(initial, 512.4).workspaceSplit.preferredRightPaneWidth).toBe(512);
    expect(setPreferredRightPaneWidthState(initial, -20).workspaceSplit.preferredRightPaneWidth).toBe(0);
    expect(setPreferredRightPaneWidthState(initial, Number.NaN).workspaceSplit.preferredRightPaneWidth).toBe(480);
  });
});
