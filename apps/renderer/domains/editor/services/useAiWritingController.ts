/**
 * AI 写作控制器 Composable
 * 封装 AI 提示提交与编辑器内流式写入逻辑
 */
import type { Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { PositionUtils } from '../extensions/position/PositionUtils'
import { WRITING_PROMPT_KEY } from '@app/schemas'
import { determineModelId } from '../../../shared/services/aiService/common'
import { generateTextStream } from '../../../shared/services/aiService/unifiedApiService'
import type { StreamingHandlers } from './useStreamingHandlers'
import type { EditorMessageResolver } from '../definitions/editorMessages'

export interface AiWritingControllerOptions {
  editor: Ref<Editor | null>
  /**
   * UIStore（Pinia）实例。
   *
   * 中文说明：
   * - 这里不直接依赖 `useUIStore()` 的完整类型，避免把 UIStore 的所有字段耦合进来。
   * - 仅声明本 controller 真正需要的最小接口，便于后续演进。
   */
  uiStore: AiWritingUIStore
  handlers: StreamingHandlers
  initializeParser: () => Promise<boolean>
  message: EditorMessageResolver
}

/**
 * AI 写作 controller 使用到的 UIStore 最小能力集合。
 * - 禁止使用 any：必须显式声明我们依赖的字段/方法。
 */
export interface AiWritingUIStore {
  aiPromptTriggerPos: number | null
  hideAiPrompt: () => void
}

export interface AiPromptData {
  prompt: string
  targetPosition?: number
}

/**
 * 仅用于本文件的运行时类型守卫/结构声明。
 * 中文说明：PositionUtils 来自 JS 文件，TS 无法自动推断返回结构；
 * 我们在这里“按实际返回结构”声明最小字段，并通过类型守卫把 unknown 收敛为可用类型。
 */
interface BlockNodeInfo {
  node: {
    type: { name: string }
    content: { size: number }
    nodeSize: number
  }
  pos: number
}

interface BlockInfoFromPos {
  contentBlock: BlockNodeInfo | null
  rootBlock: BlockNodeInfo | null
  // 向后兼容字段（PositionResolver 会同时返回 baseBlock 与 contentBlock）
  baseBlock?: BlockNodeInfo | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBlockNodeInfo(value: unknown): value is BlockNodeInfo {
  if (!isRecord(value)) return false
  if (typeof value.pos !== 'number') return false
  if (!isRecord(value.node)) return false
  if (!isRecord(value.node.type)) return false
  if (typeof value.node.type.name !== 'string') return false
  if (!isRecord(value.node.content)) return false
  if (typeof value.node.content.size !== 'number') return false
  if (typeof value.node.nodeSize !== 'number') return false
  return true
}

function parseBlockInfoFromPos(value: unknown): BlockInfoFromPos | null {
  if (!isRecord(value)) return null

  const contentBlockRaw = value.contentBlock
  const rootBlockRaw = value.rootBlock

  const contentBlock = contentBlockRaw === null ? null : isBlockNodeInfo(contentBlockRaw) ? contentBlockRaw : null
  const rootBlock = rootBlockRaw === null ? null : isBlockNodeInfo(rootBlockRaw) ? rootBlockRaw : null

  // PositionResolver 在未找到块时会返回 { contentBlock: null, rootBlock: null } 或直接返回 null
  if (contentBlock === null && rootBlock === null) {
    return null
  }

  return {
    contentBlock,
    rootBlock,
    baseBlock: undefined,
  }
}

function getErrorMessage(error: unknown, message: EditorMessageResolver): string {
  if (error instanceof Error) return error.message || message('editor.common.unknownError')
  if (typeof error === 'string') return error
  return message('editor.common.unknownError')
}

/**
 * 创建 AI 写作控制器
 */
export function useAiWritingController(options: AiWritingControllerOptions) {
  const { editor, uiStore, handlers, initializeParser, message } = options

  /**
   * 处理 AI 提示提交
   */
  const handleAiPromptSubmit = async (data: AiPromptData) => {
    if (!editor.value || !data.prompt?.trim()) return

    // 获取触发位置
    const triggerPos = uiStore.aiPromptTriggerPos
    if (typeof triggerPos !== 'number' || triggerPos < 0) {
      console.error('[EditorContent] 无效的触发位置:', triggerPos)
      return
    }

    // 隐藏AI提示框
    uiStore.hideAiPrompt()

    try {
      // 初始化 WASM StreamingParser
      const initialized = await initializeParser()
      if (!initialized) {
        return
      }

      // 核心状态初始化：在流开始时设置插件状态
      let initialBlockCtx = null
      let initialInsertPos = triggerPos // 默认初始插入位置为触发位置

      try {
        const posUtils = new PositionUtils(editor.value)
        const blockInfo = parseBlockInfoFromPos(posUtils.getBlockInfoFromPos(triggerPos))

        if (blockInfo) {
          const contentBlock = blockInfo.contentBlock
          const isInEmptyBaseBlock =
            !!contentBlock &&
            contentBlock.node.type.name === 'baseBlock' &&
            contentBlock.node.content.size === 0
          initialBlockCtx = {
            isInEmptyBaseBlock: isInEmptyBaseBlock,
            emptyBaseBlockNodePos: isInEmptyBaseBlock
              ? contentBlock.pos
              : null,
            initialRootBlockPos: blockInfo.rootBlock?.pos,
            initialRootBlockEndPos: blockInfo.rootBlock
              ? blockInfo.rootBlock.pos + blockInfo.rootBlock.node.nodeSize
              : null,
            originalTriggerPos: triggerPos,
          }
          // 如果在空块中，初始插入点应该是空块内部的开始，即光标位置
          initialInsertPos = isInEmptyBaseBlock
            ? triggerPos
            : blockInfo.rootBlock
              ? blockInfo.rootBlock.pos + blockInfo.rootBlock.node.nodeSize
              : triggerPos
        }
      } catch (e) {
        // 保留 initialInsertPos 为 triggerPos
      }

      // 命令 setStreamingState 由 StreamingMarkdown 扩展提供（类型声明在 StreamingMarkdownCommands.ts）
      editor.value.commands.setStreamingState({
        isActiveStream: true,
        streamingError: null,
        currentInsertPos: initialInsertPos,
        initialBlockContext: initialBlockCtx,
        hasProcessedFirstEventYet: false,
      })

      // 准备上下文
      const { getWritingStructuredContext } = await import(
        '../features/AiWriting/config/contextConfig'
      )
      const { context_before: contextBefore, context_after: contextAfter } =
        await getWritingStructuredContext(editor.value)

      // 写作属于可配置辅助任务；未单独选择时 resolver 会保持“沿用主要模型”的既有行为。
      const modelId = determineModelId(WRITING_PROMPT_KEY)

      // 构建请求负载
      const requestPayload = {
        prompt: data.prompt,
        prompt_key: WRITING_PROMPT_KEY,
        context_before: contextBefore,
        context_after: contextAfter,
        model_id: modelId,
      }

      /**
       * 启动统一的流式生成（不再经过侧边栏/assistantStore 链路）
       *
       * 中文说明：
       * - 以前会借用 Conversation 的任务编排器与侧边栏事件系统；
       * - 现在 AiWriting 退化为“编辑器内的简单生成”，仅消费 `final_answer_chunk` 文本流并写入编辑器。
       */
      // 直接走 unifiedApiService：只关注文本 chunk，不产生侧边栏对话/步骤。
      void generateTextStream(
        requestPayload,
        {
          onOpen: () => {
            handlers.onOpen?.()
            handlers.onStreamBegin?.()
          },
          onTextChunk: (textChunk: string) => {
            void handlers.onTextChunk(textChunk)
          },
          onStreamEnd: () => {
            // 统一视为成功结束；失败会走 onError
            void handlers.onStreamEnd(true)
            void handlers.onClose()
          },
          onError: () => {
            // 这里把错误透传给编辑器侧的错误处理逻辑（会 finalize + 标记 error）
            const errorMessage = message('editor.aiWriting.error.streamRequestFailed')
            void handlers.onError(errorMessage, 'api_error')
            void handlers.onStreamEnd(false, errorMessage)
            void handlers.onClose()
          },
        }
      ).catch((error: unknown) => {
        // 中文说明：unifiedApiService 内部会回调 onError 并抛出错误；
        // 这里承接 Promise rejection，避免控制台出现“未处理的 Promise 拒绝”。
        console.error('[编辑器] unifiedApiService.generateTextStream 未捕获异常:', error)
      })
    } catch (error: unknown) {
      console.error(`[编辑器] AI 生成异常: ${getErrorMessage(error, message)}`)
    }
  }

  return {
    handleAiPromptSubmit,
  }
}
