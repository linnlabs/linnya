import { preparePreviewFixture } from './preparedPreviewFixture';
import { collectEditingPreviewGeometries } from '../../src/renderer/features/editingPreview';
import { prepareTextLayout, layoutPreparedText } from '../../src/shared/textLayout';
import { resizeShapeTextInput } from '../../src/shared/textLayout';
import { computed, createApp, h, nextTick, shallowRef } from 'vue';
import VueKonva from 'vue-konva';
import Konva from 'konva';
import ElementPropertyToolbar from '../../src/renderer/features/elementProperties/ui/ElementPropertyToolbar.vue';
import ManualResizeHandles from '../../src/renderer/features/manualEditing/ui/ManualResizeHandles.vue';
import KonvaSlideStage from '../../src/renderer/ui/preview/konva/KonvaSlideStage.vue';
import { projectElementPropertyTarget } from '../../src/renderer/features/elementProperties/functions/projectElementPropertyTarget';
import { createManualVisualPreview, projectManualEditableTargetSelection } from '../../src/renderer/features/manualEditing/functions/manualVisualPreview';
import type { ManualEditableTarget, ManualEditingVisualOperation, ManualEditingVisualPreview } from '../../src/renderer/features/manualEditing/definitions/manualEditingTypes';
import type { SlideRenderModel } from '../../src/renderer/types/render';
import '@linnya/renderer-ui/tokens.css';
import '@linnya/renderer-ui/styles.css';
import '../../src/renderer/features/elementProperties/ui/ElementPropertyToolbar.css';
import '../../src/renderer/features/manualEditing/ui/ManualResizeHandles.css';

