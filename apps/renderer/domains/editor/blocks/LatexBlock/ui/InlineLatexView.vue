<template>
  <node-view-wrapper as="span" class="inline-latex-view" :class="{ 'has-error': renderError }">
    <span
      ref="latexRenderer"
      class="inline-latex-rendered"
      @click="handleClick"
      v-html="renderedHtml"
    ></span>
    <span
      v-if="renderError"
      class="inline-latex-error-indicator"
      :title="editorMessage('editor.latexBlock.inline.invalidSource')"
    >⚠️</span>
  </node-view-wrapper>
</template>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import katex from 'katex';
import { useLatexEditorStore } from '../store/latexEditor'; // Uncomment and import store
import { EDITOR_KEY } from '../../../core/tokens';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const props = defineProps(nodeViewProps);
const latexStore = useLatexEditorStore(); // Get store instance
const injectedEditor = inject(EDITOR_KEY, null); // Inject editor instance
const { editorMessage } = useEditorLocalization();

const renderedHtml = ref('');
const renderError = ref(false);
const latexRenderer = ref(null); // Add ref for the renderer span

// Computed property for the source to render
const latexSource = computed(() => props.node?.attrs?.latexSource || '');

// Function to render LaTeX using KaTeX
const renderLatex = (source) => {
  try {
    renderedHtml.value = katex.renderToString(source || '', {
      throwOnError: false, 
      displayMode: false, 
      output: 'html',
      strict: false,
    });
    renderError.value = false;
  } catch (error) {
    renderedHtml.value = `<code class="inline-latex-source-error">${source}</code>`;
    renderError.value = true;
    console.error('[InlineLatexView] KaTeX render error:', error);
  }
};

// Render on mount and when source changes
onMounted(() => {
  renderLatex(latexSource.value);
});

watch(latexSource, (newSource) => {
  renderLatex(newSource);
});

// Handle click - Open the editor panel
const handleClick = () => {

  let editorToUse = null;
  if (props.editor) {
      editorToUse = props.editor;
  } else if (injectedEditor?.value) {
      editorToUse = injectedEditor.value;
  } else {
      console.error('[InlineLatexView] Cannot open panel: Editor instance not found.');
      return;
  }

  const referenceElement = latexRenderer.value; 
  if (!referenceElement) {
      console.error('[InlineLatexView] Cannot open panel: Reference element (latexRenderer) not found.');
      return;
  }
  
  const nodeId = props.node?.attrs?.id;
  if (!nodeId) {
      console.error('[InlineLatexView] Cannot open panel: Node ID is missing.');
      return; 
  }
  
  latexStore.showPanel(
      nodeId,
      latexSource.value, 
      referenceElement,
      editorToUse
  );
};

</script>
