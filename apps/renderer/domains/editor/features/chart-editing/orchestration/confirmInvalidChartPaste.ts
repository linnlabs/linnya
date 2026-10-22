/**
 * @file confirmInvalidChartPaste.ts
 * @description 粘贴内容含无效图表围栏时的人工决策：文档先保持不变，由用户选择取消，或显式“作为普通代码插入”。
 *
 * “作为普通代码插入”是用户的明确动作，不是静默降级：无效内容以 `json` 代码保存，
 * 不会留下保留语言的非法代码块，也不会让一次粘贴部分落地。
 */

import { confirm } from '@shared/composables/confirmDialog'
import type { MarkdownChartSpecInvalidError } from '@app/schemas'
import type { EditorMessageResolver } from '../../../definitions/editorMessages'
import { listChartIssues } from '../functions/chartIssues'

export type InvalidChartPasteDecision = 'as-code' | 'cancel'

export async function confirmInvalidChartPaste(
  error: MarkdownChartSpecInvalidError,
  editorMessage: EditorMessageResolver,
): Promise<InvalidChartPasteDecision> {
  const insertAsCode = await confirm({
    title: editorMessage('editor.chart.paste.invalidTitle'),
    message: editorMessage('editor.chart.paste.invalidMessage'),
    sections: [{ title: editorMessage('editor.chart.paste.issuesTitle'), items: listChartIssues(error) }],
    confirmText: editorMessage('editor.chart.paste.asCode'),
    cancelText: editorMessage('editor.chart.paste.cancel'),
    width: '520px',
  })
  return insertAsCode ? 'as-code' : 'cancel'
}
