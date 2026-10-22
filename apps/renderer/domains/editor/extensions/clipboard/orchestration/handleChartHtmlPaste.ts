/** HTML 图表先整批准入；用户明确选择后才把无效规格作为普通代码粘贴。 */
import type { EditorView } from '@tiptap/pm/view'
import { admitMarkdownChartFenceBody, isMarkdownChartFenceLanguage, MarkdownChartSpecInvalidError } from '@app/schemas'
import { confirmInvalidChartPaste } from '../../../features/chart-editing'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'

export function handleChartHtmlPaste(view: EditorView, event: { readonly clipboardData: Pick<DataTransfer, 'getData'> | null; preventDefault(): void }): boolean {
  if (view.state.selection.$from.parent.type.spec.code) return false
  const html = event.clipboardData?.getData('text/html') ?? ''
  if (!html.includes('chart-block') && !html.includes('linnya-chart')) return false
  const fragment = new DOMParser().parseFromString(html, 'text/html')
  let firstError: MarkdownChartSpecInvalidError | null = null
  let ordinal = 0
  for (const element of fragment.querySelectorAll('figure[data-type="chart-block"], pre')) {
    const figure = element.tagName === 'FIGURE'
    const code = element.querySelector('code')
    const language = code?.className.match(/language-(\S+)/)?.[1]
    if (!figure && !isMarkdownChartFenceLanguage(language)) continue
    // figure 的内容是展示数据，不能再解释其中嵌套的代码或表格。
    if (element.parentElement?.closest('figure[data-type="chart-block"]')) continue
    ordinal += 1
    const source = figure ? element.getAttribute('data-chart-spec') ?? '' : code?.textContent ?? ''
    const admitted = admitMarkdownChartFenceBody(source)
    if (admitted.ok) continue
    firstError ??= new MarkdownChartSpecInvalidError(admitted.diagnostics, { chartOrdinal: ordinal })
    const replacement = fragment.createElement('pre')
    const ordinaryCode = fragment.createElement('code')
    ordinaryCode.className = 'language-json'
    ordinaryCode.textContent = source || element.outerHTML
    replacement.append(ordinaryCode)
    element.replaceWith(replacement)
  }
  if (!firstError) return false
  event.preventDefault()
  const before = view.state.doc
  void confirmInvalidChartPaste(firstError, resolveCurrentEditorMessage).then(decision => {
    // 弹窗期间的并发文档更新不能被旧粘贴覆盖。
    if (decision === 'cancel' || view.isDestroyed || view.state.doc !== before) return
    view.pasteHTML(fragment.body.innerHTML)
  }).catch(error => { console.error('[ChartPaste] 图表 HTML 粘贴失败，文档未改动', error) })
  return true
}
