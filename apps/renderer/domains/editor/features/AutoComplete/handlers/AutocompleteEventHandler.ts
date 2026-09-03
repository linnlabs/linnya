/**
 * @file AutocompleteEventHandler.ts
 * @description 事件处理器
 *
 * 职责：
 * - 处理文档变化事件
 * - 处理光标移动事件
 * - 判断是否应该拒绝建议
 */

import type { EditorState } from 'prosemirror-state';

export interface EditorChangeInfo {
  /** 文档是否变化 */
  docChanged: boolean;
  /** 光标位置是否变化 */
  selectionPosChanged: boolean;
  /** 选区类型是否变化 */
  selectionTypeChanged: boolean;
}

export interface RejectionInfo {
  /** 是否是拒绝场景 */
  isRejection: boolean;
  /** 用户拒绝后输入的文本 */
  userInputAfterRejection: string;
}

export class AutocompleteEventHandler {
  /**
   * 检测编辑器状态变化
   */
  static detectChange(prevState: EditorState, currentState: EditorState): EditorChangeInfo {
    const { selection } = currentState;
    const prevSelection = prevState.selection;

    return {
      docChanged: !prevState.doc.eq(currentState.doc),
      selectionPosChanged: prevSelection.from !== selection.from || prevSelection.to !== selection.to,
      selectionTypeChanged: prevSelection.empty !== selection.empty,
    };
  }

  /**
   * 判断是否是拒绝场景并提取用户输入
   */
  static checkRejection(
    changeInfo: EditorChangeInfo,
    hasSuggestion: boolean,
    prevState: EditorState,
    currentState: EditorState
  ): RejectionInfo {
    // 检查是否是拒绝场景：文档变化或光标移动且有活跃的建议
    const isRejection = (changeInfo.docChanged || changeInfo.selectionPosChanged) && hasSuggestion;

    // 获取用户输入的新文本（如果是拒绝场景）
    // 根因说明（中文）：
    // - 之前的实现用“光标前 50 字”作为 userInputAfterRejection，这会混入大量既有上下文，
    //   导致后端 prompt 展示的 "user then typed" 看起来不对（并非用户本次新输入的增量）。
    // - 正确做法应当是提取“本次 doc 变更引入的插入文本”（insert / paste / replace 的新增部分）。
    let userInputAfterRejection = '';
    if (isRejection && changeInfo.docChanged) {
      try {
        const diffStart = prevState.doc.content.findDiffStart(currentState.doc.content);
        const diffEnd = prevState.doc.content.findDiffEnd(currentState.doc.content);

        if (diffStart !== null && diffEnd !== null) {
          // diffEnd.b：currentState 中发生变化的尾部位置（对应新文档）
          // 只提取新文档中 [diffStart, diffEnd.b] 的文本，作为“本次新增输入”
          const insertedText = currentState.doc.textBetween(diffStart, diffEnd.b, '');

          // 只在确实存在插入内容时才记录；纯删除/纯移动不写入 “user then typed”
          if (insertedText.trim().length > 0) {
            userInputAfterRejection = insertedText;
          }
        }
      } catch (e) {
        // 忽略错误
      }
    }

    return {
      isRejection,
      userInputAfterRejection,
    };
  }

  /**
   * 检查是否应该触发新的补全
   */
  static shouldTriggerNewCompletion(
    changeInfo: EditorChangeInfo,
    currentState: EditorState
  ): boolean {
    const { selection } = currentState;

    // 如果用户输入或移动了光标
    if (!changeInfo.docChanged && !changeInfo.selectionPosChanged && !changeInfo.selectionTypeChanged) {
      return false;
    }

    // 仅当选区是光标时，才触发
    return selection.empty;
  }

  /**
   * 获取光标位置前的文本（用于提取用户输入）
   */
  static extractTextBeforeCursor(state: EditorState, maxLength: number = 50): string {
    try {
      const { selection } = state;
      const cursorPos = selection.from;
      const startPos = Math.max(0, cursorPos - maxLength);
      return state.doc.textBetween(startPos, cursorPos, '');
    } catch (e) {
      return '';
    }
  }
}
