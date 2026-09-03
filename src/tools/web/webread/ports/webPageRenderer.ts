import {
  WebPageRenderError,
  type WebPageRenderer,
} from '../definitions/webPageRenderer';

const unavailableRenderer: WebPageRenderer = {
  async render(): Promise<never> {
    throw new WebPageRenderError('unavailable', '本地 Chromium 网页渲染器尚未安装。');
  },
};

let activeRenderer: WebPageRenderer = unavailableRenderer;

export function getWebPageRenderer(): WebPageRenderer {
  return activeRenderer;
}

/** App Server composition 注入 Desktop RPC adapter，Web domain 自身不依赖 Electron。 */
export function installWebPageRenderer(renderer: WebPageRenderer): () => void {
  activeRenderer = renderer;
  return () => {
    if (activeRenderer === renderer) activeRenderer = unavailableRenderer;
  };
}
