// apps/renderer/features/ImageBlock/menu/imageBlockMenuProvider.ts
/**
 * ImageBlock 专属菜单 Provider
 * 
 * 提供图片块专属操作：
 * - 显示属性信息（格式、大小、上传时间）
 */

import type { BlockMenuProvider, BlockMenuContext } from '../../../features/blockActionMenu/types';
import { useLocalizationStore } from '../../../../../app/localization';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';
import {
  formatImageDateTime,
  formatImageFileSize,
  getImageDimensions,
  getImageFormat,
} from '../functions/imageBlockPresentation';

/**
 * 估算 data URL 的大小（字节）
 */
const estimateDataUrlSize = (dataUrl: string): number => {
  if (!dataUrl.startsWith('data:')) return -1;
  
  // data URL 格式: data:image/png;base64,iVBORw0KG...
  const base64Index = dataUrl.indexOf('base64,');
  if (base64Index === -1) return -1;
  
  const base64Data = dataUrl.substring(base64Index + 7);
  // Base64 编码大约比原始数据大 33%
  return Math.round(base64Data.length * 0.75);
};

/**
 * 获取图片文件大小
 */
const getImageFileSize = async (src: string): Promise<number> => {
  try {
    // 如果是 data URL，估算大小
    if (src.startsWith('data:')) {
      return estimateDataUrlSize(src);
    }
    
    // blob/media URL 都是资源 URL，不是可交给文件 IPC 的本地路径。
    if (src.startsWith('blob:') || src.startsWith('media:')) {
      return -1;
    }
    
    // 如果是文件路径，调用 electron API
    if (window.electronAPI && window.electronAPI.getFileSize) {
      const result = await window.electronAPI.getFileSize(src);
      return result.success ? result.size : -1;
    }
    
    return -1;
  } catch (error) {
    console.error('[ImageBlockMenu] 获取文件大小失败:', error);
    return -1;
  }
};

/**
 * ImageBlock 菜单 Provider
 */
export const imageBlockMenuProvider: BlockMenuProvider = {
  name: 'image-block-actions',
  weight: 110, // 在通用项之后显示
  
  getItems: async (ctx) => {
    const imageBlockNode = ctx.contentBlockNode;
    if (!imageBlockNode) {
      return [];
    }
    
    const editorMessage = resolveCurrentEditorMessage;
    const locale = useLocalizationStore().currentLocale;

    // 构建属性面板内容
    const propertiesPanelItems = [];
    
    // 上传于
    propertiesPanelItems.push({
      label: editorMessage('editor.imageBlock.property.uploadedAt'),
      value: formatImageDateTime(imageBlockNode.attrs.uploadedAt, editorMessage, locale),
    });
    
    // 格式
    propertiesPanelItems.push({
      label: editorMessage('editor.imageBlock.property.format'),
      value: getImageFormat(imageBlockNode.attrs.src, editorMessage),
    });
    
    // 尺寸
    propertiesPanelItems.push({
      label: editorMessage('editor.imageBlock.property.dimensions'),
      value: getImageDimensions(imageBlockNode.attrs.width, imageBlockNode.attrs.height, editorMessage),
    });
    
    // 大小
    const fileSize = await getImageFileSize(imageBlockNode.attrs.src);
    propertiesPanelItems.push({
      label: editorMessage('editor.imageBlock.property.size'),
      value: formatImageFileSize(fileSize, editorMessage),
    });
    
    return [
      {
        id: 'separator-image-1',
        type: 'separator',
        label: '',
      },
      {
        id: 'show-properties',
        label: editorMessage('editor.imageBlock.property.panelTitle'),
        isPanel: true,
        children: propertiesPanelItems,
      },
    ];
  },
};
