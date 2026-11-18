import { computed, onScopeDispose, watch, type Ref } from 'vue';

import {
  resolveConversationCommandPermission,
  type CommandPermissionLevel,
} from '@app/schemas/commands';
import { requestConversationCommandPermission } from '@/app/workflows/command-permissions';
import { createConversationCommandPermissionState } from '../store/conversationCommandPermissionState';

type Target = { conversation_id: string; project_id: string | null };

export function useConversationCommandPermission(input: {
  readonly target: Readonly<Ref<Target | null>>;
  readonly runStatus: Readonly<Ref<string>>;
  readonly draftKey: Readonly<Ref<string>>;
  readonly materialize: () => Target | null;
  readonly confirmFullAccess: () => Promise<boolean>;
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
  const unsubscribe = window.electronAPI?.onConversationCommandPermissionChanged?.(() => { void refresh(); });
  onScopeDispose(() => {
    readSequence++;
    unsubscribe?.();
  });

  async function select(next: CommandPermissionLevel | null): Promise<void> {
    const initial = state.current.value;
    if (!initial || state.busy.value || initial.selection.permission_level === next) return;
    const originalScope = scope.value;
    state.setBusy(true);
    state.setWriteFailure(false);
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
      } else {
        state.setWriteFailure(true);
        await refresh();
      }
    } catch {
      if (scope.value === originalScope) state.setWriteFailure(true);
    } finally {
      state.setBusy(false);
    }
  }

  return { current: state.current, loadState: state.loadState, busy: state.busy, writeFailure: state.writeFailure, select };
}
