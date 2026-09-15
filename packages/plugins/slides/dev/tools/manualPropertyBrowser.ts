import { computed, createApp, h, nextTick, shallowRef } from 'vue';
import VueKonva from 'vue-konva';
import Konva from 'konva';
import ElementPropertyPanel from '../../src/renderer/features/elementProperties/ui/ElementPropertyPanel.vue';
import ManualResizeHandles from '../../src/renderer/features/manualEditing/ui/ManualResizeHandles.vue';
import KonvaSlideStage from '../../src/renderer/ui/preview/konva/KonvaSlideStage.vue';
import { projectElementPropertyTarget } from '../../src/renderer/features/elementProperties/functions/projectElementPropertyTarget';
import { createManualVisualPreview, projectManualEditableTargetSelection } from '../../src/renderer/features/manualEditing/functions/manualVisualPreview';
import type { ManualEditableTarget, ManualEditingVisualOperation, ManualEditingVisualPreview } from '../../src/renderer/features/manualEditing/definitions/manualEditingTypes';
import type { SlideRenderModel } from '../../src/renderer/types/render';
import '@linnya/renderer-ui/tokens.css';
import '@linnya/renderer-ui/styles.css';
import '../../src/renderer/features/elementProperties/ui/ElementPropertyPanel.css';
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
      geometry: { type: 'preset', name: 'rect' }, fill: { type: 'solid', color: '#2563EB' } }],
  };
  const queued = shallowRef<readonly ManualEditingVisualPreview[]>([]);
  const transient = shallowRef<ManualEditingVisualPreview | null>(null);
  const previews = computed(() => [...queued.value, ...(transient.value ? [transient.value] : [])]);
  const presented = computed(() => projectManualEditableTargetSelection(target, new Map(), previews.value));
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
    h(ElementPropertyPanel, { target: properties.value, slideLeft: 48, slideTop: 48, scaledSlideWidth: 640, onSubmit: submit }),
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
    async verifyColorsAndNumbers() {
      await nextTick();
      assert(button('[title="#2563EB"]').classList.contains('is-current'), 'Initial preset is not selected');
      await click('[title="#DC2626"]');
      assert(button('[title="#DC2626"]').classList.contains('is-current'), 'Pending preset is not selected');
      assert(getComputedStyle(button('[title="#DC2626"]')).backgroundColor === 'rgb(220, 38, 38)', 'Panel styles replaced the actual preset color');
      assert(!button('.slides-element-color__custom').classList.contains('is-current'), 'Preset also selected custom');
      await click('.slides-element-color__custom');
      await input('.slides-element-color__hex input', '#12');
      assert(button('.action-btn.primary').disabled, 'Invalid HEX can be submitted');
      await input('.slides-element-color__hex input', '123456');
      assert(operations.length === 1, 'Draft color submitted before Apply');
      await click('.action-btn.primary');
      assert(button('.slides-element-color__custom').getAttribute('aria-pressed') === 'true', 'Custom color is not selected');
      assert(!host.querySelector('.shared-color-picker-panel__cell.is-current'), 'Custom color retained a preset selection');
      await click('.slides-element-color__custom');
      await input('.slides-element-color__hex input', '#ABCDEF');
      await click('.action-btn.secondary');
      assert(operations.length === 2, 'Cancel submitted a color');
      await input('input[type="number"]', '3');
      await click('[title="#16A34A"]');
      const widthInput = host.querySelector('input[type="number"]');
      assert(widthInput instanceof HTMLInputElement && widthInput.value === '3', 'Color update reset the in-progress size');
      await input('input[type="number"]', '3', true);
      assert(properties.value.visualSize?.width === 3 && operations.length === 4, 'Number change did not submit directly');
      assert(button('[title="#16A34A"]').classList.contains('is-current'), 'Size edit lost color selection');
      queued.value = []; operations.length = 0;
      await nextTick();
      assert(button('[title="#2563EB"]').classList.contains('is-current'), 'Rollback did not restore preset');
      return { colorAndNumberChecks: 13 };
    },
    point(handle: string) {
      const handles = host.querySelectorAll('.slides-manual-resize-handle');
      const element = handles[handle === 'right' ? 0 : handle === 'bottom' ? 1 : 2];
      if (!element) throw new Error('Resize handle missing');
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    },
    async assertResize(width: number, height: number, commits: number, dragging: boolean) {
      await nextTick();
      const node = stage.getLayers()[1]?.findOne<Konva.Rect>('Rect');
      assert(!!node && node.width() === width * 96 && node.height() === height * 96, 'Canvas resize differs from interaction');
      assert(properties.value.visualSize?.width === width && properties.value.visualSize.height === height, 'Property resize differs from canvas');
      assert(operations.length === commits, 'Resize submitted an unexpected number of commands');
      assert(Boolean(transient.value) === dragging, 'Resize gesture preview did not settle');
      if (!dragging) assert(document.activeElement === host, 'Resize did not return keyboard focus to canvas');
    },
    async showCustom(theme: string) {
      document.documentElement.setAttribute('data-linnya-ui-theme', theme);
      submit({ op: 'set_fill_color', target: target.authoringRef, targetKind: 'shape', color: '#426A91' });
      await nextTick();
      if (!host.querySelector('.slides-element-color__editor')) await click('.slides-element-color__custom');
    },
    dispose() { app.unmount(); host.remove(); },
  };
}
