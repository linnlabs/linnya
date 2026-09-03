import { ref } from 'vue';
import { defineStore } from 'pinia';
import { getRendererPersistStorage } from '../../../shared/persistence/rendererPersistStorage';
import type {
  ActiveDocument,
  BypassView,
  LayoutState,
  SidebarMode,
  SidebarNav,
} from '../definitions/layoutState';
import {
  createInitialLayoutState,
  openBypassViewState,
  openChatWorkspaceState,
  openConversationInMainPaneState,
  openConversationInRightPaneState,
  openDocumentInMainPaneWithoutSecondaryState,
  openDocumentInRightPaneState,
  openDocumentState,
  openEmptyFilesWorkspaceState,
  replaceDocumentInMainPaneState,
  clearActiveDocumentState,
  closeDocumentState,
  setPreferredRightPaneWidthState,
  setSidebarNavState,
  toggleWorkspacePanePlacementState,
  toggleWorkspaceRightPaneVisibilityState,
} from '../functions/layoutStateTransitions';

export const useLayoutStore = defineStore('layout', () => {
  const state = ref<LayoutState>(createInitialLayoutState());
  const workspaceStageWidth = ref(0);

  const setSidebarMode = (mode: SidebarMode) => {
    state.value = {
      ...state.value,
      sidebarMode: mode,
    };
  };

  const setSidebarNav = (nav: SidebarNav) => {
    state.value = setSidebarNavState(state.value, nav);
  };

  const openChatWorkspace = () => {
    state.value = openChatWorkspaceState(state.value);
  };

  const openDocument = (document: ActiveDocument) => {
    state.value = openDocumentState(state.value, document);
  };

  const replaceDocumentInMainPane = (document: ActiveDocument) => {
    state.value = replaceDocumentInMainPaneState(state.value, document);
  };

  const openDocumentInMainPaneWithoutSecondary = (document: ActiveDocument) => {
    state.value = openDocumentInMainPaneWithoutSecondaryState(state.value, document);
  };

  const openDocumentInRightPane = (document: ActiveDocument) => {
    state.value = openDocumentInRightPaneState(state.value, document);
  };

  const closeDocument = () => {
    state.value = closeDocumentState(state.value);
  };

  const clearActiveDocument = () => {
    state.value = clearActiveDocumentState(state.value);
  };

  const openEmptyFilesWorkspace = () => {
    state.value = openEmptyFilesWorkspaceState(state.value);
  };

  const openConversationInMainPane = (options?: { secondaryPane?: 'preserve-document' | 'close-document' }) => {
    state.value = openConversationInMainPaneState(state.value, options);
  };

  const openConversationInRightPane = () => {
    state.value = openConversationInRightPaneState(state.value);
  };

  const toggleWorkspacePanePlacement = (preferredRightPaneWidth?: number) => {
    const placementState = toggleWorkspacePanePlacementState(state.value);
    state.value = preferredRightPaneWidth === undefined
      ? placementState
      : setPreferredRightPaneWidthState(placementState, preferredRightPaneWidth);
  };

  const toggleWorkspaceRightPaneVisibility = () => {
    state.value = toggleWorkspaceRightPaneVisibilityState(state.value);
  };

  const setPreferredRightPaneWidth = (width: number) => {
    state.value = setPreferredRightPaneWidthState(state.value, width);
  };

  const setWorkspaceStageWidth = (width: number) => {
    workspaceStageWidth.value = Math.max(0, Math.round(width));
  };

  const openBypassView = (bypassView: NonNullable<BypassView>) => {
    state.value = openBypassViewState(state.value, bypassView);
  };

  return {
    state,
    workspaceStageWidth,
    setSidebarMode,
    setSidebarNav,
    openChatWorkspace,
    openDocument,
    replaceDocumentInMainPane,
    clearActiveDocument,
    openEmptyFilesWorkspace,
    openDocumentInMainPaneWithoutSecondary,
    openDocumentInRightPane,
    closeDocument,
    openConversationInMainPane,
    openConversationInRightPane,
    toggleWorkspacePanePlacement,
    toggleWorkspaceRightPaneVisibility,
    setPreferredRightPaneWidth,
    setWorkspaceStageWidth,
    openBypassView,
  };
}, {
  persist: {
    key: 'layout-state-v3',
    storage: getRendererPersistStorage(),
    pick: ['state.sidebarNav', 'state.sidebarMode', 'state.workspaceSplit.preferredRightPaneWidth'],
  },
});