export function mountManualPropertySmoke() {
  document.documentElement.setAttribute('data-linnya-ui-theme', 'light');
  const target: ManualEditableTarget = {
    elementId: 'editable-shape', nodeKind: 'shape', targetKind: 'shape',
    capabilities: ['translate', 'set_fill_color', 'set_visual_size'],
    authoringRef: { slideKey: 'slide', editKey: 'shape' }, authoringAncestorRefs: [],
    translationElementIds: ['editable-shape'], fill: { kind: 'solid', color: '#2563EB' },
    visualSize: { width: 2, height: 1 }, bounds: { x: 0.5, y: 0.5, w: 2, h: 1 },
    polygon: [{ x: 0.5, y: 0.5 }, { x: 2.5, y: 0.5 }, { x: 2.5, y: 1.5 }, { x: 0.5, y: 1.5 }],
  };
  const slide: SlideRenderModel = {
    slideId: 'slide', index: 0, layoutKey: 'LAYOUT_WIDE', background: { paint: { type: 'solid', color: '#FFFFFF' } },
    elements: [{ id: target.elementId, kind: 'shape', zIndex: 0,
      box: { x: 0.5, y: 0.5, w: 2, h: 1, unit: 'in' },
      geometry: { type: 'preset', name: 'rect' }, fill: { type: 'solid', color: '#2563EB' },
      innerText: {
        id: 'editable-shape-inner', kind: 'text', zIndex: 0,
        box: { x: 0.5, y: 0.5, w: 2, h: 1, unit: 'in' }, verticalAlign: 'middle',
        paragraphs: [{ align: 'center', runs: [{ text: 'Shape text', fontSize: 14, color: '#FFFFFF' }] }],
        layout: { contentHeightInches: 0.2, appliedFontScale: 1, appliedLineSpacingReduction: 0,
          advanceSource: 'harfbuzz', overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
          lines: [{ paragraphIndex: 0, align: 'center', y: 0.4, height: 0.2, baseline: 0.15, width: 1,
            slices: [{ paragraphIndex: 0, runIndex: 0, text: 'Shape text', x: 0.5, textY: 0.4, width: 1 }] }],
        },
      },
    }],
  };
  const initialShape = slide.elements[0];
  if (initialShape.kind !== 'shape' || !initialShape.innerText) throw new Error('Missing fixture shape');
  initialShape.innerText = preparePreviewFixture(initialShape.innerText, 'shape-inner-text');
  const queued = shallowRef<readonly ManualEditingVisualPreview[]>([]);
  const disabled = shallowRef(false);
  const transient = shallowRef<ManualEditingVisualPreview | null>(null);
  const previews = computed(() => [...queued.value, ...(transient.value ? [transient.value] : [])]);
  const presented = computed(() => projectManualEditableTargetSelection(target, new Map(), collectEditingPreviewGeometries(slide.elements, previews.value)));
  const properties = computed(() => projectElementPropertyTarget(target, previews.value));
  const operations: ManualEditingVisualOperation[] = [];
  function submit(operation: ManualEditingVisualOperation): void {
    const preview = createManualVisualPreview(target, operation);
    if (!preview) throw new Error('Unexpected property target');
    operations.push(operation);
    queued.value = [...queued.value, preview];
  }
  const host = document.createElement('div');
  host.tabIndex = 0;
  host.style.cssText = 'position:relative;width:760px;height:760px;font-family:system-ui;background:var(--color-bg-subtle);';
  document.body.append(host);
  const before = new Set(Konva.stages);
  const app = createApp({ setup: () => () => [
    h('div', { style: 'position:absolute;left:48px;top:48px;' }, [h(KonvaSlideStage, {
      slideRender: slide, imageResources: new Map(), chartResources: new Map(),
      slideSize: { width: 4, height: 3, unit: 'in' }, rasterScale: 1,
      selectedTargets: [], hoveredTarget: null, marqueeRect: null,
      manualSelectedTarget: presented.value, manualVisualPreviews: previews.value,
    })]),
    h(ManualResizeHandles, { target: presented.value, slideLeft: 48, slideTop: 48, renderScale: 1,
      onPreview: (value: ManualEditingVisualPreview | null) => { transient.value = value; }, onSubmit: submit,
      onFinish: () => host.focus({ preventScroll: true }) }),
    !transient.value ? h(ElementPropertyToolbar, {
      target: properties.value,
      anchor: { selection: { left: 48 + presented.value.bounds.x * 96, top: 48 + presented.value.bounds.y * 96,
        width: presented.value.bounds.w * 96, height: presented.value.bounds.h * 96 }, viewport: { width: 760, height: 760 } },
      busy: disabled.value, onSubmit: submit,
    }) : null,
  ] });
  app.use(VueKonva);
  app.mount(host);
  const stage = Konva.stages.find(candidate => !before.has(candidate));
  if (!stage) throw new Error('Property smoke stage missing');
  function button(selector: string): HTMLButtonElement {
    const element = host.querySelector(selector);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button ${selector}`);
    return element;
  }
  async function click(selector: string): Promise<void> { button(selector).click(); await nextTick(); }
  async function open(kind: 'fill' | 'size'): Promise<void> {
    const selector = `[data-property="${kind}"]`;
    if (button(selector).getAttribute('aria-expanded') !== 'true') await click(selector);
  }
  async function input(selector: string, value: string, commit = false): Promise<void> {
    const element = host.querySelector(selector);
    if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input ${selector}`);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    if (commit) element.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
  }
  function assert(value: boolean, message: string): void { if (!value) throw new Error(message); }
  return {
    async verifyDeletionControls() {
      const kinds: readonly ManualEditableTarget['targetKind'][] = ['text', 'frame', 'shape', 'image', 'table', 'chart', 'svgGraphic', 'formula'];
      const selected = shallowRef<ManualEditableTarget>(target);
      const busy = shallowRef(false);
      const deleted: string[] = [];
      const surface = document.createElement('div');
      host.append(surface);
      const controls = createApp({ render: () => h(ElementPropertyToolbar, {
        target: selected.value, busy: busy.value,
        anchor: { selection: { left: 300, top: 300, width: 100, height: 100 }, viewport: { width: 760, height: 760 } },
        onDeleteSelected: () => deleted.push(selected.value.authoringRef.editKey),
      }) });
      controls.mount(surface);
      try {
        for (const kind of kinds) {
          selected.value = { ...target, targetKind: kind, capabilities: ['translate', 'delete'], authoringRef: { slideKey: 'slide', editKey: kind } };
          await nextTick();
          const remove = surface.querySelector<HTMLButtonElement>('[data-property="delete"]');
          assert(!!remove && remove.textContent?.trim() === '' && !!remove.getAttribute('aria-label'), 'Missing accessible icon-only delete action');
          remove?.click();
        }
        assert(deleted.join(',') === kinds.join(','), 'Delete control duplicated or lost an author target');
        busy.value = true;
        await nextTick();
        surface.querySelector<HTMLButtonElement>('[data-property="delete"]')?.click();
        assert(deleted.length === kinds.length, 'Disabled delete action was submitted');
        selected.value = { ...target, capabilities: ['translate'] };
        await nextTick();
        assert(!surface.querySelector('[data-property="delete"]'), 'Delete action ignored compiler capability');
      } finally { controls.unmount(); surface.remove(); }
    },
    async openPalette() { await open('fill'); },
    controlPoint(selector: string) {
      const element = host.querySelector<HTMLElement>(selector);
      if (!element || getComputedStyle(element).visibility === 'hidden') throw new Error(`Missing visible color control ${selector}`);
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    },
    prepareInput(selector: string) {
      const element = host.querySelector(selector);
      assert(element instanceof HTMLInputElement && document.activeElement === element, 'Color input did not receive native focus');
      if (element instanceof HTMLInputElement) element.select();
    },
    assertSubmenu(open: boolean, focus?: 'palette' | 'submenu' | 'row') {
      const panel = host.querySelector<HTMLElement>('.slides-element-color__submenu');
      assert(Boolean(panel && !panel.inert) === open, 'Unexpected custom submenu visibility');
      assert(button('.slides-element-color__custom').getAttribute('aria-expanded') === String(open), 'Custom row expansion differs');
      if (focus === 'palette') assert(document.activeElement === host.querySelector('.slides-element-property-popover'), 'Hover stole palette focus');
      if (focus === 'submenu') assert(document.activeElement === panel, 'Keyboard opening did not focus the form');
      if (focus === 'row') assert(document.activeElement === button('.slides-element-color__custom'), 'Custom dismissal did not restore row focus');
      if (open && panel) {
        const bounds = host.getBoundingClientRect();
        const rect = panel.getBoundingClientRect();
        assert(rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom, 'Custom submenu escaped pane');
      }
    },
    assertColorDraft(color: string, valid: boolean) {
      const input = host.querySelector('.slides-element-color__hex input');
      assert(input instanceof HTMLInputElement && input.value.toUpperCase() === color, 'RGB/HSV/HEX drafts diverged');
      assert(button('.action-btn.primary').disabled === !valid, 'Invalid RGB draft can be applied');
      assert(operations.length === 0, 'Color draft was applied without confirmation');
    },
    assertCustomApplied(color: string) {
      const operation = operations[0];
      assert(operations.length === 1 && operation?.op === 'set_fill_color' && operation.color === color, 'Custom RGB did not submit exactly one color');
      assert(document.activeElement === button('[data-property="fill"]'), 'Apply did not restore toolbar focus');
    },
    async resetColorChecks() {
      queued.value = []; operations.length = 0;
      await nextTick();
    },
    async verifyColorsAndNumbers() {
      await nextTick();
      await open('fill');
      assert(button('[title="#2563EB"]').classList.contains('is-current'), 'Initial preset is not selected');
      await click('[title="#DC2626"]');
      await open('fill');
      assert(button('[title="#DC2626"]').classList.contains('is-current'), 'Pending preset is not selected');
      assert(getComputedStyle(button('[title="#DC2626"]')).backgroundColor === 'rgb(220, 38, 38)', 'Panel styles replaced the actual preset color');
      assert(button('.slides-element-color__custom').getAttribute('aria-pressed') === 'false', 'Preset also selected custom');
      await click('.slides-element-color__custom');
      await input('.slides-element-color__hex input', '#12');
      assert(button('.action-btn.primary').disabled, 'Invalid HEX can be submitted');
      await input('.slides-element-color__hex input', '123456');
      assert(operations.length === 1, 'Draft color submitted before Apply');
      await click('.action-btn.primary');
      await open('fill');
      assert(button('.slides-element-color__custom').getAttribute('aria-pressed') === 'true', 'Custom color is not selected');
      assert(!host.querySelector('.shared-color-picker-panel__cell.is-current'), 'Custom color retained a preset selection');
      await click('.slides-element-color__custom');
      await input('.slides-element-color__hex input', '#ABCDEF');
      await click('.action-btn.secondary');
      assert(operations.length === 2, 'Cancel submitted a color');
      await open('size');
      await input('input[type="number"]', '3');
      await open('fill');
      await click('[title="#16A34A"]');
      await open('size');
      const widthInput = host.querySelector('input[type="number"]');
      assert(widthInput instanceof HTMLInputElement && widthInput.value === '3', 'Color update reset the in-progress size');
      await input('input[type="number"]', '3', true);
      assert(properties.value.visualSize?.width === 3 && operations.length === 4, 'Number change did not submit directly');
      await open('fill');
      assert(button('[title="#16A34A"]').classList.contains('is-current'), 'Size edit lost color selection');
      queued.value = []; operations.length = 0;
      await nextTick();
      assert(button('[title="#2563EB"]').classList.contains('is-current'), 'Rollback did not restore preset');
      await click('[data-property="fill"]');
      return { colorAndNumberChecks: 13 };
    },
    point(handle: string) {
      const element = host.querySelector(`[data-resize-handle="${handle}"]`);
      if (!element) throw new Error('Resize handle missing');
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    },
    async assertResize(width: number, height: number, commits: number, dragging: boolean) {
      await nextTick();
      const node = stage.getLayers()[1]?.findOne<Konva.Rect>('Rect');
      assert(!!node && node.width() === width * 96 && node.height() === height * 96, 'Canvas resize differs from interaction');
      const text = stage.getLayers()[1]?.findOne<Konva.Text>('Text');
      const expected = preparePreviewFixture(resizeShapeTextInput(initialShape.innerText!, { ...initialShape.innerText!.box, w: width, h: height }), 'shape-inner-text');
      const line = expected.layout?.lines[0]?.slices[0];
      assert(!!text && !!line && line.kind !== 'inlineBox' && Math.abs(text.x() - (line.x + 0.1) * 96) < 0.01
        && Math.abs(text.y() - (line.textY + 0.05) * 96) < 0.01, 'Shape text did not follow live resize layout');
      assert(properties.value.visualSize?.width === width && properties.value.visualSize.height === height, 'Property resize differs from canvas');
      assert(operations.length === commits, 'Resize submitted an unexpected number of commands');
      assert(Boolean(transient.value) === dragging, 'Resize gesture preview did not settle');
      if (!dragging) assert(document.activeElement === host, 'Resize did not return keyboard focus to canvas');
    },
    assertResizePosition(x: number, y: number) {
      const node = stage.getLayers()[1]?.findOne<Konva.Rect>('Rect');
      const group = node?.getParent();
      assert(!!group && Math.abs(group.x() - x * 96) < 0.01 && Math.abs(group.y() - y * 96) < 0.01,
        'Canvas resize position differs from anchor');
      assert(Math.abs(presented.value.bounds.x - x) < 0.01 && Math.abs(presented.value.bounds.y - y) < 0.01,
        'Selection position differs from resized canvas');
      assert(host.querySelectorAll('[data-resize-handle]').length === 8, 'Expected all eight resize handles');
    },
    async verifyPreparedTextReflow() {
      const shape = slide.elements[0];
      if (shape.kind !== 'shape' || !shape.innerText) throw new Error('Missing shape text');
      const original = shape.innerText;
      const originalQueue = queued.value;
      const text = { ...original, autoFitPolicy: 'shrink-text' as const, wrap: 'word' as const,
        paragraphs: [{ align: 'center' as const, runs: [{ text: 'AVAV text wraps during resizing', fontSize: 24 }] }] };
      const prepared = prepareTextLayout(text, 'generated', 'Arial', {
        getClusterAdvances: (clusters, style) => ({ advances: clusters.map(() => style.fontSizePt / 144), source: 'harfbuzz' }),
      }, { getMetrics: style => ({ ascent: style.fontSizePt / 90, descent: style.fontSizePt / 360, lineGap: 0 }) });
      shape.innerText = { ...text, preparedTextLayout: prepared, layout: layoutPreparedText(text, prepared) };
      const scales = new Set<number>();
      try {
        for (const [width, height] of [[0.6, 0.3], [3, 2]]) {
          const operation: ManualEditingVisualOperation = { op: 'set_visual_size', target: target.authoringRef,
            targetKind: 'shape', visualSize: { width, height } };
          const preview = createManualVisualPreview(target, operation);
          if (!preview) throw new Error('Missing text resize preview');
          queued.value = [preview];
          await nextTick();
          const expected = layoutPreparedText(resizeShapeTextInput(shape.innerText, { ...shape.innerText.box, w: width, h: height }), prepared);
          if (!expected) throw new Error('Missing text resize layout');
          const painted = stage.getLayers()[1]?.find<Konva.Text>('Text') ?? [];
          assert(painted.length > 0 && painted.every(slice => Math.abs(slice.fontSize() - 24 * expected.appliedFontScale * 96 / 72) < 0.01),
            'Canvas text font did not update with the resized shape');
          scales.add(expected.appliedFontScale);
        }
        assert(scales.size === 2, 'Resize did not exercise a font scale change');
      } finally {
        shape.innerText = original;
        queued.value = originalQueue;
        await nextTick();
      }
    },
    async showCustom(theme: string) {
      document.documentElement.setAttribute('data-linnya-ui-theme', theme);
      submit({ op: 'set_fill_color', target: target.authoringRef, targetKind: 'shape', color: '#426A91' });
      await nextTick();
      await open('fill');
      if (!host.querySelector('.slides-element-color__editor')) await click('.slides-element-color__custom');
    },
    async showMode(mode: 'hsv' | 'rgb') {
      const tab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(item => item.textContent?.trim() === mode.toUpperCase());
      if (!tab) throw new Error('Missing color mode');
      tab.click();
      await nextTick();
    },
    async prepareSliderKeyboard() {
      await input('.slides-element-color__hex input', '#FF0000');
      const slider = host.querySelector('input[type="range"]');
      if (!(slider instanceof HTMLInputElement)) throw new Error('Hue slider missing');
      slider.focus();
    },
    async assertSliderKeyboard(hue: number) {
      await nextTick();
      const slider = host.querySelector('input[type="range"]');
      assert(slider instanceof HTMLInputElement && slider.valueAsNumber === hue, 'Native slider keyboard value differs');
      const hex = host.querySelector('.slides-element-color__hex input');
      assert(hex instanceof HTMLInputElement && hex.value !== '#426A91', 'Slider did not update the color draft');
      assert(properties.value.fill?.kind === 'solid' && properties.value.fill.color === '#426A91', 'Slider draft unexpectedly submitted');
    },
    async disableSlider() { disabled.value = true; await nextTick(); },
    dispose() { app.unmount(); host.remove(); },
  };
}
