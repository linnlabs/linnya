<template>
  <node-view-wrapper class="latex-block-view" ref="nodeViewWrapperRef" :data-node-id="props.node.attrs.id">
    <div v-if="revision.badge.value" class="latex-revision" contenteditable="false" role="status">
      <span>{{ editorMessage(revision.badge.value === 'deleted' ? 'editor.latexBlock.revision.deletedBadge' : 'editor.latexBlock.revision.proposedBadge') }}</span>
      <BaseButton v-if="revision.canToggleBaseline.value" variant="plain" size="sm" @click.stop="revision.toggleBaseline">
        {{ editorMessage(revision.showingBaseline.value ? 'editor.latexBlock.revision.showProposed' : 'editor.latexBlock.revision.showBaseline') }}
      </BaseButton>
    </div>
    <div class="latex-container">
      <!-- Rendered Content based on renderedHtml ref -->
      <div
        v-if="renderedHtml && renderedHtml.trim() !== ''"
        ref="latexRenderer"
        class="latex-rendered-content"
        @click="openLatexPanel"
        v-html="renderedHtml"
      ></div>
      <!-- Placeholder only if renderedHtml is empty -->
      <div
        v-else
        class="latex-placeholder"
        @click="openLatexPanel"
      >
        {{ editorMessage('editor.latexBlock.placeholder') }}
      </div>

      <!-- Error Display -->
      <div v-if="renderError" class="latex-error-message">
        {{ editorMessage('editor.latexBlock.renderError') }}
      </div>
    </div>
  </node-view-wrapper>
</template>

<script setup>
import { computed, ref, watch, onMounted, nextTick, inject } from 'vue';
import { NodeViewWrapper, nodeViewProps, NodeViewContent } from '@tiptap/vue-3'; // Added NodeViewContent if needed, maybe not
import katex from 'katex';
import { useLatexEditorStore } from '../store/latexEditor';
import { useCurrentBlockActivation } from '../../../ui/composables/useCurrentBlockActivation';
import { EDITOR_KEY } from '../../../core/tokens';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import { BaseButton } from '@linnya/renderer-ui';
import { useLatexRevisionView } from '../orchestration/useLatexRevisionView';

const props = defineProps(nodeViewProps);
const latexStore = useLatexEditorStore();
const injectedEditor = inject(EDITOR_KEY, null);
const { currentLocale, editorMessage } = useEditorLocalization();

// 块激活状态：当前块内无 hover 控件需要门控，
// 但接入后 LatexInputPanel 的保活机制可以通过此上下文协调
const blockActivation = useCurrentBlockActivation();

// --- Refs ---
const nodeViewWrapperRef = ref(null);
const renderedHtml = ref('');
const renderError = ref(null);
const lastRenderedSource = ref('');
const rootBlockId = computed(() => {
  void props.node;
  const pos = props.getPos();
  if (typeof pos !== 'number') return null;
  const id = props.editor.state.doc.resolve(pos).parent.attrs.id;
  return typeof id === 'string' ? id : null;
});
const revision = useLatexRevisionView(props.editor, rootBlockId);
const displayedSource = computed(() => revision.displaysBaseline.value ? revision.baselineSource.value : props.node.attrs.latexSource);

// --- Render Function (with internal check) ---
const renderLatex = (source, origin = 'unknown') => {
  const sourceToUse = source || '';

  let newHtml = '';
  let newError = null;
  try {
    if (sourceToUse.trim() === '') {
      newHtml = '';
      newError = null;
    } else {
      newHtml = katex.renderToString(sourceToUse, {
        throwOnError: false,
        displayMode: true,
        output: 'html',
        strict: false,
      });
      newError = null;
    }
    renderedHtml.value = newHtml;
    renderError.value = newError;
    lastRenderedSource.value = sourceToUse; // Update last rendered source *after* successful render
  } catch (error) {
    newHtml = `<span class="latex-render-error">${editorMessage('editor.latexBlock.renderError')}</span>`;
    newError = true;
    renderedHtml.value = newHtml;
    renderError.value = newError;
    lastRenderedSource.value = sourceToUse;
    console.error('[LatexBlockView] KaTeX 渲染错误:', error);
  }
};

// Vue NodeView 的属性更新与只读对照切换共用渲染入口，不能依赖已打开的编辑面板来刷新公式。
watch(displayedSource, source => renderLatex(source, 'Revision/Node Update'), { immediate: true });

// --- Watcher for Live Preview and Cancel/ESC Restore ---
watch(() => [
  latexStore.isPanelVisible,
  latexStore.targetNodeId,
  latexStore.currentSource,
  latexStore.originalSource
], ([isVisible, targetId, storeSource, originalSource], [oldIsVisible, oldTargetId, /* ... */]) => {
  if (revision.pending.value) return;
  const isPanelNowVisibleForThisNode = isVisible && targetId === props.node.attrs.id;
  const wasPanelVisibleForThisNode = oldIsVisible && oldTargetId === props.node.attrs.id;

  if (isPanelNowVisibleForThisNode) {
    renderLatex(storeSource, 'Live Preview Watcher');

  } else if (wasPanelVisibleForThisNode && !isVisible) {
    if (storeSource === originalSource) {
        renderLatex(originalSource, 'Panel Closed Watcher (Cancel/Restore)');
    }
  }
}, { immediate: false });

watch(currentLocale, () => {
  if (renderError.value) {
    renderLatex(lastRenderedSource.value, 'Locale Changed');
  }
});

watch(revision.pending, pending => {
  if (pending && latexStore.isPanelVisible && latexStore.targetNodeId === props.node.attrs.id) void latexStore.hidePanel();
});

// --- Lifecycle ---
onMounted(() => {
  const initialSource = props.node.attrs.latexSource;

  // ++ 新逻辑：基于意图驱动的自动打开 ++
  const currentNodeId = props.node.attrs.id;
  if (initialSource === '' && currentNodeId === latexStore.pendingOpenNodeId) {
    // 清除待打开标志（只打开一次）
    latexStore.clearPendingOpenNodeId();

    // 使用 nextTick 确保 DOM 完全挂载后再打开面板
    nextTick(() => {
      openLatexPanel();
    });
  }
});

// --- Function to open the panel (remains the same) ---
const openLatexPanel = () => {
  if (!props.editor.isEditable || revision.pending.value) return;
  if (latexStore.isPanelVisible && latexStore.targetNodeId === props.node.attrs.id) {
    latexStore.submitCurrentLatex();
    return;
  }

  let editorToUse = props.editor || (injectedEditor && typeof injectedEditor.value !== 'undefined' ? injectedEditor.value : injectedEditor) || null;

  if (!editorToUse) {
      console.error('[LatexBlockView] 无法获取编辑器实例');
  }

  const domElement = nodeViewWrapperRef.value?.$el || nodeViewWrapperRef.value;
  let referenceElementForPanel = null;

  if (domElement instanceof Element) {
      referenceElementForPanel = domElement;
  } else {
      console.warn('[LatexBlockView] Cannot find DOM element reliably, attempting fallback querySelector');
      referenceElementForPanel = document.querySelector(`.latex-block-view[data-node-id="${props.node.attrs.id}"]`);
  }

  latexStore.showPanel(
    props.node.attrs.id,
    props.node.attrs.latexSource,
    referenceElementForPanel,
    editorToUse
  );
};

</script>
