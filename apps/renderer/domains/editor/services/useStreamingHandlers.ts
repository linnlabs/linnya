/**
 * 流式内容处理 Composable
 * 封装 WASM Streaming Parser + queueProcessor 的事件处理
 */
import type { Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { STREAMING_PLUGIN_KEY } from '../extensions/clipboard/markdown/StreamingMarkdown'
import {
  processQueue,
  getLastInsertPos,
  } from '../extensions/clipboard/markdown/streaming/queueProcessor'
import {
  initializeNewStreamingParser,
  processChunkWithStreamingParser,
  finalizeStreamingParsing,
} from '../../../shared/services/markdownService'
import { positionTextSelectionWithHandshake } from '../features/RenderVirtualization'

export interface StreamingHandlers {
  onOpen: () => void
  onTextChunk: (rawText: string) => Promise<void>
  onStreamBegin: () => void
  onStreamEnd: (success: boolean, reason?: string) => Promise<void>
  onError: (message: string, code?: string) => Promise<void>
  onClose: () => Promise<void>
}

export interface StreamingState {
  wasmStreamingParser: any | null
  aiError: Ref<{ message: string; code?: string } | null>
}

/**
 * 创建流式处理事件处理器
 * @param editor - 编辑器实例 Ref
 * @param state - 流式状态对象
 * @returns 事件处理器对象
 */
export function useStreamingHandlers(
  editor: Ref<Editor | null>,
  state: StreamingState
): {
  handlers: StreamingHandlers
  initializeParser: () => Promise<boolean>
  getParser: () => any | null
  setParser: (parser: any | null) => void
} {
  const handlers: StreamingHandlers = {
    onOpen: () => {
      // AI连接建立，无需显示指示器
    },

    onTextChunk: async (rawText: string) => {
      // 将内容片段传递给 WASM 解析器
      const pluginState = editor.value ? STREAMING_PLUGIN_KEY.getState(editor.value.state) : null
      if (pluginState && state.wasmStreamingParser) {
        try {
          const blockEvents = await processChunkWithStreamingParser(rawText)
          if (blockEvents && Array.isArray(blockEvents) && blockEvents.length > 0) {
            // 获取最新的插件状态，因为 processChunkWithStreamingParser 是 await 的，状态可能已改变
            const currentState = editor.value ? STREAMING_PLUGIN_KEY.getState(editor.value.state) : null
            if (currentState && editor.value) {
              processQueue(editor.value, currentState, blockEvents)
            }
          }
        } catch (wasmError) {
          console.error('[编辑器] WASM process_chunk 错误:', wasmError)
        }
      }
    },

    onStreamBegin: () => {
      // AI开始生成内容，无需显示指示器
    },

    onStreamEnd: async (success: boolean, reason?: string) => {
      let editorStateAtStart = editor.value?.state // 保存初始编辑器状态的引用

      if (!editorStateAtStart) {
        state.wasmStreamingParser = null // 清理本地引用
        console.error('[编辑器] 编辑器状态丢失，无法结束流。')
        return
      }

      const localParserRefForClosure = state.wasmStreamingParser
      state.wasmStreamingParser = null // 尽早设置为空，以防止 onClose 干扰

      let pluginState = STREAMING_PLUGIN_KEY.getState(editorStateAtStart) // 从初始状态获取插件状态

      if (pluginState && localParserRefForClosure && editor.value) {
        try {
          const finalBlockEvents = await finalizeStreamingParsing() // 这是异步的
          // 等待 finalizeStreamingParsing 完成后，获取最新的插件状态
          pluginState = editor.value?.state
            ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
            : pluginState

          if (
            finalBlockEvents &&
            Array.isArray(finalBlockEvents) &&
            finalBlockEvents.length > 0
          ) {
            processQueue(editor.value, pluginState, finalBlockEvents)
            // 在处理完 finalBlockEvents 后，再次获取最新的插件状态
            pluginState = editor.value?.state
              ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
              : pluginState
          }
        } catch (wasmError) {
          // 即使出错，也要尝试获取最新状态以进行 finalize
          pluginState = editor.value?.state
            ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
            : pluginState
        }
      }

      // 确保 pluginState 是最新的，再进行最终的 finalize
      const latestPluginStateForFinalize = editor.value?.state
        ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
        : pluginState
      if (editor.value) {
        processQueue(editor.value, latestPluginStateForFinalize, [], {
          finalize: true,
          errorOccurred: !success,
        })

        const finalInsertPos = getLastInsertPos(editor.value)
        if (success && finalInsertPos !== null) {
          try {
            await positionTextSelectionWithHandshake(editor.value, finalInsertPos)
          } catch (e) {
            // 设置最终光标位置失败
          }
        }
      }
    },

    onError: async (message: string, code?: string) => {
      state.aiError.value = { message, code }
      let editorStateAtStart = editor.value?.state // 保存初始编辑器状态的引用

      if (!editorStateAtStart) {
        state.wasmStreamingParser = null // 清理本地引用
        console.error('[编辑器] 编辑器状态丢失，无法处理流错误。')
        return
      }

      const localParserRefForClosureOnError = state.wasmStreamingParser
      state.wasmStreamingParser = null // 尽早将本地解析器引用设为null

      let pluginState = STREAMING_PLUGIN_KEY.getState(editorStateAtStart) // 从初始状态获取插件状态

      if (pluginState && localParserRefForClosureOnError && editor.value) {
        try {
          const finalBlockEvents = await finalizeStreamingParsing() // 这是异步的
          // 等待 finalizeStreamingParsing 完成后，获取最新的插件状态
          pluginState = editor.value?.state
            ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
            : pluginState

          if (
            finalBlockEvents &&
            Array.isArray(finalBlockEvents) &&
            finalBlockEvents.length > 0
          ) {
            processQueue(editor.value, pluginState, finalBlockEvents, {
              finalize: false,
              errorOccurred: true,
            })
            // 在处理完 finalBlockEvents 后，再次获取最新的插件状态
            pluginState = editor.value?.state
              ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
              : pluginState
          }
        } catch (wasmError) {
          // 即使出错，也要尝试获取最新状态以进行 finalize
          pluginState = editor.value?.state
            ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
            : pluginState
        }
      }

      // 确保 pluginState 是最新的，再进行最终的 finalize
      const latestPluginStateForFinalize = editor.value?.state
        ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
        : pluginState
      if (editor.value) {
        processQueue(editor.value, latestPluginStateForFinalize, [], {
          finalize: true,
          errorOccurred: true,
        })
      }

      console.error(`[编辑器] AI 生成错误: ${message}`)
    },

    onClose: async () => {
      // **关键改动：在开始时检查 wasmStreamingParser**
      if (!state.wasmStreamingParser) {
        // wasmStreamingParser 已经被处理，无需重复操作
        return // 提前返回
      }

      const currentEditorState = editor.value?.state
      if (!currentEditorState) {
        state.wasmStreamingParser = null // 清理本地引用
        console.warn('[编辑器] AI 连接异常关闭 (无编辑器状态)')
        return
      }

      const pluginState = STREAMING_PLUGIN_KEY.getState(currentEditorState)
      const localParserRefForClosureOnClose = state.wasmStreamingParser

      // 在 onClose 自己的逻辑路径结束前，也确保设置 wasmStreamingParser 为 null
      state.wasmStreamingParser = null

      if (pluginState && localParserRefForClosureOnClose && editor.value) {
        try {
          const finalBlockEvents = await finalizeStreamingParsing()
          if (
            finalBlockEvents &&
            Array.isArray(finalBlockEvents) &&
            finalBlockEvents.length > 0
          ) {
            const stateAfterResidualProcessing = editor.value?.state
              ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
              : pluginState
            processQueue(
              editor.value,
              stateAfterResidualProcessing,
              finalBlockEvents,
              { finalize: false, closedAbnormally: true }
            )
          }
        } catch (wasmError) {
          // WASM finalize_parsing 错误
        }
      }

      const latestPluginStateForFinalize = editor.value?.state
        ? STREAMING_PLUGIN_KEY.getState(editor.value.state)
        : pluginState
      if (editor.value) {
        processQueue(editor.value, latestPluginStateForFinalize, [], {
          finalize: true,
          closedAbnormally: true,
        })
      }

      console.log('[编辑器] AI 连接已关闭')
    },
  }

  /**
   * 初始化 WASM Streaming Parser
   * @returns 是否成功初始化
   */
  const initializeParser = async (): Promise<boolean> => {
    state.wasmStreamingParser = await initializeNewStreamingParser()
    if (!state.wasmStreamingParser) {
      console.error('[编辑器] WASM Streaming Parser 初始化失败。')
      state.aiError.value = {
        message: 'WASM Streaming Parser failed to initialize',
        code: 'wasm_init_error',
      }
      return false
    }
    return true
  }

  /**
   * 获取当前解析器实例
   */
  const getParser = () => state.wasmStreamingParser

  /**
   * 设置解析器实例
   */
  const setParser = (parser: any | null) => {
    state.wasmStreamingParser = parser
  }

  return {
    handlers,
    initializeParser,
    getParser,
    setParser,
  }
}
