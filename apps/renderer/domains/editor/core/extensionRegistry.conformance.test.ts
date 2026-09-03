// @vitest-environment jsdom

import { getSchema } from '@tiptap/core'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {},
  })
})

// extension registry 会静态加载 Workspace 交互扩展；schema 门禁不执行 IPC，
// 因此用空端口隔离 Electron preload 初始化，仅保留真实生产 extensions。
vi.mock('../../../shared/ipc/workspaceGateway', () => ({
  workspaceGateway: {},
}))

vi.mock('../../../shared/services/markdownService', () => ({
  parseMarkdown: vi.fn(),
  parseMarkdownToBlocksByStreaming: vi.fn(),
}))

import {
  convertBlockEventsToDocJson,
  workspaceMarkdownSchemaContract,
  workspaceMarkdownSchemaLite,
} from 'src/domains/markdown'
import { parseEditorDocumentJson } from '../functions/parseEditorDocumentJson'
import { getAllExtensions } from './extensionRegistry'

function createProductionEditorSchema() {
  setActivePinia(createPinia())
  const extensions = getAllExtensions({
    layoutManagerInstance: ref(null),
    findReplaceStore: null,
    audioEditorsStore: null,
    audioContentStore: null,
    audioRuntimeStore: null,
  })
  const invalidIndex = extensions.findIndex(extension => !extension)
  if (invalidIndex >= 0) {
    throw new Error(`生产 extension registry 第 ${invalidIndex} 项为空`)
  }
  const nonTiptapIndex = extensions.findIndex(extension => !('config' in extension))
  if (nonTiptapIndex >= 0) {
    throw new Error(`生产 extension registry 第 ${nonTiptapIndex} 项不是 Tiptap extension`)
  }
  return getSchema(extensions)
}

describe('Workspace Markdown 与生产 Editor schema conformance', () => {
  it('生产 Editor 覆盖 Markdown 正式 node/mark 及其全部属性', () => {
    const editorSchema = createProductionEditorSchema()

    for (const [nodeName, attributeNames] of Object.entries(workspaceMarkdownSchemaContract.nodes)) {
      const editorNode = editorSchema.nodes[nodeName]
      expect(editorNode, `Editor 缺少 node: ${nodeName}`).toBeDefined()
      expect(Object.keys(editorNode.spec.attrs ?? {}), `node attrs 不一致: ${nodeName}`).toEqual(
        expect.arrayContaining([...attributeNames])
      )
    }

    for (const [markName, attributeNames] of Object.entries(workspaceMarkdownSchemaContract.marks)) {
      const editorMark = editorSchema.marks[markName]
      expect(editorMark, `Editor 缺少 mark: ${markName}`).toBeDefined()
      expect(Object.keys(editorMark.spec.attrs ?? {}), `mark attrs 不一致: ${markName}`).toEqual(
        expect.arrayContaining([...attributeNames])
      )
    }
  })

  it('后端生成的 Link 文档可被生产 Editor schema 严格解析', () => {
    const docJson = convertBlockEventsToDocJson([
      {
        block_type: 'ParagraphBlock',
        structured_content: [
          {
            type: 'text',
            text: '链接',
            marks: [
              {
                type: 'link',
                attrs: { href: 'https://example.com', title: '示例' },
              },
            ],
          },
        ],
      },
    ])
    if (!docJson) {
      throw new Error('后端未生成 Link fixture')
    }

    const parsed = parseEditorDocumentJson(docJson, createProductionEditorSchema())

    expect(parsed.textContent).toBe('链接')
    expect(parsed.toJSON().content?.[0]?.content?.[0]?.content?.[0]?.marks).toEqual([
      {
        type: 'link',
        attrs: { href: 'https://example.com', title: '示例' },
      },
    ])
  })

  it('Markdown schema 可构造的每种根块和 mark 都能进入生产 Editor', () => {
    const editorSchema = createProductionEditorSchema()
    const rootBlockType = workspaceMarkdownSchemaLite.nodes.rootBlock
    const docType = workspaceMarkdownSchemaLite.nodes.doc
    const rootContentNodeNames = [
      'baseBlock',
      'headingBlock',
      'horizontalRuleBlock',
      'listItemBlock',
      'quoteBlock',
      'codeBlock',
      'latexBlock',
      'table',
      'imageBlock',
      'audioBlock',
      'bibliographyBlock',
    ] as const

    for (const nodeName of rootContentNodeNames) {
      const inner = workspaceMarkdownSchemaLite.nodes[nodeName].createAndFill()
      if (!inner) {
        throw new Error(`无法构造 Markdown node fixture: ${nodeName}`)
      }
      const backendDoc = docType.createChecked(null, [
        rootBlockType.createChecked({ id: `root-${nodeName}` }, inner),
      ])
      expect(() => parseEditorDocumentJson(backendDoc.toJSON(), editorSchema)).not.toThrow()
    }

    for (const markName of Object.keys(workspaceMarkdownSchemaContract.marks)) {
      const mark = workspaceMarkdownSchemaLite.marks[markName].create()
      const text = workspaceMarkdownSchemaLite.text(markName, [mark])
      const inner = workspaceMarkdownSchemaLite.nodes.baseBlock.createChecked(
        { id: `inner-${markName}` },
        [text]
      )
      const backendDoc = docType.createChecked(null, [
        rootBlockType.createChecked({ id: `root-${markName}` }, [inner]),
      ])
      expect(() => parseEditorDocumentJson(backendDoc.toJSON(), editorSchema)).not.toThrow()
    }
  })
})
