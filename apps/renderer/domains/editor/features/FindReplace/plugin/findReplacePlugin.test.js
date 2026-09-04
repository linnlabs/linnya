import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import {
  createFindReplacePlugin,
  findReplacePluginKey,
  replaceAllCommand,
  searchCommand,
} from './findReplacePlugin'

function createDocument(text) {
  const content = workspaceMarkdownSchemaLite.nodes.baseBlock.createChecked(
    { id: 'content-1' },
    workspaceMarkdownSchemaLite.text(text),
  )
  const root = workspaceMarkdownSchemaLite.nodes.rootBlock.createChecked(
    { id: 'root-1' },
    content,
  )
  return workspaceMarkdownSchemaLite.nodes.doc.createChecked(null, root)
}

describe('FindReplace 主 Markdown 文档合同', () => {
  it('查找并一次替换全部匹配，不依赖 AudioBlock 子编辑器', () => {
    const store = {
      searchTerm: '',
      matchCase: false,
      wholeWord: false,
      useRegex: false,
    }
    let state = EditorState.create({
      doc: createDocument('Audio note audio'),
      plugins: [createFindReplacePlugin(store)],
    })
    const dispatch = transaction => {
      state = state.apply(transaction)
    }

    expect(searchCommand('audio')(state, dispatch)).toBe(true)
    expect(findReplacePluginKey.getState(state).matches).toHaveLength(2)

    expect(replaceAllCommand('voice')(state, dispatch)).toBe(true)
    expect(state.doc.textContent).toBe('voice note voice')
    expect(findReplacePluginKey.getState(state).matches).toEqual([])
  })
})
