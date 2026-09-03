/**
 * @file citation/extension/CitationInlineTriggerExtension.ts
 * @description Citation 内联语法触发扩展
 *
 * 支持三种触发语法（用户输入时弹出菜单，Enter/点击打开引用面板）：
 * - \\cite   （LaTeX 风格）
 * - [@      （Pandoc 风格 citation）
 * - [^      （footnote 风格）
 *
 * 设计说明：
 * - 复用 Tiptap Suggestion + tippy + VueRenderer（与 SlashMenu 一致）
 * - 菜单项极简：只有“引用”一项，默认选中第一个
 * - 触发后删除用户输入的触发文本，再打开 CitationPanel
 */

import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import tippy from 'tippy.js'
import { PluginKey } from '@tiptap/pm/state'

// 复用 SlashMenu 的视图组件，保证菜单样式/键盘交互完全一致
import SlashMenuView from '../../SlashMenu/ui/SlashMenuView.vue'

import { useCitationPanelStore } from '../store/useCitationPanelStore'
import type { CitationInsertSyntax } from '../store/useCitationPanelStore'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'

type TriggerKind = 'latexCite' | 'bracketAt' | 'footnote'

// 为三个 Suggestion 分配不同的 PluginKey，避免默认的 suggestion$ key 冲突
const citeSuggestionKey = new PluginKey('citationInlineTrigger:cite')
const bracketAtSuggestionKey = new PluginKey('citationInlineTrigger:bracketAt')
const footnoteSuggestionKey = new PluginKey('citationInlineTrigger:footnote')

function openCitationPanelWithSyntax(syntax: CitationInsertSyntax) {
  const store = useCitationPanelStore()
  // 默认打开 KB tab（与原 /cite 一致）
  store.open('kb', syntax)
}

function createSingleItem(triggerKind: TriggerKind) {
  return [
    {
      id: `citation-${triggerKind}`,
      title: resolveCurrentEditorMessage('editor.citation.inlineTrigger.title'),
      command: () => {
        openCitationPanelWithSyntax(triggerKind)
      },
    },
  ]
}

function createRenderer() {
  return () => {
    let component: VueRenderer | null = null
    let popup: any = null

    return {
      onStart: (props: any) => {
        if (!props.clientRect) return

        // 复用 SlashMenuView：样式/键盘交互与 /c 完全一致
        component = new VueRenderer(SlashMenuView, {
          props,
          editor: props.editor,
        })

        const contentEl = component.element
        if (!contentEl) return

        // 使用 document.body 作为 target，避免 TS 对 string target 的重载不匹配
        popup = tippy(document.body as Element, {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: contentEl,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          duration: 120,
        })
      },
      onUpdate(props: any) {
        component?.updateProps(props)
        if (!props.clientRect) return
        popup?.[0]?.setProps({
          getReferenceClientRect: props.clientRect,
        })
      },
      onKeyDown(props: any) {
        if (props.event.key === 'Escape') {
          popup?.[0]?.hide()
          return true
        }

        const handled = component?.ref?.onKeyDown(props)
        return handled ?? false
      },
      onExit() {
        popup?.[0]?.destroy()
        component?.destroy()
        popup = null
        component = null
      },
    }
  }
}

function getSuggestionMatchText(state: { doc: { textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string } }, range: { from: number; to: number }) {
  // 中文说明：
  // - Suggestion 的 allow 回调拿不到 query（类型定义如此），但能拿到 state + range。
  // - range 覆盖的是“触发字符 + query”的文本范围（不含 allowedPrefixes 的前置字符）。
  // - 因此可通过 doc.textBetween(range.from, range.to) 还原当前匹配文本，例如：
  //   - "\cite" 触发：text="\\cite"
  //   - "[@":     text="@"（query 为空时）
  //   - "[^":     text="^"（query 为空时）
  return state.doc.textBetween(range.from, range.to, '\n', '\0')
}

