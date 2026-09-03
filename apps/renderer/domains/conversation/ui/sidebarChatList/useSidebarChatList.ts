import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type ComponentPublicInstance,
  type CSSProperties,
} from 'vue';
import { useAssistantStore } from '../../store/assistantStore';
import type { ConversationListItem } from '../../history/services/historyApiService';
import { useHistoryListStore } from '../../history/store/historyListStore';
import { useConversationDeletionStore } from '../../history/store/conversationDeletionStore';
import {
  deleteConversationFromHistory,
  retryConversationCleanupFromHistory,
} from '../../history/orchestration/deleteConversationFromHistory';
import {
  deleteConversationsFromHistory,
  type DeleteConversationsFromHistoryResult,
} from '../../history/orchestration/deleteConversationsFromHistory';
import { useConversationSelectionStore } from '../../history/store/conversationSelectionStore';
import { useConversationTitleFeature } from '../../features/conversation-title';
import { isSidebarConversationActive } from '../../functions/sidebarConversationSelection';
import {
  createSingleConversationBatchSelection,
  resolveConversationSelectionGesture,
} from '../../history/functions/conversationSelection';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { confirm } from '@shared/composables/confirmDialog';
import { useNotificationStore } from '@/app/notification';
import { formatConversationListTime } from '../../functions/conversationListTime';
import { useConversationLocalization } from '../useConversationLocalization';
import {
  buildChatMenuOptions,
  buildContextMenuOptions,
  positionChatContextMenu,
  positionChatMenuDropdown,
  type ChatMenuAction,
} from './sidebarChatListMenu';
import type {
  SidebarChatListEmit,
  SidebarChatListProps,
} from './definitions';
import {
  collapsedConversationCount,
  filterSidebarConversations,
  getVisibleSidebarConversations,
  shouldShowSidebarCollapseControl,
  shouldShowSidebarExpandControl,
} from './sidebarChatListView';

interface LoadConversationsOptions {
  clearBeforeLoad: boolean;
}

