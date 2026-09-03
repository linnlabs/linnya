import { describe, expect, it } from 'vitest';
import {
  createInitialLayoutState,
  openConversationInRightPaneState,
  openDocumentInRightPaneState,
  openDocumentState,
  openEmptyFilesWorkspaceState,
} from './layoutStateTransitions';
import {
  resolveConversationNavigationPlan,
  resolveDocumentNavigationPlan,
} from './workspacePaneNavigationPlan';

describe('workspacePaneNavigationPlan', () => {
  it('puts documents in the right pane when conversation is in the main pane for the same scope', () => {
    const state = createInitialLayoutState();

    expect(resolveDocumentNavigationPlan(state, true)).toEqual({
      placement: 'right-pane',
      closeSecondaryPane: false,
    });
  });

  it('switches the main document without touching the conversation pane for the same scope', () => {
    const documentMain = openDocumentState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });
    const state = openConversationInRightPaneState(documentMain);

    expect(resolveDocumentNavigationPlan(state, true)).toEqual({
      placement: 'main-pane',
      closeSecondaryPane: false,
    });
  });

  it('switches the main conversation without touching the document pane for the same scope', () => {
    const state = openDocumentInRightPaneState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    expect(resolveConversationNavigationPlan(state, true)).toEqual({
      placement: 'main-pane',
      closeSecondaryPane: false,
    });
  });

  it('puts conversations in the right pane when a document is in the main pane for the same scope', () => {
    const state = openDocumentState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    expect(resolveConversationNavigationPlan(state, true)).toEqual({
      placement: 'right-pane',
      closeSecondaryPane: false,
    });
  });

  it('文件空态在中间时，对话仍打开到右侧而不是替换空态', () => {
    const documentMain = openDocumentState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });
    const emptyMain = openEmptyFilesWorkspaceState(documentMain);

    expect(resolveConversationNavigationPlan(emptyMain, true)).toEqual({
      placement: 'right-pane',
      closeSecondaryPane: false,
    });
  });

  it('closes the secondary pane when crossing workspace scope', () => {
    const state = openDocumentInRightPaneState(createInitialLayoutState(), {
      type: 'editor',
      id: 'doc-1',
      projectId: 'project-1',
    });

    expect(resolveConversationNavigationPlan(state, false)).toEqual({
      placement: 'main-pane',
      closeSecondaryPane: true,
    });
    expect(resolveDocumentNavigationPlan(state, false)).toEqual({
      placement: 'main-pane',
      closeSecondaryPane: true,
    });
  });
});
