import { computed, ref, watch, type Ref } from 'vue';

/** 草稿是局部交互状态；提交前比较整个块版本，不能覆盖并发修改。 */
export function useFigureCaptionDraft(options: {
  value: Ref<string>;
  version: Ref<string>;
  editable: Ref<boolean>;
  limit: Ref<number>;
  commit: (value: string, version: string) => void;
  active: (value: boolean) => void;
}) {
  const editing = ref(false);
  const draft = ref('');
  const composing = ref(false);
  const conflict = ref(false);
  let original = '';
  let version = '';
  let blurredWhileComposing = false;
  const invalid = computed(
    () => draft.value.length > options.limit.value || /[\r\n]/u.test(draft.value)
  );
  function close() {
    editing.value = false;
    options.active(false);
  }
  function begin() {
    if (!options.editable.value || editing.value) return false;
    original = options.value.value;
    version = options.version.value;
    draft.value = original;
    conflict.value = false;
    blurredWhileComposing = false;
    editing.value = true;
    options.active(true);
    return true;
  }
  function commit() {
    if (!editing.value || composing.value) return;
    if (!options.editable.value || options.version.value !== version) {
      conflict.value = true;
      close();
      return;
    }
    if (draft.value === original) {
      close();
      return;
    }
    if (invalid.value) return;
    options.commit(draft.value, version);
    close();
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || composing.value) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  }
  function blur() {
    if (composing.value) blurredWhileComposing = true;
    else commit();
  }
  function endComposition() {
    composing.value = false;
    if (blurredWhileComposing) {
      blurredWhileComposing = false;
      commit();
    }
  }
  watch(options.editable, editable => {
    if (!editable && editing.value) {
      conflict.value = true;
      close();
    }
  });
  return {
    editing,
    draft,
    composing,
    conflict,
    invalid,
    begin,
    commit,
    blur,
    endComposition,
    cancel: close,
    keydown,
  };
}