export function useSidebarChatList(
  props: Readonly<SidebarChatListProps>,
  emit: SidebarChatListEmit,
) {
  const variant = computed(() => props.variant ?? 'sidebar');
  const surface = computed(() => props.surface ?? 'project-panel');
  const active = computed(() => props.active ?? true);
  const selectionEnabled = computed(() => props.selectionEnabled ?? true);
  const displayMode = computed(() => props.displayMode ?? 'collapsible');

  const assistantStore = useAssistantStore();
  const historyListStore = useHistoryListStore();
  const conversationDeletionStore = useConversationDeletionStore();
  const conversationSelectionStore = useConversationSelectionStore();
  const conversationTitleFeature = useConversationTitleFeature();
  const navigation = getWorkspaceNavigationPort();
  const notificationStore = useNotificationStore();
  const { conversationMessage } = useConversationLocalization();

  const editingConversationId = ref<string | null>(null);
  const editingTitle = ref('');
  const isSubmittingRename = ref(false);
  const renameInputRef = ref<HTMLInputElement | null>(null);
  const activeMenuConversationId = ref<string | null>(null);
  const menuButtonRefs = new Map<string, HTMLButtonElement>();
  const menuDropdownRef = ref<HTMLElement | null>(null);
  const menuDropdownStyle = ref<CSSProperties>({ top: '0px', left: '0px' });
  const contextMenuDropdownRef = ref<HTMLElement | null>(null);
  const contextMenuDropdownStyle = ref<CSSProperties>({ top: '0px', left: '0px' });
  const contextMenuConversationId = ref<string | null>(null);
  const isHistoryRevealPulseActive = ref(false);
  const pendingRevealPulseKey = ref<number | null>(null);
  const isConversationListExpanded = ref(false);
  let loadConversationsTimer: ReturnType<typeof setTimeout> | null = null;
  let revealPulseTimer: ReturnType<typeof setTimeout> | null = null;
  let revealFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const activeConversationId = computed(() => assistantStore.activeConversationId);
  const scopeKey = computed(() => {
    return props.scope.kind === 'project'
      ? `project:${props.scope.projectId}`
      : 'linnya-assistant';
  });
  const normalizedSearchQuery = computed(() => (props.searchQuery ?? '').trim().toLowerCase());
  const listRequestKey = computed(() => scopeKey.value);
  const conversations = computed(() => historyListStore.getConversationsByScope(props.scope));
  const batchSelectedConversationIds = computed(() => (
    conversationSelectionStore.batchSelectedConversationIds(props.scope)
  ));
  const isLoading = computed(() => historyListStore.isLoadingByScope(props.scope));
  const error = computed(() => historyListStore.errorByScope(props.scope));
  const hasLoaded = computed(() => historyListStore.hasLoadedScope(props.scope));
  const isLoadInFlight = computed(() => isLoading.value);
  const shouldShowInitialLoading = computed(() => isLoading.value && conversations.value.length === 0);

  const isConversationDeleting = (conversationId: string): boolean => (
    conversationDeletionStore.isDeletingConversation(conversationId)
  );

  const isConversationUnavailable = (conversation: ConversationListItem): boolean => (
    isConversationDeleting(conversation.conversation_id)
    || conversation.cleanup_pending === true
  );

  const batchSelectedConversations = computed(() => batchSelectedConversationIds.value
    .map(id => conversations.value.find(conversation => conversation.conversation_id === id))
    .filter((conversation): conversation is ConversationListItem => (
      conversation !== undefined && !isConversationUnavailable(conversation)
    )));

  const filteredConversations = computed(() => {
    return filterSidebarConversations(
      conversations.value,
      normalizedSearchQuery.value,
      conversationMessage,
    );
  });

  const shouldBypassDisplayCollapse = computed(() => (
    variant.value === 'dropdown'
    || displayMode.value === 'full'
    || normalizedSearchQuery.value.length > 0
  ));
  const visibleConversations = computed(() => {
    return getVisibleSidebarConversations(filteredConversations.value, {
      bypassCollapse: shouldBypassDisplayCollapse.value,
      expanded: isConversationListExpanded.value,
    });
  });
  const shouldShowExpandControl = computed(() => (
    shouldShowSidebarExpandControl(filteredConversations.value.length, {
      bypassCollapse: shouldBypassDisplayCollapse.value,
      expanded: isConversationListExpanded.value,
    })
  ));
  const shouldShowCollapseControl = computed(() => (
    shouldShowSidebarCollapseControl(filteredConversations.value.length, {
      bypassCollapse: shouldBypassDisplayCollapse.value,
      expanded: isConversationListExpanded.value,
    })
  ));

  const isConversationActive = (conversationId: string): boolean => (
    isSidebarConversationActive({
      selectionEnabled: selectionEnabled.value,
      conversationId,
      activeConversationId: activeConversationId.value,
    })
  );

  const isConversationBatchSelected = (conversationId: string): boolean => (
    batchSelectedConversationIds.value.includes(conversationId)
  );

  const flushPendingHistoryRevealPulse = (): void => {
    if (pendingRevealPulseKey.value === null) return;
    pendingRevealPulseKey.value = null;
    triggerHistoryRevealPulse();
  };

  const loadConversations = async (options: LoadConversationsOptions): Promise<void> => {
    const requestKey = listRequestKey.value;
    await historyListStore.loadScopeList(props.scope, {
      refresh: options.clearBeforeLoad,
      loadAll: variant.value !== 'dropdown',
      limit: variant.value === 'dropdown' ? (props.limit ?? collapsedConversationCount) : 100,
    });

    if (requestKey === listRequestKey.value) {
      flushPendingHistoryRevealPulse();
      void nextTick(() => {
        emit('display-change');
      });
    }
  };

  const scheduleLoadConversations = (options: LoadConversationsOptions, delayMs: number): void => {
    if (loadConversationsTimer) {
      clearTimeout(loadConversationsTimer);
      loadConversationsTimer = null;
    }

    if (delayMs <= 0) {
      void loadConversations(options);
      return;
    }

    loadConversationsTimer = setTimeout(() => {
      loadConversationsTimer = null;
      void loadConversations(options);
    }, delayMs);
  };

  const triggerHistoryRevealPulse = (): void => {
    if (revealPulseTimer) {
      clearTimeout(revealPulseTimer);
      revealPulseTimer = null;
    }
    if (revealFlushTimer) {
      clearTimeout(revealFlushTimer);
      revealFlushTimer = null;
    }

    isHistoryRevealPulseActive.value = true;
    revealPulseTimer = setTimeout(() => {
      isHistoryRevealPulseActive.value = false;
      revealPulseTimer = null;
    }, 1000);
  };

  const expandConversationList = (): void => {
    isConversationListExpanded.value = true;
    void nextTick(() => {
      emit('display-change');
    });
  };

  const collapseConversationList = (): void => {
    isConversationListExpanded.value = false;
    void nextTick(() => {
      emit('display-change');
    });
  };

  const handleSelectConversation = async (conversation: ConversationListItem): Promise<void> => {
    if (editingConversationId.value || isConversationUnavailable(conversation)) return;

    clearConversationSelection();

    await navigation.openConversation({
      conversationId: conversation.conversation_id,
      scope: props.scope,
      initialConversation: {
        title: conversation.title,
        createdAt: conversation.created_at,
        lastEventAt: conversation.last_event_at,
        userMessageCount: conversation.user_message_count,
        projectId: conversation.project_id,
      },
    });
    emit('selected', conversation);
  };

  const handleClickConversation = async (
    event: MouseEvent,
    conversation: ConversationListItem,
  ): Promise<void> => {
    if (editingConversationId.value || isConversationUnavailable(conversation)) return;
    if (!selectionEnabled.value) {
      await handleSelectConversation(conversation);
      return;
    }
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    const isCtrlOrCmd = (isMac && event.metaKey) || (!isMac && event.ctrlKey);
    const selectionGesture = resolveConversationSelectionGesture(
      conversationSelectionStore.readSelection(props.scope),
      visibleConversations.value.map(item => item.conversation_id),
      conversation.conversation_id,
      {
        shiftKey: event.shiftKey,
        toggleKey: isCtrlOrCmd,
        activeConversationId: activeConversationId.value,
      },
    );
    if (selectionGesture.kind === 'update-batch-selection') {
      conversationSelectionStore.replaceSelection(props.scope, selectionGesture.selection);
      return;
    }

    const targetElement = event.currentTarget;
    if (targetElement instanceof HTMLElement) {
      // 中文说明：鼠标点击只负责打开会话，不应该把焦点留在行上触发 focus-within 视觉态；键盘选择仍走 keydown 保留焦点。
      targetElement.blur();
    }

    await handleSelectConversation(conversation);
  };

  const clearConversationSelection = (): void => {
    conversationSelectionStore.clear(props.scope);
  };

  const deleteSelectedConversations = async (): Promise<void> => {
    const targets = batchSelectedConversations.value;
    if (targets.length === 0) {
      clearConversationSelection();
      return;
    }

    const confirmed = await confirm({
      title: conversationMessage('conversation.sidebar.batchDelete.title'),
      message: conversationMessage('conversation.sidebar.batchDelete.message', { count: targets.length }),
      confirmText: conversationMessage('conversation.sidebar.delete.confirm'),
      cancelText: conversationMessage('conversation.sidebar.delete.cancel'),
      isDangerousAction: true,
    });
    if (!confirmed) return;

    let result: DeleteConversationsFromHistoryResult;
    try {
      result = await deleteConversationsFromHistory({
        conversationIds: targets.map(conversation => conversation.conversation_id),
        scope: props.scope,
      });
    } catch {
      notificationStore.show(
        conversationMessage('conversation.sidebar.deleteFailedGeneric'),
        'error',
        4000,
      );
      return;
    }
    for (const conversationId of result.succeededIds) {
      conversationSelectionStore.remove(props.scope, conversationId);
    }
    if (result.failedIds.length === 0) {
      notificationStore.show(
        conversationMessage('conversation.sidebar.batchDelete.success', { count: result.succeededIds.length }),
        'success',
        3000,
      );
      return;
    }
    notificationStore.show(
      conversationMessage('conversation.sidebar.batchDelete.partial', {
        successCount: result.succeededIds.length,
        failCount: result.failedIds.length,
      }),
      'warning',
      4000,
    );
  };

  const setRenameInputRef = (element: Element | ComponentPublicInstance | null): void => {
    renameInputRef.value = element instanceof HTMLInputElement ? element : null;
  };

  const activeMenuConversation = computed(() => {
    if (!activeMenuConversationId.value) return null;
    return conversations.value.find(conversation => (
      conversation.conversation_id === activeMenuConversationId.value
    )) ?? null;
  });

  const activeMenuButtonRef = computed(() => {
    if (!activeMenuConversationId.value) return null;
    return menuButtonRefs.get(activeMenuConversationId.value) ?? null;
  });

  const activeMenuOptions = computed(() => (
    buildChatMenuOptions(activeMenuConversation.value, conversationMessage)
  ));

  const formatListTime = (timestamp: number | null | undefined): string => (
    formatConversationListTime(timestamp, conversationMessage)
  );

  const setMenuButtonRef = (conversationId: string, element: Element | ComponentPublicInstance | null): void => {
    if (element instanceof HTMLButtonElement) {
      menuButtonRefs.set(conversationId, element);
      return;
    }

    menuButtonRefs.delete(conversationId);
  };

  const positionMenuDropdown = (): void => {
    const buttonEl = activeMenuButtonRef.value;
    const dropdownEl = menuDropdownRef.value;
    if (!buttonEl || !dropdownEl) return;

    menuDropdownStyle.value = positionChatMenuDropdown(buttonEl, dropdownEl, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  };

  const openMoreMenu = async (conversationId: string): Promise<void> => {
    activeMenuConversationId.value = conversationId;
    await nextTick();
    positionMenuDropdown();
  };

  const closeMoreMenu = (): void => {
    activeMenuConversationId.value = null;
  };

  const closeContextMenu = (): void => {
    contextMenuConversationId.value = null;
  };

  const toggleMoreMenu = (conversation: ConversationListItem): void => {
    if (isConversationDeleting(conversation.conversation_id)) return;
    if (activeMenuConversationId.value === conversation.conversation_id) {
      closeMoreMenu();
      return;
    }

    void openMoreMenu(conversation.conversation_id);
  };

  const contextMenuConversation = computed(() => {
    if (!contextMenuConversationId.value) return null;
    return conversations.value.find(conversation => (
      conversation.conversation_id === contextMenuConversationId.value
    )) ?? null;
  });

  const contextMenuOptions = computed(() => (
    buildContextMenuOptions(conversationMessage)
  ));

  const positionContextMenu = (event: MouseEvent): void => {
    contextMenuDropdownStyle.value = positionChatContextMenu(event, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  };

  const handleContextMenu = (event: MouseEvent, conversation: ConversationListItem): void => {
    if (!selectionEnabled.value || isConversationUnavailable(conversation)) return;
    if (!batchSelectedConversationIds.value.includes(conversation.conversation_id)) {
      conversationSelectionStore.replaceSelection(
        props.scope,
        createSingleConversationBatchSelection(conversation.conversation_id),
      );
    }
    closeMoreMenu();
    contextMenuConversationId.value = conversation.conversation_id;
    positionContextMenu(event);
  };

  const handleContextMenuSelect = async (value: ChatMenuAction | null): Promise<void> => {
    if (value !== 'delete' || !contextMenuConversation.value) return;
    closeContextMenu();
    await deleteSelectedConversations();
  };

  const handleTogglePinned = async (conversation: ConversationListItem): Promise<void> => {
    const nextPinned = conversation.is_pinned !== true;
    await historyListStore.updatePinned(conversation.conversation_id, nextPinned);
  };

  const startRename = (conversation: ConversationListItem): void => {
    editingConversationId.value = conversation.conversation_id;
    editingTitle.value = conversation.title || conversationMessage('conversation.sidebar.untitled');

    void nextTick(() => {
      renameInputRef.value?.focus();
      renameInputRef.value?.select();
    });
  };

  const cancelRename = (): void => {
    editingConversationId.value = null;
    editingTitle.value = '';
    isSubmittingRename.value = false;
  };

  const confirmRename = async (conversation: ConversationListItem): Promise<void> => {
    if (isSubmittingRename.value || editingConversationId.value !== conversation.conversation_id) {
      return;
    }

    const nextTitle = editingTitle.value.trim();
    if (!nextTitle || nextTitle === conversation.title) {
      cancelRename();
      return;
    }

    isSubmittingRename.value = true;

    try {
      await conversationTitleFeature.renameConversation(conversation.conversation_id, nextTitle);
      cancelRename();
    } catch {
      notificationStore.show(
        conversationMessage('conversation.sidebar.renameFailedGeneric'),
        'error',
        4000,
      );
      isSubmittingRename.value = false;
    }
  };

  const deleteConversation = async (conversation: ConversationListItem): Promise<void> => {
    if (isConversationDeleting(conversation.conversation_id)) return;
    const title = conversation.title || conversationMessage('conversation.sidebar.untitled');
    const confirmed = await confirm({
      title: conversationMessage('conversation.sidebar.delete.title'),
      message: conversationMessage('conversation.sidebar.delete.message', { title }),
      confirmText: conversationMessage('conversation.sidebar.delete.confirm'),
      cancelText: conversationMessage('conversation.sidebar.delete.cancel'),
      isDangerousAction: true,
    });

    if (!confirmed) return;

    try {
      await deleteConversationFromHistory({
        conversationId: conversation.conversation_id,
        scope: props.scope,
      });
      conversationSelectionStore.remove(props.scope, conversation.conversation_id);
      notificationStore.show(
        conversationMessage('conversation.sidebar.deleteSuccess', { title }),
        'success',
        3000,
      );
    } catch {
      notificationStore.show(
        conversationMessage('conversation.sidebar.deleteFailedGeneric'),
        'error',
        4000,
      );
    }
  };

  const retryConversationCleanup = async (conversation: ConversationListItem): Promise<void> => {
    if (isConversationDeleting(conversation.conversation_id)) return;
    const title = conversation.title || conversationMessage('conversation.sidebar.untitled');
    const confirmed = await confirm({
      title: conversationMessage('conversation.sidebar.cleanupRetry.title'),
      message: conversationMessage('conversation.sidebar.cleanupRetry.message', { title }),
      confirmText: conversationMessage('conversation.sidebar.cleanupRetry.confirm'),
      cancelText: conversationMessage('conversation.sidebar.delete.cancel'),
      isDangerousAction: true,
    });
    if (!confirmed) return;
    try {
      await retryConversationCleanupFromHistory({
        conversationId: conversation.conversation_id,
        scope: props.scope,
      });
      notificationStore.show(
        conversationMessage('conversation.sidebar.cleanupRetry.success', { title }),
        'success',
        3000,
      );
    } catch {
      notificationStore.show(
        conversationMessage('conversation.sidebar.deleteFailedGeneric'),
        'error',
        4000,
      );
    }
  };

  const handleMenuSelect = async (value: ChatMenuAction | null): Promise<void> => {
    if (!value || !activeMenuConversation.value) return;

    const conversation = activeMenuConversation.value;
    closeMoreMenu();

    if (value === 'pin') {
      await handleTogglePinned(conversation);
      return;
    }
    if (value === 'rename') {
      startRename(conversation);
      return;
    }
    if (value === 'retry_cleanup') {
      await retryConversationCleanup(conversation);
      return;
    }

    await deleteConversation(conversation);
  };

  const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!activeMenuConversationId.value && !contextMenuConversationId.value) return;

    const target = event.target;
    if (!(target instanceof Node)) return;

    const buttonEl = activeMenuButtonRef.value;
    const dropdownEl = menuDropdownRef.value;
    if (buttonEl?.contains(target) || dropdownEl?.contains(target) || contextMenuDropdownRef.value?.contains(target)) return;

    closeMoreMenu();
    closeContextMenu();
  };

  onMounted(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    window.addEventListener('resize', closeMoreMenu);
    window.addEventListener('resize', closeContextMenu);
  });

  onUnmounted(() => {
    if (loadConversationsTimer) {
      clearTimeout(loadConversationsTimer);
      loadConversationsTimer = null;
    }
    if (revealPulseTimer) {
      clearTimeout(revealPulseTimer);
      revealPulseTimer = null;
    }
    if (revealFlushTimer) {
      clearTimeout(revealFlushTimer);
      revealFlushTimer = null;
    }
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    window.removeEventListener('resize', closeMoreMenu);
    window.removeEventListener('resize', closeContextMenu);
  });

  watch(
    listRequestKey,
    (nextKey, previousKey) => {
      if (!active.value) return;

      const nextScope = nextKey.split('|')[0] ?? '';
      const previousScope = previousKey?.split('|')[0] ?? '';
      const scopeChanged = previousKey === undefined || nextScope !== previousScope;
      const shouldResetList = scopeChanged || !hasLoaded.value;

      if (scopeChanged) {
        isConversationListExpanded.value = false;
      }

      scheduleLoadConversations(
        { clearBeforeLoad: shouldResetList },
        scopeChanged ? 0 : 180,
      );
    },
    { immediate: true },
  );

  watch(active, (nextActive) => {
    if (!nextActive) return;

    void loadConversations({
      clearBeforeLoad: false,
    });
  });

  watch(
    [visibleConversations, isLoading, error],
    () => {
      void nextTick(() => {
        emit('display-change');
      });
    },
  );

  watch(conversations, (nextConversations) => {
    const validIds = new Set(nextConversations.map(conversation => conversation.conversation_id));
    const staleIds = batchSelectedConversationIds.value.filter(id => !validIds.has(id));
    for (const id of staleIds) conversationSelectionStore.remove(props.scope, id);
  });

  watch(selectionEnabled, (enabled) => {
    if (!enabled) clearConversationSelection();
  });

  watch(
    () => props.revealPulseKey,
    (nextKey, previousKey) => {
      if (nextKey === undefined || nextKey === previousKey) return;
      isConversationListExpanded.value = true;
      pendingRevealPulseKey.value = nextKey;

      if (revealFlushTimer) clearTimeout(revealFlushTimer);
      revealFlushTimer = setTimeout(() => {
        revealFlushTimer = null;
        if (isLoadInFlight.value) return;
        flushPendingHistoryRevealPulse();
      }, 0);
    },
  );

  return {
    variant,
    surface,
    conversationMessage,
    shouldShowInitialLoading,
    error,
    filteredConversations,
    normalizedSearchQuery,
    visibleConversations,
    isConversationActive,
    isConversationBatchSelected,
    isConversationDeleting,
    isConversationUnavailable,
    isHistoryRevealPulseActive,
    editingConversationId,
    editingTitle,
    setMenuButtonRef,
    setRenameInputRef,
    confirmRename,
    cancelRename,
    formatListTime,
    toggleMoreMenu,
    shouldShowExpandControl,
    expandConversationList,
    shouldShowCollapseControl,
    collapseConversationList,
    activeMenuConversation,
    menuDropdownRef,
    menuDropdownStyle,
    activeMenuOptions,
    activeMenuButtonRef,
    handleMenuSelect,
    closeMoreMenu,
    closeContextMenu,
    contextMenuConversation,
    contextMenuDropdownRef,
    contextMenuDropdownStyle,
    contextMenuOptions,
    handleContextMenu,
    handleContextMenuSelect,
    handleClickConversation,
    handleSelectConversation,
  };
}
