import { createApp, h, nextTick, ref } from 'vue';
import { createPinia } from 'pinia';
import VueKonva from 'vue-konva';
import Konva from 'konva';
import { useSlideManualEditingInteraction, type ManualEditIntent } from '../../src/renderer/features/manualEditing';
import InlineTextEditor from '../../src/renderer/features/textEditing/ui/InlineTextEditor.vue';
import KonvaSlideStage from '../../src/renderer/ui/preview/konva/KonvaSlideStage.vue';
import type { SlideRenderModel } from '../../src/renderer/types/render';
import '../../src/renderer/features/textEditing/ui/InlineTextEditor.css';

/** 合成文稿驱动生产双击/IME/提交和 Canvas 隐字路径，不读用户文稿。 */
export function mountShapeTextEditingSmoke() {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:480px;height:288px';
  document.body.append(host);
  const operations: ManualEditIntent[] = [];
  const slide: SlideRenderModel = {
    slideId: 'shape-text', index: 0, layoutKey: 'freeform', background: { paint: { type: 'solid', color: '#FFFFFF' } },
    elements: [{
      id: 'badge', kind: 'shape', zIndex: 0,
      box: { x: 0.5, y: 0.5, w: 3, h: 1, unit: 'in' },
      geometry: { type: 'preset', name: 'rect' }, fill: { type: 'solid', color: '#2563EB' },
      authoringRef: { slideKey: 'overview', editKey: 'badge', targetKind: 'shape' },
      authoringEdit: { capabilities: ['translate', 'set_text_content'], text: { kind: 'plain_text', content: 'Shape text' } },
      innerText: {
        id: 'badge-inner', kind: 'text', zIndex: 0,
        box: { x: 0.5, y: 0.5, w: 3, h: 1, unit: 'in' }, verticalAlign: 'middle',
        paragraphs: [{ align: 'center', runs: [{ text: 'Shape text', fontSize: 14, color: '#FFFFFF' }] }],
        layout: { contentHeightInches: 0.2, appliedFontScale: 1, appliedLineSpacingReduction: 0,
          advanceSource: 'harfbuzz', overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
          lines: [{ paragraphIndex: 0, align: 'center', y: 0.4, height: 0.2, baseline: 0.15, width: 1,
            slices: [{ paragraphIndex: 0, runIndex: 0, text: 'Shape text', x: 1, textY: 0.4, width: 1 }] }],
        },
      },
    }],
  };
  const before = new Set(Konva.stages);
  const app = createApp({ setup() {
    const wrapper = ref<HTMLElement | null>(null);
    const interaction = useSlideManualEditingInteraction({
      canSelect: ref(true), currentSlide: ref(slide), renderScale: ref(1),
      slideSize: ref({ width: 5, height: 3 }), wrapperRef: wrapper,
      submitIntent: intent => operations.push(intent),
    });
    return () => [
      h('div', { ref: wrapper, onDblclick: interaction.handleDoubleClick }, [h(KonvaSlideStage, {
        slideRender: slide, imageResources: new Map(), chartResources: new Map(),
        slideSize: { width: 5, height: 3, unit: 'in' }, rasterScale: 1,
        selectedTargets: [], hoveredTarget: null, marqueeRect: null,
        manualSelectedTarget: interaction.selectedTarget.value,
        hiddenTextElementId: interaction.textEditorTarget.value?.elementId,
      })]),
      interaction.textEditorTarget.value ? h(InlineTextEditor, {
        target: interaction.textEditorTarget.value, modelValue: interaction.textDraft.value,
        slideLeft: 0, slideTop: 0, renderScale: 1, label: 'Shape text',
        'onUpdate:modelValue': (value: string) => { interaction.textDraft.value = value; },
        onCommit: interaction.submitTextEdit,
        onCompositionStart: interaction.handleTextCompositionStart,
        onCompositionEnd: interaction.handleTextCompositionEnd,
        onEscape: interaction.handleTextEditorEscape,
        onCommitShortcut: interaction.handleTextEditorSubmitShortcut,
      }) : null,
    ];
  } });
  app.use(createPinia());
  app.use(VueKonva);
  app.mount(host);
  const stage = Konva.stages.find(candidate => !before.has(candidate));
  if (!stage) throw new Error('Shape text stage missing');
  function input() {
    const element = host.querySelector('textarea');
    if (!element) throw new Error('Double click did not open inline shape editor');
    return element;
  }
  return {
    point() { const box = host.getBoundingClientRect(); return { x: Math.round(box.x + 100), y: Math.round(box.y + 80) }; },
    async assertEditing() {
      await nextTick();
      const editor = input();
      const style = getComputedStyle(editor);
      if (style.outlineStyle !== 'none' || style.borderTopWidth !== '0px' || style.boxShadow !== 'none') {
        throw new Error('Inline editor duplicates the canvas selection border');
      }
      if (editor.value !== 'Shape text' || document.activeElement !== editor) throw new Error('Shape text is not focused');
      const content = stage.getLayers()[1];
      if (!content?.findOne('Rect')?.isVisible() || content.find('Text').some(node => node.isVisible())) {
        throw new Error('Editing must retain the shape and hide only its inner text');
      }
      if (stage.getLayers()[2]?.find('Line').filter(node => node.isVisible()).length !== 1) {
        throw new Error('Editing must retain exactly one canvas outline');
      }
    },
    async verifyIme() {
      const editor = input();
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      editor.value = '修改形状';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      if (operations.length) throw new Error('Shape text submitted during IME composition');
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      await nextTick();
    },
    assertSubmitted() {
      const operation = operations[0]?.operation;
      if (operations.length !== 1 || operation?.op !== 'set_text_content' || operation.targetKind !== 'shape'
        || operation.target.editKey !== 'badge' || operation.content !== '修改形状') {
        throw new Error('Shape text did not submit exactly one typed author command');
      }
    },
    dispose() { app.unmount(); host.remove(); },
  };
}
