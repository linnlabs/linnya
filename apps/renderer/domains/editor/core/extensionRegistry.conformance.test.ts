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

const chartFixtureSpec = {
  chartType: 'bar',
  categories: ['A', 'B'],
  series: [{ name: 'S', values: [1, 2] }],
}

function createProductionEditorSchema() {
  setActivePinia(createPinia())
  const extensions = getAllExtensions({
    layoutManagerInstance: ref(null),
    findReplaceStore: null,
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

function readProductionExtensionNames(): string[] {
  setActivePinia(createPinia())
  return getAllExtensions({
    layoutManagerInstance: ref(null),
    findReplaceStore: null,
  }).map(extension => extension.name)
}

describe('Workspace Markdown 与生产 Editor schema conformance', () => {
  it('RootBlock 拖拽只注册自定义绿色 drop indicator', () => {
    const names = readProductionExtensionNames()

    expect(names.filter(name => name === 'customDropCursor')).toHaveLength(1)
    expect(names).not.toContain('dropCursor')
  })

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

  it('生产 Editor 保持 Workspace 自定义格式边界', () => {
    const editorSchema = createProductionEditorSchema()
    const extensionNames = readProductionExtensionNames()

    expect(editorSchema.marks.underline).toBeUndefined()
    expect(Object.keys(editorSchema.marks.link.spec.attrs ?? {})).toEqual(['href', 'title'])
    expect(extensionNames).not.toContain('listKeymap')
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

  it('后端生成的图表文档可被生产 Editor schema 严格解析，规格原样保留', () => {
    const docJson = convertBlockEventsToDocJson([
      {
        block_type: 'CodeBlock',
        language: 'linnya-chart',
        raw_content_fallback: JSON.stringify(chartFixtureSpec),
      },
    ])
    if (!docJson) {
      throw new Error('后端未生成图表 fixture')
    }

    const parsed = parseEditorDocumentJson(docJson, createProductionEditorSchema())
    const chart = parsed.firstChild?.firstChild

    expect(chart?.type.name).toBe('chartBlock')
    expect(chart?.attrs.spec).toEqual(docJson.content?.[0]?.content?.[0]?.attrs?.spec)
    expect(chart?.attrs.spec).toMatchObject(chartFixtureSpec)
  })

  it('图表块没有可用的默认规格：缺少 spec 的文档被 Editor 拒绝', () => {
    const editorSchema = createProductionEditorSchema()
    const invalidDoc = {
      type: 'doc',
      content: [{
        type: 'rootBlock',
        attrs: { id: 'root-chart' },
        content: [{ type: 'chartBlock', attrs: { id: 'chart-1', blockType: 'chart' } }],
      }],
    }

    expect(() => parseEditorDocumentJson(invalidDoc, editorSchema)).toThrow()
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
      'chartBlock',
      'table',
      'imageBlock',
      'bibliographyBlock',
    ] as const

    for (const nodeName of rootContentNodeNames) {
      // chartBlock 的 spec 没有默认值，必须显式给出一份合法规格。
      const inner = nodeName === 'chartBlock'
        ? workspaceMarkdownSchemaLite.nodes.chartBlock.createChecked({ id: 'chart-fixture', spec: chartFixtureSpec })
        : workspaceMarkdownSchemaLite.nodes[nodeName].createAndFill()
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