export const CitationInlineTriggerExtension = Extension.create({
  name: 'citationInlineTrigger',

  addProseMirrorPlugins() {
    const renderer = createRenderer()

    return [
      // 1) \cite 触发（char = '\', query = 'cite...'）
      Suggestion({
        editor: this.editor,
        pluginKey: citeSuggestionKey,
        char: '\\',
        startOfLine: false,
        allowSpaces: false,
        allow: ({ state, range }: { state: any; range: { from: number; to: number } }) => {
          const text = getSuggestionMatchText(state, range)
          const q = (text.slice(1) || '').toLowerCase()
          // 中文说明：不满足条件就不要弹出菜单（避免 SlashMenu 的“没有匹配的结果”空态）。
          // 仅当用户完整输入 "\cite" 时才允许弹一次菜单。
          return q === 'cite'
        },
        items: ({ query }: { query: string }) => {
          const q = (query || '').toLowerCase()
          // 中文说明：仅在用户完整输入 "\cite" 时弹一次菜单；
          // 若用户继续输入（例如 "\citeX"）则不再出现（避免反复打扰输入）。
          const ok = q === 'cite'
          return ok ? createSingleItem('latexCite') : []
        },
        render: renderer,
        command: ({ editor, range, props }: any) => {
          // 删除 \cite... 触发文本
          editor.chain().focus().deleteRange(range).run()
          props.command()
        },
      }),

      // 2) [@ 触发（char = '@'，要求前一字符是 '['）
      Suggestion({
        editor: this.editor,
        pluginKey: bracketAtSuggestionKey,
        char: '@',
        startOfLine: false,
        allowSpaces: false,
        // 使用 Suggestion 内置的前缀约束，比手写 allow 更稳定
        allowedPrefixes: ['['],
        allow: ({ state, range }: { state: any; range: { from: number; to: number } }) => {
          // 中文说明：仅在刚输入 "[@" 且 query 为空时允许弹一次菜单。
          // 用户继续输入后（query 非空）应立即退出，避免持续悬浮干扰。
          const text = getSuggestionMatchText(state, range)
          return text.length === 1
        },
        items: ({ query }: { query: string }) => {
          // 中文说明：仅在刚输入 "[@"
          // 且光标紧跟在 '@' 后（query 为空）时弹一次菜单；
          // 一旦用户继续输入（query 非空）就不再出现，避免菜单持续悬浮干扰输入。
          const q = (query || '').toLowerCase()
          if (q.length > 0) return []
          return createSingleItem('bracketAt')
        },
        render: renderer,
        command: ({ editor, range, props }: any) => {
          // 删除 "[@"：range.from 指向 '@'，需要额外删掉前面的 '['
          const from = Math.max(0, range.from - 1)
          editor.chain().focus().deleteRange({ from, to: range.to }).run()
          props.command()
        },
      }),

      // 3) [^ 触发（char = '^'，要求前一字符是 '['）
      Suggestion({
        editor: this.editor,
        pluginKey: footnoteSuggestionKey,
        char: '^',
        startOfLine: false,
        allowSpaces: false,
        allowedPrefixes: ['['],
        allow: ({ state, range }: { state: any; range: { from: number; to: number } }) => {
          // 中文说明：同 "[@"：仅在刚输入 "[^" 且 query 为空时允许弹一次菜单；
          // 用户继续输入后应立即退出，避免空态文案出现。
          const text = getSuggestionMatchText(state, range)
          return text.length === 1
        },
        items: ({ query }: { query: string }) => {
          // 中文说明：同 "[@"：仅在刚输入 "[^" 且 query 为空时弹一次菜单；
          // 用户继续输入后不再出现，避免反复打扰。
          const q = (query || '').toLowerCase()
          if (q.length > 0) return []
          return createSingleItem('footnote')
        },
        render: renderer,
        command: ({ editor, range, props }: any) => {
          const from = Math.max(0, range.from - 1)
          editor.chain().focus().deleteRange({ from, to: range.to }).run()
          props.command()
        },
      }),
    ]
  },
})

export default CitationInlineTriggerExtension
