// apps/renderer/features/AudioBlock/menu/audioBlockMenuProvider.ts
/**
 * AudioBlock 专属菜单 Provider
 * 
 * 提供音频块专属操作：
 * - 开始/停止转录
 * - 生成摘要
 * - 翻译
 * - 显示属性信息
 */

import type { BlockMenuProvider, BlockMenuContext } from '../../../features/blockActionMenu/types';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';
import {
  formatAudioBlockDateTime,
  formatAudioBlockFileSize,
} from '../functions/audioBlockPresentation';
import { useAudioContentStore, useAudioRuntimeStore } from '../store';

/**
 * 开始转录
 */
const startTranscription = async (ctx: BlockMenuContext) => {
  try {
    const audioBlockNode = ctx.contentBlockNode;
    if (!audioBlockNode) {
      console.warn('[AudioBlockMenu] 无法获取音频块节点');
      return;
    }
    
    const audioBlockId = audioBlockNode.attrs.id;
    const contentStore = useAudioContentStore();
    const runtimeStore = useAudioRuntimeStore();
    
    // 触发转录请求（需要从节点获取音频信息）
    runtimeStore.updateRuntime(audioBlockId, { transcriptionState: 'loading' });
    // 注意：这里需要实际的音频文件路径或 blob，暂时只更新状态
    // 完整的转录逻辑应该在 AudioBlockView 中处理
    console.log('[AudioBlockMenu] 转录请求已发送（需要在 AudioBlockView 中实现完整逻辑）');
  } catch (error) {
    console.error('[AudioBlockMenu] 开始转录失败:', error);
  }
};

/**
 * 格式化文件大小
 */
const formatFileSize = (bytes: number): string => {
  return formatAudioBlockFileSize(bytes, resolveCurrentEditorMessage);
};

/**
 * 格式化日期时间
 */
const formatDateTime = (timestamp: number | null): string => {
  return formatAudioBlockDateTime(timestamp, resolveCurrentEditorMessage);
};

/**
 * 格式化音频格式（只显示格式名称，不含编解码器信息）
 */
const formatAudioFormat = (mimeType: string | null): string => {
  if (!mimeType) return resolveCurrentEditorMessage('editor.audioBlock.menu.unknown');
  
  // 移除可能的编解码器信息（如 "audio/webm;codecs=opus" -> "audio/webm"）
  const cleanMimeType = mimeType.split(';')[0].trim();
  
  const formatMap: Record<string, string> = {
    'audio/webm': 'WebM',
    'audio/wav': 'WAV',
    'audio/mp3': 'MP3',
    'audio/mpeg': 'MP3',
    'audio/ogg': 'OGG',
    'audio/aac': 'AAC',
    'audio/flac': 'FLAC',
  };
  
  return formatMap[cleanMimeType] || cleanMimeType.replace('audio/', '').toUpperCase();
};

/**
 * 获取音频文件大小
 */
const getAudioFileSize = async (filePath: string): Promise<number> => {
  try {
    if (!filePath || filePath.startsWith('blob:') || filePath.startsWith('media:')) {
      return -1;
    }
    
    // 调用 electron API 获取文件大小
    if (window.electronAPI && window.electronAPI.getFileSize) {
      const result = await window.electronAPI.getFileSize(filePath);
      // size 可能为 undefined，这里做安全转换
      const size = result.success && typeof result.size === 'number' ? result.size : -1;
      return size;
    }
    
    return -1;
  } catch (error) {
    console.error('[AudioBlockMenu] 获取文件大小失败:', error);
    return -1;
  }
};

/**
 * 打开文件所在位置
 */
const openFileLocation = async (filePath: string) => {
  try {
    if (!filePath || filePath.startsWith('blob:') || filePath.startsWith('media:')) {
      console.warn('[AudioBlockMenu] 无效的文件路径');
      return;
    }
    
    // 调用 electron API 打开文件所在位置
    if (window.electronAPI && window.electronAPI.showItemInFolder) {
      await window.electronAPI.showItemInFolder(filePath);
    } else {
      console.warn('[AudioBlockMenu] showItemInFolder API 不可用');
    }
  } catch (error) {
    console.error('[AudioBlockMenu] 打开文件位置失败:', error);
  }
};

/**
 * AudioBlock 菜单 Provider
 */
export const audioBlockMenuProvider: BlockMenuProvider = {
  name: 'audio-block-actions',
  weight: 110, // 在通用项之后显示
  
  getItems: async (ctx) => {
    const audioBlockNode = ctx.contentBlockNode;
    if (!audioBlockNode) {
      return [];
    }
    
    const audioBlockId = audioBlockNode.attrs.id;
    const contentStore = useAudioContentStore();
    const runtimeStore = useAudioRuntimeStore();
    const runtime = runtimeStore.getRuntime(audioBlockId);
    const content = contentStore.getContent(audioBlockId);
    
    // 根据状态决定哪些菜单项可用
    const hasAudio = runtime.isFinalized && runtime.src;
    const hasTranscript = !!content.transcriptContent;
    
    // 构建属性面板内容
    const propertiesPanelItems = [];
    
    // 创建于
    propertiesPanelItems.push({
      label: resolveCurrentEditorMessage('editor.audioBlock.menu.createdAt'),
      value: formatDateTime(audioBlockNode.attrs.recordedAt),
    });
    
    // 大小
    const src: string | null | undefined = runtime.src as any;
    if (typeof src === 'string' && !src.startsWith('blob:') && !src.startsWith('media:')) {
      const fileSize = await getAudioFileSize(src);
      propertiesPanelItems.push({
        label: resolveCurrentEditorMessage('editor.audioBlock.menu.size'),
        value: formatFileSize(fileSize),
      });
    } else {
      propertiesPanelItems.push({
        label: resolveCurrentEditorMessage('editor.audioBlock.menu.size'),
        value: resolveCurrentEditorMessage('editor.audioBlock.menu.unsaved'),
      });
    }
    
    // 格式
    propertiesPanelItems.push({
      label: resolveCurrentEditorMessage('editor.audioBlock.menu.format'),
      value: formatAudioFormat(audioBlockNode.attrs.mimeType),
    });
    
    // 存储位置
    if (typeof src === 'string' && !src.startsWith('blob:') && !src.startsWith('media:')) {
      propertiesPanelItems.push({
        label: resolveCurrentEditorMessage('editor.audioBlock.menu.storageLocation'),
        value: src,
        clickable: true,
        title: resolveCurrentEditorMessage('editor.audioBlock.menu.openLocation'),
        onClick: () => openFileLocation(src),
      });
    } else {
      propertiesPanelItems.push({
        label: resolveCurrentEditorMessage('editor.audioBlock.menu.storageLocation'),
        value: resolveCurrentEditorMessage('editor.audioBlock.menu.temporaryFile'),
      });
    }
    
    return [
      {
        id: 'separator-audio-1',
        type: 'separator',
        label: '',
      },
      {
        id: 'transcribe',
        label: hasTranscript
          ? resolveCurrentEditorMessage('editor.audioBlock.menu.retranscribe')
          : resolveCurrentEditorMessage('editor.audioBlock.menu.startTranscription'),
        disabled: !hasAudio,
        action: startTranscription,
      },
      {
        id: 'separator-audio-2',
        type: 'separator',
        label: '',
      },
      {
        id: 'show-properties',
        label: resolveCurrentEditorMessage('editor.audioBlock.menu.properties'),
        isPanel: true,
        children: propertiesPanelItems,
      },
    ];
  },
};
