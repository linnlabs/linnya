/**
 * @file StreamingMarkdownCommands.ts
 * @description 为 StreamingMarkdown 扩展提供 TipTap Commands 的类型声明（module augmentation）。
 *
 * 中文说明：
 * - StreamingMarkdown 扩展本体是 JS 文件（`StreamingMarkdown.js`），TS 无法自动推断其 addCommands 返回的命令。
 * - 项目内多处直接调用 `editor.commands.setStreamingState(...)`；
 *   如果没有命令类型声明，会在 TS/ESLint 下报错：Property 'setStreamingState' does not exist on type 'SingleCommands'.
 * - 这里用 module augmentation 把命令契约显式化，避免任何 `as any` 断言。
 */

export interface StreamingStateError {
  message: string
  code?: string
}

export interface StreamingInitialBlockContext {
  /** 是否在空 baseBlock 中触发（空块需要特殊插入位置处理） */
  isInEmptyBaseBlock: boolean
  /** 空 baseBlock 的节点起始位置（非空则为 null） */
  emptyBaseBlockNodePos: number | null
  /** 初始 rootBlock 的起始位置 */
  initialRootBlockPos?: number | null
  /** 初始 rootBlock 的结束位置（pos + nodeSize） */
  initialRootBlockEndPos?: number | null
  /** 触发 AI 的原始光标位置 */
  originalTriggerPos: number
}

export interface StreamingStateSnapshot {
  isActiveStream: boolean
  streamingError: StreamingStateError | null
  currentInsertPos: number | null
  initialBlockContext: StreamingInitialBlockContext | null
  hasProcessedFirstEventYet: boolean
}

export type StreamingStateUpdate = Partial<StreamingStateSnapshot>

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    streamingMarkdown: {
      /**
       * 设置/更新流式状态（由 StreamingMarkdown 扩展实现）
       */
      setStreamingState: (stateUpdate: StreamingStateUpdate) => ReturnType
    }
  }
}




