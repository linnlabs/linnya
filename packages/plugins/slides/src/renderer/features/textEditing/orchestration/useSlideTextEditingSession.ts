import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import type {
  TextEditingCommitResult,
  TextEditingTarget,
} from '../definitions/textEditingTypes';
import { useSlidesTextEditingStore } from '../store/slidesTextEditingStore';

export interface SlideTextEditingSessionOptions {
  readonly submitOperation: (operation: SlidesManualEditOperation) => void;
}

export function useSlideTextEditingSession(options: SlideTextEditingSessionOptions) {
  const store = useSlidesTextEditingStore();
  const { target, draft, composing } = storeToRefs(store);
  const submissionPending = ref(false);
  const model = computed({
    get: () => draft.value,
    set: (value: string) => store.updateDraft(value),
  });

  function open(next: TextEditingTarget): void {
    if (submissionPending.value) return;
    store.open(next);
  }

  function requestCommit(): TextEditingCommitResult {
    if (submissionPending.value || composing.value) return 'blocked';
    const current = target.value;
    if (!current) return 'closed';
    if (draft.value === current.content) {
      store.close();
      return 'closed';
    }
    options.submitOperation({
      op: 'set_text_content',
      targetKind: current.targetKind,
      target: current.authoringRef,
      content: draft.value,
    });
    submissionPending.value = true;
    return 'submitted';
  }

  function cancel(): void {
    if (submissionPending.value) return;
    store.close();
  }

  function beginComposition(): void {
    store.setComposing(true);
  }

  function endComposition(): void {
    store.setComposing(false);
  }

  function handleEscape(event: KeyboardEvent): void {
    if (event.isComposing || composing.value) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }

  function handleCommitShortcut(event: KeyboardEvent): void {
    if (event.isComposing || composing.value) return;
    event.preventDefault();
    event.stopPropagation();
    requestCommit();
  }

  return {
    target,
    draft: model,
    composing,
    submissionPending,
    open,
    requestCommit,
    cancel,
    beginComposition,
    endComposition,
    handleEscape,
    handleCommitShortcut,
    reconcileTarget: store.reconcileTarget,
    complete: () => {
      submissionPending.value = false;
      store.close();
    },
    rejectSubmission: () => {
      submissionPending.value = false;
    },
    reset: () => {
      submissionPending.value = false;
      store.close();
    },
  };
}
