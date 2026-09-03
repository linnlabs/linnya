/**
 * Citation 交互装配。
 *
 * CitationNode 是 selectable inline atom，光标移动、整体选择和删除由 ProseMirror 原生节点语义
 * 负责；这里仅注册派生读模型与 Citation 特有的点击/悬浮事件。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { createCitationRenderPlugin } from '../render/citationRenderPlugin'

export const citationInteractionPluginKey = new PluginKey('citationInteraction')

function dispatchCitationDomEvent(
  event: MouseEvent,
  name: 'citation-click' | 'citation-hover'
): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  const citationElement = target.closest<HTMLElement>('.citation-mark[data-citation-id]')
  if (!citationElement) return false

  const citationId = citationElement.dataset.citationId
  const sourceId = citationElement.dataset.sourceId
  if (!citationId || !sourceId) return false

  const rect = citationElement.getBoundingClientRect()
  citationElement.dispatchEvent(
    new CustomEvent(name, {
      detail: {
        citationId,
        sourceId,
        position: { top: rect.bottom, left: rect.left },
        element: citationElement,
      },
      bubbles: true,
    })
  )
  return true
}

export const CitationInteractionExtension = Extension.create({
  name: 'citationInteraction',

  addProseMirrorPlugins() {
    return [
      createCitationRenderPlugin(),
      new Plugin({
        key: citationInteractionPluginKey,
        props: {
          handleDOMEvents: {
            click(_view, event) {
              const handled = dispatchCitationDomEvent(event, 'citation-click')
              if (handled) event.preventDefault()
              return handled
            },
            mouseover(_view, event) {
              dispatchCitationDomEvent(event, 'citation-hover')
              return false
            },
          },
        },
      }),
    ]
  },
})

export default CitationInteractionExtension
