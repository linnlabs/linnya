/**
 * Renderer document 中跨 owner 浮层的稳定层级。
 *
 * 数值保持迁移前结果；同值表示现有 DOM 顺序仍参与同层排序，不代表引入了弹层栈。
 */
export const RENDERER_UI_OVERLAY_LAYER_VALUES = {
  inlineMenu: 100,
  picker: 120,
  popover: 1000,
  status: 1000,
  floatingPanel: 1001,
  modal: 2000,
  alert: 2100,
  portalMenu: 2100,
  imagePreview: 3000,
  tooltip: 4000,
} as const;

export type RendererUiOverlayLayer = keyof typeof RENDERER_UI_OVERLAY_LAYER_VALUES;

export const RENDERER_UI_OVERLAY_LAYER_TOKENS = {
  inlineMenu: '--linnya-ui-layer-inline-menu',
  picker: '--linnya-ui-layer-picker',
  popover: '--linnya-ui-layer-popover',
  status: '--linnya-ui-layer-status',
  floatingPanel: '--linnya-ui-layer-floating-panel',
  modal: '--linnya-ui-layer-modal',
  alert: '--linnya-ui-layer-alert',
  portalMenu: '--linnya-ui-layer-portal-menu',
  imagePreview: '--linnya-ui-layer-image-preview',
  tooltip: '--linnya-ui-layer-tooltip',
} as const satisfies Readonly<Record<RendererUiOverlayLayer, `--${string}`>>;

export function rendererUiOverlayLayer(layer: RendererUiOverlayLayer): string {
  return `var(${RENDERER_UI_OVERLAY_LAYER_TOKENS[layer]})`;
}
