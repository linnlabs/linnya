import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RENDERER_UI_OVERLAY_LAYER_TOKENS,
  RENDERER_UI_OVERLAY_LAYER_VALUES,
  rendererUiOverlayLayer,
} from '../src';
import type { RendererUiOverlayLayer } from '../src';

const overlayLayerNames: readonly RendererUiOverlayLayer[] = [
  'inlineMenu',
  'picker',
  'popover',
  'status',
  'floatingPanel',
  'modal',
  'alert',
  'portalMenu',
  'imagePreview',
  'tooltip',
];

const layerCss = readFileSync(
  new URL('../src/styles/tokens/layers.css', import.meta.url),
  'utf8',
);

describe('Renderer UI overlay layer contract', () => {
  it('JS 定位与 CSS 组件共享同一组命名层级值', () => {
    for (const layer of overlayLayerNames) {
      const token = RENDERER_UI_OVERLAY_LAYER_TOKENS[layer];
      const value = RENDERER_UI_OVERLAY_LAYER_VALUES[layer];
      expect(layerCss).toContain(`${token}: ${value};`);
      expect(rendererUiOverlayLayer(layer)).toBe(`var(${token})`);
    }
  });

  it('保留迁移前的跨层前后关系与 Alert/Portal 菜单同层语义', () => {
    expect(RENDERER_UI_OVERLAY_LAYER_VALUES.inlineMenu)
      .toBeLessThan(RENDERER_UI_OVERLAY_LAYER_VALUES.popover);
    expect(RENDERER_UI_OVERLAY_LAYER_VALUES.popover)
      .toBeLessThan(RENDERER_UI_OVERLAY_LAYER_VALUES.modal);
    expect(RENDERER_UI_OVERLAY_LAYER_VALUES.status)
      .toBe(RENDERER_UI_OVERLAY_LAYER_VALUES.popover);
    expect(RENDERER_UI_OVERLAY_LAYER_VALUES.modal)
      .toBeLessThan(RENDERER_UI_OVERLAY_LAYER_VALUES.alert);
    expect(RENDERER_UI_OVERLAY_LAYER_VALUES.alert)
      .toBe(RENDERER_UI_OVERLAY_LAYER_VALUES.portalMenu);
    expect(RENDERER_UI_OVERLAY_LAYER_VALUES.alert)
      .toBeLessThan(RENDERER_UI_OVERLAY_LAYER_VALUES.imagePreview);
    expect(RENDERER_UI_OVERLAY_LAYER_VALUES.imagePreview)
      .toBeLessThan(RENDERER_UI_OVERLAY_LAYER_VALUES.tooltip);
  });
});
