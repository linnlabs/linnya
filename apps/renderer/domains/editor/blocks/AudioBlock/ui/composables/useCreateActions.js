/**
 * @file useCreateActions.js
 * @brief 创建内容动作（纪要等）
 * 
 * @description
 * 负责从音频转录生成各种内容的逻辑
 */

import { useNotificationStore } from '@/app/notification';
import { useAudioContentStore, useAudioRuntimeStore } from '../../store/index.js';
import { proseMirrorDocToSegments } from '../content-panel/transcriptDataConverter.js';
import { useTranscriptionRequest } from './useTranscriptionRequest.js';
import { resolveCurrentEditorMessage } from '../../../../functions/resolveCurrentEditorMessage';

/**
 * 从不同格式的转录内容中提取纯文本。
 * @param {object | null} transcriptContent - 可能是原始转录对象或 ProseMirror 文档。
 * @returns {string} 提取的纯文本。
 */
const getTranscriptText = (transcriptContent) => {
  if (!transcriptContent) {
    return '';
  }

  // 检查是否为原始转录格式（包含 text 属性）
  if (typeof transcriptContent.text === 'string') {
    return transcriptContent.text.trim();
  }

  // 检查是否为 ProseMirror 文档格式
  if (transcriptContent.type === 'transcriptDocument' && Array.isArray(transcriptContent.content)) {
    let extractedText = '';
    
    transcriptContent.content.forEach(segmentNode => {
      if (segmentNode.type === 'transcriptSegment' && Array.isArray(segmentNode.content)) {
        const textNode = segmentNode.content.find(node => node.type === 'transcriptText');
        
        if (textNode && Array.isArray(textNode.content)) {
          textNode.content.forEach(inlineNode => {
            if (inlineNode.type === 'text' && typeof inlineNode.text === 'string') {
              extractedText += inlineNode.text;
            }
          });
          // 在每个 segment 后面加一个换行，保持段落结构
          extractedText += '\n';
        }
      }
    });
    
    return extractedText.trim();
  }

  return '';
};


export function useCreateActions(props) {
  const notificationStore = useNotificationStore();
  const contentStore = useAudioContentStore();
  const runtimeStore = useAudioRuntimeStore();
  const { requestTranscription } = useTranscriptionRequest(props);

  /**
   * 生成纪要的核心逻辑
   */
  const generateSummaryFromTranscript = async (transcriptContent) => {
    console.log('📋 [AudioPlayer] 开始生成纪要');
    notificationStore.show(resolveCurrentEditorMessage('editor.audioBlock.toast.generatingSummary'), 'info');
    
    // 动态导入服务
    const { generateAudioSummary } = await import('../../services/audioContentAiService.js');
    
    // 获取用户笔记内容
    const content = contentStore.getContent(props.blockId);
    const userNotes = content.notesContent || null;
    
    let summaryContent = '';
    
    // 为 AI 服务准备数据
    let transcriptPayload;
    if (transcriptContent && transcriptContent.type === 'transcriptDocument') {
      // 如果是 ProseMirror 文档，则进行转换
      transcriptPayload = {
        text: getTranscriptText(transcriptContent),
        segments: proseMirrorDocToSegments(transcriptContent),
      };
    } else {
      // 否则，假定为原始格式
      transcriptPayload = transcriptContent;
    }
    
    await generateAudioSummary(
      transcriptPayload,
      {
        onTextChunk: (chunk) => {
          summaryContent += chunk;
        },
        onStreamEnd: () => {
          console.log('✅ [AudioPlayer] 纪要生成完成');
          
          // 保存到 Store
          contentStore.setSummaryContentDraft(props.blockId, summaryContent);
          // 自动显示面板并切换到纪要 tab
          runtimeStore.updateRuntime(props.blockId, {
            isPanelVisible: true,
            activeTab: 'summary'
          });
          
          notificationStore.show(resolveCurrentEditorMessage('editor.audioBlock.toast.summaryCompleted'), 'success', 2000);
        },
        onError: (error) => {
          console.error('❌ [AudioPlayer] 纪要生成失败:', error);
          notificationStore.show(
            resolveCurrentEditorMessage('editor.audioBlock.toast.generateFailed'),
            'error',
            3000
          );
        }
      },
      null, // signal
      userNotes // 传递用户笔记
    );
  };

  /**
   * 处理创建动作
   */
  const handleCreateAction = async (actionId) => {
    console.log('[AudioPlayer] 创建动作:', actionId);
    
    // 总是获取最新的状态
    const content = contentStore.getContent(props.blockId);
    const runtime = runtimeStore.getRuntime(props.blockId);
    
    try {
      if (actionId === 'summary') {
        const transcriptText = getTranscriptText(content.transcriptContent);
        
        if (transcriptText) {
          // 情况1: 已有转录内容，直接生成纪要
          await generateSummaryFromTranscript(content.transcriptContent);
        } else {
          // 情况2: 没有转录内容，先转录再生成纪要
          notificationStore.show(resolveCurrentEditorMessage('editor.audioBlock.status.transcribingAudio'), 'info');
          
          const transcriptionResult = await requestTranscription({ notify: true });
          if (transcriptionResult?.transcriptDoc) {
            await generateSummaryFromTranscript(transcriptionResult.transcriptDoc);
          } else {
            throw new Error(
              transcriptionResult?.error || resolveCurrentEditorMessage('editor.audioBlock.error.transcriptionNoContent')
            );
          }
        }
      }
    } catch (error) {
      console.error('❌ [AudioPlayer] 创建内容失败:', error);
      notificationStore.show(
        resolveCurrentEditorMessage('editor.audioBlock.toast.operationFailed'),
        'error',
        3000
      );
    }
  };

  return {
    handleCreateAction,
    generateSummaryFromTranscript,
  };
}
