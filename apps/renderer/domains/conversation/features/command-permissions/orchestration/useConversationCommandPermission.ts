import { computed, onScopeDispose, watch, type Ref } from 'vue';

import {
  resolveConversationCommandPermission,
  type CommandPermissionLevel,
} from '@app/schemas/commands';
import { requestConversationCommandPermission } from '@/app/workflows/command-permissions';
import { readConversationLiveMessages, refreshCurrentWindow } from '../../../message-window';
import { createConversationCommandPermissionState } from '../store/conversationCommandPermissionState';

type Target = { conversation_id: string; project_id: string | null };

export function useConversationCommandPermission(input: {
  readonly target: Readonly<Ref<Target | null>>;
  readonly runStatus: Readonly<Ref<string>>;
  readonly draftKey: Readonly<Ref<string>>;
  readonly materialize: () => Target | null;
  readonly confirmFullAccess: () => Promise<boolean>;
  /** 写入没成功（冲突、找不到对话或 Host 不可用）；当前档位已重新读取。 */
  readonly reportWriteFailure: () => void;
}) {
  const state = createConversationCommandPermissionState();
  const scope = computed(() => input.target.value?.conversation_id ?? input.draftKey.value);
  let readSequence = 0;
  let unsavedDraftId: string | undefined;

  async function refresh() {
    const sequence = ++readSequence;
    const result = await requestConversationCommandPermission({ kind: 'read', target: input.target.value });
    if (sequence !== readSequence) return;
    state.receive(result.kind === 'view' ? result.view : undefined);
  }

  watch(scope, () => {
    state.resetView();
    void refresh();
  }, { immediate: true });
  watch(input.runStatus, () => { void refresh(); });
  /** 变更记录已在 Host 投影进时间线；窗口按修订号增量取回，不重载整段历史。 */
  function refreshTimeline(conversationId: string) {
    void refreshCurrentWindow(conversationId, { readLiveMessages: readConversationLiveMessages });
  }
  const unsubscribe = window.electronAPI?.onConversationCommandPermissionChanged?.(() => {
    void refresh();
    // 设置页批量调低也会给当前对话写记录。
    const conversationId = input.target.value?.conversation_id;
    if (conversationId) refreshTimeline(conversationId);
  });
  onScopeDispose(() => {
    readSequence++;
    unsubscribe?.();
  });

  async function select(next: CommandPermissionLevel | null): Promise<void> {
    const initial = state.current.value;
    if (!initial || state.busy.value || initial.selection.permission_level === next) return;
    const originalScope = scope.value;
    state.setBusy(true);
    try {
      const resolved = resolveConversationCommandPermission(initial.global_level, next).permission_level;
      if (resolved === 'full_access' && (next === 'full_access' || initial.permission_level !== 'full_access')) {
        if (!await input.confirmFullAccess()) return;
      }
      if (scope.value !== originalScope) return;
      const existing = input.target.value;
      const target = existing ?? input.materialize();
      if (!target) return;
      if (!existing) unsavedDraftId = target.conversation_id;
      const result = await requestConversationCommandPermission({
        kind: 'set',
        target,
        create: unsavedDraftId === target.conversation_id,
        expected_revision: initial.selection.revision,
        expected_global_revision: initial.global_revision,
        permission_level: next,
      });
      if (result.kind === 'view' && unsavedDraftId === target.conversation_id) unsavedDraftId = undefined;
      if (scope.value !== target.conversation_id) return;
      if (result.kind === 'view') {
        readSequence++;
        state.receive(result.view);
        refreshTimeline(target.conversation_id);
      } else {
        input.reportWriteFailure();
        await refresh();
      }
    } catch {
      if (scope.value === originalScope) input.reportWriteFailure();
    } finally {
      state.setBusy(false);
    }
  }

  return { current: state.current, loadState: state.loadState, busy: state.busy, select };
}
