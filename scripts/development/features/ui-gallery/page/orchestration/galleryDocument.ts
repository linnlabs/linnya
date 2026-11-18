import { RENDERER_UI_THEME_ATTRIBUTE, type RendererUiTheme } from '@linnya/renderer-ui/theme';

const SCHEME_STYLE_ID = 'linnya-ui-gallery-scheme';

/** 与 Desktop 一样把主题写在根元素上。 */
export function applyGalleryTheme(theme: RendererUiTheme): void {
  document.documentElement.setAttribute(RENDERER_UI_THEME_ATTRIBUTE, theme);
}

/**
 * 候选方案的覆盖样式必须排在所有样式之后：Vite 开发模式会在模块加载时继续往 head 里追加 style，
 * 所以每当 head 多出样式节点就把方案样式移回末尾，同优先级的选择器也总是方案生效。
 */
export function installGallerySchemeStyle(): (css: string) => void {
  const style = document.createElement('style');
  style.id = SCHEME_STYLE_ID;
  document.head.append(style);
  const keepLast = new MutationObserver(() => {
    if (document.head.lastElementChild !== style) document.head.append(style);
  });
  keepLast.observe(document.head, { childList: true });
  return css => {
    style.textContent = css;
  };
}

/** 被对比视图嵌入时，把内容高度告诉父页面，iframe 随内容伸缩而不出现内部滚动条。 */
export const GALLERY_EMBED_HEIGHT_MESSAGE = 'linnya-ui-gallery:height';

export interface GalleryEmbedHeightMessage {
  readonly type: typeof GALLERY_EMBED_HEIGHT_MESSAGE;
  readonly height: number;
}

export function isGalleryEmbedHeightMessage(value: unknown): value is GalleryEmbedHeightMessage {
  if (typeof value !== 'object' || value === null) return false;
  if (!('type' in value) || !('height' in value)) return false;
  return value.type === GALLERY_EMBED_HEIGHT_MESSAGE && typeof value.height === 'number';
}

export function reportEmbedHeight(root: HTMLElement): () => void {
  const report = () => {
    const message: GalleryEmbedHeightMessage = {
      type: GALLERY_EMBED_HEIGHT_MESSAGE,
      height: Math.ceil(root.getBoundingClientRect().height),
    };
    window.parent.postMessage(message, window.location.origin);
  };
  const observer = new ResizeObserver(report);
  observer.observe(root);
  report();
  return () => observer.disconnect();
}
