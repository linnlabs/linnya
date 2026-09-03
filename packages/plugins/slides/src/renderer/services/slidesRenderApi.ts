/**
 * Slides Render API 服务
 *
 * 获取渲染模型的统一入口。
 * M6 后 render-model IPC 是唯一主链；DeckPreview 只服务 outline/page context，
 * 不再桥接成渲染模型，避免前端重新长出第二套布局规则。
 */

import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { SLIDES_IPC, SLIDES_PLUGIN_ID } from '@plugin/slides/shared/ipc';
import type { PresentationRenderModel } from '../types/render';

export const slidesRenderApi = {
  /**
   * 获取指定 deck 的渲染模型
   */
  async getRenderModel(nodeId: string): Promise<PresentationRenderModel> {
    const result = await invokeRendererPluginIpc<PresentationRenderModel>(
      SLIDES_PLUGIN_ID,
      SLIDES_IPC.renderModel,
      { nodeId },
    );

    if (result.success) {
      if (!result.data) {
        throw new Error('[SlidesRenderApi] render-model IPC 返回空数据');
      }
      return result.data;
    }

    throw new Error(result.error);
  },
};
