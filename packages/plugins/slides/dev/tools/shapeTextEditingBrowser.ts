import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import VueKonva from 'vue-konva';
import Konva from 'konva';
import type { SlidesManualEditCommand, SlidesManualEditCommandResult } from '../../src/shared/authoringEditing';
import { useManualEditQueue, provideManualEditSubmission, useSlidesManualEditingStore } from '../../src/renderer/features/manualEditing';
import { useSlidesEditingInteractionStore } from '../../src/renderer/features/editingInteraction';
import { useSlidesStore } from '../../src/renderer/store/slidesStore';
import { useSlidesRenderStore } from '../../src/renderer/store/slidesRenderStore';
import { useSlidesUiStore } from '../../src/renderer/store/slidesUiStore';
import SlideStage from '../../src/renderer/ui/preview/SlideStage.vue';
import type { SlideRenderModel, ShapeRenderNode, TextRenderNode } from '../../src/renderer/types/render';
import '../../src/renderer/features/textEditing/ui/InlineTextEditor.css';
import '../../src/renderer/ui/preview/SlideStage.css';
import '../../src/renderer/features/manualEditing/ui/ManualSelectionBreadcrumb.css';

/** 完整生产 Stage + 输入/选择/提交队列。只替换 IPC 与文稿读取，不模拟交互或结算。 */
export function mountShapeTextEditingSmoke() {
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:720px;height:420px';
  document.body.append(host);
  const commands: { command: SlidesManualEditCommand; resolve: (result: SlidesManualEditCommandResult) => void }[] = [];
  const initialSlide: SlideRenderModel = {
    slideId: 'shape-text', index: 0, layoutKey: 'freeform', background: { paint: { type: 'solid', color: '#FFFFFF' } },
    elements: [{
      id: 'badge', kind: 'shape', zIndex: 0,
      box: { x: 0.5, y: 0.5, w: 2.5, h: 1, unit: 'in' },
      geometry: { type: 'preset', name: 'rect' }, fill: { type: 'solid', color: '#2563EB' },
      authoringRef: { slideKey: 'overview', editKey: 'badge', targetKind: 'shape' },
      authoringEdit: { capabilities: ['translate', 'set_text_content', 'set_visual_size'], text: { kind: 'plain_text', content: 'Shape text' } },
      innerText: {
        id: 'badge-inner', kind: 'text', zIndex: 0,
        box: { x: 0.5, y: 0.5, w: 2.5, h: 1, unit: 'in' }, verticalAlign: 'middle',
        paragraphs: [{ align: 'center', runs: [{ text: 'Shape text', fontSize: 14, color: '#FFFFFF' }] }],
        layout: { contentHeightInches: 0.2, appliedFontScale: 1, appliedLineSpacingReduction: 0,
          advanceSource: 'harfbuzz', overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
          lines: [{ paragraphIndex: 0, align: 'center', y: 0.4, height: 0.2, baseline: 0.15, width: 1,
            slices: [{ paragraphIndex: 0, runIndex: 0, text: 'Shape text', x: 1, textY: 0.4, width: 1 }] }],
        },
      },
    }],
  };

  const first = initialSlide.elements[0];
  if (first?.kind !== 'shape') throw new Error('Missing fixture Shape');
  const second: ShapeRenderNode = {
    ...first, id: 'second', box: { ...first.box, x: 3.5, w: 2 },
    authoringRef: { slideKey: 'overview', editKey: 'second', targetKind: 'shape' },
    authoringEdit: { capabilities: ['translate', 'set_text_content', 'set_visual_size'], text: { kind: 'plain_text', content: 'Second shape' } },
    innerText: first.innerText ? { ...first.innerText, id: 'second-inner', box: { ...first.innerText.box, x: 3.5, w: 2 } } : undefined,
  };
  if (!first.innerText) throw new Error('Missing fixture text');
  const standalone: TextRenderNode = {
    ...first.innerText, id: 'standalone', box: { ...first.innerText.box, x: 0.5, y: 2, w: 2.5, h: 1 },
    authoringRef: { slideKey: 'overview', editKey: 'standalone', targetKind: 'text' },
    authoringEdit: { capabilities: ['translate', 'set_text_content'], text: { kind: 'plain_text', content: 'Plain text' } },
  };
  const slide = { ...initialSlide, elements: [first, second, standalone] };
  const pinia = createPinia();
  const slides = useSlidesStore(pinia);
  const render = useSlidesRenderStore(pinia);
  const manual = useSlidesManualEditingStore(pinia);
  const interaction = useSlidesEditingInteractionStore(pinia);
  const ui = useSlidesUiStore(pinia);
  const content = new Map([['badge', 'Shape text'], ['second', 'Second shape'], ['standalone', 'Plain text']]);
  let savedRevision = 1;
  const before = new Set(Konva.stages);

  function buildState(version: number) {
    return { state: 'ready' as const, presentationId: 'interaction-fixture', versionId: `v${version}`,
      versionNumber: version, sourceHash: 'a'.repeat(64) };
  }
  function present(version: number) {
    render.renderModel = {
      presentationId: 'interaction-fixture', title: 'Editing interaction', version, sourceKind: 'generated',
      slideSize: { width: 6.5, height: 3.5, unit: 'in' },
      capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true },
      slides: [{ ...slide, elements: slide.elements.map(node => {
        const text = node.kind === 'shape' ? node.innerText : node;
        if (!text || !node.authoringEdit) throw new Error('Invalid text fixture');
        const projectedText = { ...text,
          paragraphs: [{ align: 'center' as const, runs: [{ text: content.get(node.id) ?? '', fontSize: 14, color: node.kind === 'text' ? '#111827' : '#FFFFFF' }] }],
          layout: text.layout ? { ...text.layout,
            lines: text.layout.lines.map(line => ({ ...line,
              slices: line.slices.map(slice => ({ ...slice, text: content.get(node.id) ?? '' })) })),
          } : undefined,
        };
        const authoringEdit = { ...node.authoringEdit, text: { kind: 'plain_text' as const, content: content.get(node.id) ?? '' } };
        return node.kind === 'shape' ? { ...node, authoringEdit, innerText: projectedText }
          : { ...node, ...projectedText, authoringEdit };
      }) }],
    };
  }
  slides.currentDeckId = 'interaction-fixture';
  slides.documentBuildState = buildState(1);
  present(1);
  const app = createApp({ setup() {
    provideManualEditSubmission(useManualEditQueue({
      readSnapshot: () => ({ documentId: slides.currentDeckId, presentationError: render.renderError, buildState: slides.documentBuildState, renderVersion: render.renderModel?.version ?? null }),
      createCommandId: () => crypto.randomUUID(), message: key => key,
      submit: command => new Promise(resolve => commands.push({ command, resolve })),
      refreshDocument: async (_id, revision) => { slides.documentBuildState = buildState(revision ?? savedRevision); },
    }));
    manual.setEnabled(true);
    ui.setZoom(1);
    return () => h(SlideStage);
  } });
  app.use(pinia); app.use(VueKonva); app.mount(host);

  function input(): HTMLTextAreaElement {
    const editor = host.querySelector('textarea');
    if (!editor) throw new Error('Stage did not open the inline editor');
    return editor;
  }
  function assertInput(value: string) {
    const editor = input();
    if (editor.value !== value || editor.disabled || document.activeElement !== editor) {
      throw new Error(`Input ownership mismatch: ${JSON.stringify({ value: editor.value, expected: value, disabled: editor.disabled, focused: document.activeElement === editor })}`);
    }
  }
  return {
    async ready() { await nextTick(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); },
    point(which = 'badge') {
      // 属性面板固定在画布右上；点击真实露出的对象区域，不向被面板遮挡的坐标发事件。
      const wrapper = host.querySelector('.stage-canvas-wrapper');
      if (!wrapper) throw new Error('Stage canvas missing');
      const box = wrapper.getBoundingClientRect();
      return { x: Math.round(box.x + box.width * (which === 'second' ? 3.8 : 1.5) / 6.5), y: Math.round(box.y + box.height * (which === 'standalone' ? 2.5 : 1) / 3.5) };
    },
    async assertEditing() {
      await nextTick(); assertInput('Shape text');
      const style = getComputedStyle(input());
      if (style.outlineStyle !== 'none' || style.borderTopWidth !== '0px' || style.boxShadow !== 'none') throw new Error('Duplicate editing border');
      const stage = Konva.stages.find(candidate => !before.has(candidate));
      if (stage?.getLayers()[1]?.find('Text').filter(node => node.isVisible()).length !== 2) throw new Error('Editing must hide only the active Shape text');
      if (!stage?.getLayers()[1]?.find('Rect').some(node => node.isVisible())) throw new Error('Shape disappeared while editing');
      if (stage.getLayers()[2]?.find('Line').filter(node => node.isVisible()).length !== 1) throw new Error('Expected one selection outline');
    },
    assertInput,
    setInput(value: string) {
      const editor = input(); editor.value = value; editor.dispatchEvent(new Event('input', { bubbles: true }));
    },
    async verifyIme() {
      const editor = input();
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      editor.value = '修改形状'; editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      if (commands.length) throw new Error('Submitted during IME composition');
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      await nextTick();
    },
    assertSelected(id: string) {
      if (manual.selectedTarget?.elementId !== id || host.querySelector('textarea')) throw new Error(`Outside selection blocked: ${manual.selectedTarget?.elementId}`);
      const previews = host.querySelectorAll('.slides-inline-text-editor--preview');
      if (!previews.length || [...previews].some(node => getComputedStyle(node).pointerEvents !== 'none')) throw new Error('Missing passive text preview');
    },
    assertSubmitted(count = 1) {
      if (commands.length !== count) throw new Error(`Expected ${count} commands, got ${commands.length}`);
      const operation = commands[0]?.command.operation;
      if (operation?.op !== 'set_text_content' || operation.targetKind !== 'shape' || operation.content !== '修改形状') throw new Error('Wrong Shape command');
    },
    resolve(index: number, success: boolean) {
      const item = commands[index];
      if (!item) throw new Error('Missing queued command');
      if (success) {
        const operation = item.command.operation;
        if (operation.op === 'set_text_content') content.set(operation.target.editKey, operation.content);
        savedRevision += 1;
        item.resolve({ status: 'committed', commandId: item.command.commandId, documentId: item.command.documentId, revisionId: `v${savedRevision}`, revision: savedRevision });
      } else item.resolve({ status: 'validation_failed', commandId: item.command.commandId, documentId: item.command.documentId, code: 'operation_invalid', message: 'Fixture compile failure' });
    },
    present() { present(savedRevision); },
    assertFailedDraft(value: string) {
      if (!interaction.textDrafts.some(draft => draft.content === value && draft.status === 'failed')) throw new Error('Failed draft was lost');
    },
    assertTextCommand(index: number, text: string) {
      const operation = commands[index]?.command.operation;
      if (operation?.op !== 'set_text_content' || operation.targetKind !== 'text' || operation.content !== text) throw new Error('Wrong standalone text command');
    },
    resizePoint() {
      const handle = host.querySelector<HTMLButtonElement>('[aria-label="调整宽度和高度"]');
      if (!handle) throw new Error('Stage resize handle missing');
      const box = handle.getBoundingClientRect();
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    },
    assertPendingSize(width: number, height: number) {
      const preview = host.querySelector<HTMLElement>('.slides-inline-text-editor--preview');
      if (!preview || Math.abs(parseFloat(preview.style.width) - width * 96) > 1
        || Math.abs(parseFloat(preview.style.height) - height * 96) > 1
        || Math.abs(parseFloat(preview.style.paddingTop) - (height - 0.2) / 2 * 96) > 1) throw new Error('Pending text did not follow the live resize geometry and vertical alignment');
    },
    assertSettled() {
      if (interaction.textDrafts.length || manual.submission.phase !== 'idle') throw new Error('Formal Stage frame did not settle receipts');
    },
    dispose() { app.unmount(); host.remove(); },
  };
}
