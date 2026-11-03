import { computed, ref, type Ref } from 'vue';
import type { Editor } from '@tiptap/core';
import { useRevisionStore } from '../../../features/Revision/useRevisionStore';

/** 只读对照来自 Revision 账本；公式编辑面板不持有、也不提交 Pending。 */
export function useLatexRevisionView(editor: Editor, rootBlockId: Ref<string | null>) {
  const store = useRevisionStore(editor);
  const showingBaseline = ref(false);
  const session = computed(() => rootBlockId.value ? store.getCanonicalSession(rootBlockId.value) : null);
  const baselineSource = computed<string | null>(() => {
    void session.value?.projection;
    const content = rootBlockId.value ? store.readProjectionBaseline(rootBlockId.value)?.firstChild : null;
    const source: unknown = content?.attrs.latexSource;
    return content?.type.name === 'latexBlock' && typeof source === 'string' ? source : null;
  });
  const pending = computed(() => session.value !== null);
  const canToggleBaseline = computed(() => session.value?.projection === 'ready' && session.value.operation === 'update' && baselineSource.value !== null);
  const displaysBaseline = computed(() => canToggleBaseline.value && showingBaseline.value);
  const badge = computed(() => session.value?.projection !== 'ready' ? null : session.value.operation === 'delete' ? 'deleted' : 'proposed');
  return { pending, badge, baselineSource, canToggleBaseline, displaysBaseline, showingBaseline,
    toggleBaseline: () => { showingBaseline.value = !showingBaseline.value; } };
}
