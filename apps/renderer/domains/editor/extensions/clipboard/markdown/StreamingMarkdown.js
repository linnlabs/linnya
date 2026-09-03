/**
 * @file StreamingMarkdown.js
 * @description Tiptap 扩展，提供启动/停止 AI 流处理以及管理流状态的命令。
 *              它充当类似 EditorContent.vue 等组件与 SSE 流服务交互的接口。
 *
 * AI 服务调用说明 (已废弃 - 现由外部组件处理):
 * - 旧命令使用的服务函数: startSseStreaming, stopSseStreaming (已废弃)
 * - 新的处理方式: 外部组件 (如 EditorContent.vue) 直接使用 generateTextStream
 * - 后端 API 端点: POST /api/v1/generate/stream
 * - 请求体 (Payload): { prompt, prompt_key, context_before, context_after, model_id }
 * - 响应处理: 此扩展现在只负责内容显示，流处理由外部组件通过统一API处理。
 * - 关联的 Prompt Key: 根据调用上下文而变化 (例如，当被 EditorContent.vue 使用时为 DEFAULT_PROMPT_KEY)。
 */
// src/renderer/shared/extensions/markdown/StreamingMarkdown.js
/**
 * 极简的StreamingMarkdown扩展
 * 只负责显示内容，没有任何额外处理
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

// 导入极简处理器
import { processQueue } from './streaming/queueProcessor';
// 导入统一的API服务
import { generateTextStream } from '../../../../../shared/services/aiService/unifiedApiService';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';

// 创建插件键
export const STREAMING_PLUGIN_KEY = new PluginKey('streamingMarkdown');

// 定义扩展
export const StreamingMarkdown = Extension.create({
  name: 'streamingMarkdown',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: STREAMING_PLUGIN_KEY,
        state: {
          init() {
            // 扩展状态
            return {
              isActiveStream: false,
              streamingError: null,
              currentInsertPos: null,      // 下一个内容块的插入位置
              initialBlockContext: null, // 初始触发点上下文
              hasProcessedFirstEventYet: false // 是否已处理当前流的第一个事件
            };
          },
          apply(tr, value) {
            // 更新状态
            const meta = tr.getMeta(STREAMING_PLUGIN_KEY);
            if (meta) {
              // 如果 meta 中显式提供了 currentInsertPos，则使用它
              // 否则，保留现有的 currentInsertPos (如果存在)
              // 这允许其他地方在不干扰 currentInsertPos 的情况下更新其他状态字段
              const newCurrentInsertPos = meta.hasOwnProperty('currentInsertPos') ? meta.currentInsertPos : value.currentInsertPos;
              return { 
                ...value, 
                ...meta,
                currentInsertPos: newCurrentInsertPos 
              };
            }
            return value;
          }
        }
      }),
      // createInlineMarkdownPlugin()
    ];
  },

  addCommands() {
    return {
      // 启动流 - 使用统一API
      startAiStream: (requestPayload) => ({ editor }) => {
        // 注意：这个命令现在主要由外部（如EditorContent.vue）处理
        // 这里保留接口兼容性，但实际逻辑已迁移到调用方
        console.warn('[StreamingMarkdown] startAiStream 命令已弃用，请使用外部的统一API调用');
        return true;
      },

      // 停止流 - 使用统一API
      stopAiStream: () => () => {
        // 注意：这个命令现在主要由外部处理
        console.warn('[StreamingMarkdown] stopAiStream 命令已弃用，请使用外部的取消机制');
        return true;
      },

      // 设置流状态
      setStreamingState: (stateUpdate) => ({ editor }) => {
        const currentState = STREAMING_PLUGIN_KEY.getState(editor.state);
        if (!currentState) return false;
        
        const tr = editor.state.tr.setMeta(STREAMING_PLUGIN_KEY, { 
          ...currentState, 
          ...stateUpdate 
        });
        editor.view.dispatch(tr);
        return true;
      },

      // 处理块 - 极简版本，直接传递给processQueue
      processMarkdownSseChunk: (textChunk) => ({ editor }) => {
        const pluginState = STREAMING_PLUGIN_KEY.getState(editor.state);
        if (!pluginState) return false;
        
        processQueue(editor, pluginState, textChunk);
        return true;
      },

      // 结束流处理 - 极简版本
      finalizeStreamingMarkdownSse: (wasSuccessful) => ({ editor }) => {
        const pluginState = STREAMING_PLUGIN_KEY.getState(editor.state);
        if (!pluginState) return false;
        
        processQueue(editor, pluginState, '', { finalize: true });
        
        const finalError = wasSuccessful ? null : 
          { message: resolveCurrentEditorMessage('editor.aiWriting.error.streamEndedAbnormally'), code: "stream_end" };
        
        editor.commands.setStreamingState({ isActive: false, error: finalError });
        return true;
      },
      
      // 清除状态
      clearStreamingBuffer: () => ({ editor }) => {
        const newState = {
          isActiveStream: false,
          streamingError: null,
          currentInsertPos: null,
          initialBlockContext: null,
          hasProcessedFirstEventYet: false
        };
        
        const tr = editor.state.tr.setMeta(STREAMING_PLUGIN_KEY, newState);
        editor.view.dispatch(tr);
        return true;
      }
    };
  }
});
