// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { MarkdownRevisionCommit, MarkdownRevisionSnapshot } from '@app/schemas'
import { convertBlockEventsToDocJson } from 'src/domains/markdown'

vi.hoisted(() => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} })
})

const mocks = vi.hoisted(() => ({ read: vi.fn(), commit: vi.fn() }))

vi.mock('@/shared/ipc/workspaceGateway', () => ({
  workspaceGateway: { 'read-document': mocks.read, 'commit-markdown-revision': mocks.commit },
}))
// jsdom 没有 WASM URL 服务：扩展注册表只需要这个模块可被导入，解析统一走下面的 Node 解析器端口。
vi.mock('../../../../../../../shared/services/markdownService', () => ({
  parseMarkdown: vi.fn(),
  parseMarkdownToBlocksByStreaming: vi.fn(),
}))
// 与生产同一份 WASM parser；jsdom 下通过正式 Node 加载端口取得真实 BlockEvent。
vi.mock('../../../../../services/markdownRuntime/parser', async () => {
  const { parseMarkdownToBlocksInNode } = await import('src/domains/markdown/features/normalization')
  return { parseMarkdownToBlockEvents: parseMarkdownToBlocksInNode }
})

import { getAllExtensions } from '../../../../../core/extensionRegistry'
import { parseEditorDocumentJson } from '../../../../../functions/parseEditorDocumentJson'
import {
  beginMarkdownDocumentSession,
  loadMarkdownDocumentSession,
} from '../../../../document-session'
import { useRevisionStore } from '../../../useRevisionStore'

type Pending = MarkdownRevisionSnapshot['pendingRevisions'][number]

const paragraph = (id: string, text?: string): JSONContent => ({
  type: 'baseBlock',
  attrs: { id: `${id}-content`, blockType: 'base' },
  ...(text ? { content: [{ type: 'text', text }] } : {}),
})
const rule = (id: string): JSONContent => ({
  type: 'horizontalRuleBlock',
  attrs: { id: `${id}-content`, blockType: 'horizontalRule' },
})
const root = (id: string, content: JSONContent): JSONContent => ({
  type: 'rootBlock',
  attrs: { id },
  content: [content],
})
const documentOf = (...roots: JSONContent[]): JSONContent => ({ type: 'doc', content: roots })

function pending(
  id: string,
  blockId: string,
  operation: 'insert' | 'update' | 'delete',
  newMarkdown: string,
  anchorBlockId?: string,
): Pending {
  return {
    id,
    revision: 1,
    blockId,
    newMarkdown,
    source: 'ai',
    operation,
    metaJson: JSON.stringify({ operation, ...(anchorBlockId ? { anchorBlockId } : {}) }),
    createdAt: 1_700_000_000_000,
    updatedAt: 1,
  }
}

function snapshot(
  content: JSONContent,
  pendingRevisions: Pending[],
  versionNumber = 1,
): MarkdownRevisionSnapshot {
  return { content, pendingRevisions, versionNumber }
}

/** 块身份由各自事务重新生成，结构比较一律忽略 id。 */
function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'id')
        .map(([key, entry]) => [key, stripIds(entry)]),
    )
  }
  return value
}

function rootOf(editor: Editor, blockId: string): ProseMirrorNode {
  let found: ProseMirrorNode | null = null
  editor.state.doc.forEach(node => {
    if (node.attrs.id === blockId) found = node
  })
  if (!found) throw new Error(`缺少 rootBlock: ${blockId}`)
  return found
}

const contentTypeOf = (editor: Editor, blockId: string) => rootOf(editor, blockId).firstChild?.type.name

function revisionMarkCount(editor: Editor): number {
  let count = 0
  editor.state.doc.descendants(node => {
    if (node.marks.some(mark => mark.type.name === 'revisionMark')) count += 1
  })
  return count
}

/** 后端接受水平分割线时使用的正式物化结果；Editor 预览必须与它同构。 */
function backendRuleContent(): JSONContent {
  const docJson = convertBlockEventsToDocJson([{ block_type: 'HorizontalRuleBlock' }])
  const content = docJson?.content?.[0]?.content?.[0]
  if (!content) throw new Error('后端未物化水平分割线')
  return content as JSONContent
}

/** 与后端一致：只有内部是空 baseBlock 的 rootBlock 才是尚未落入正文的 insert 占位。 */
const isEmptyPlaceholder = (node: JSONContent) =>
  node.content?.[0]?.type === 'baseBlock' && !node.content[0].content?.length

/** 模拟后端提交：保存本地基线；拒绝 insert 清理空占位，接受时写入后端物化的分割线。 */
function backendCommit(mode: 'accept' | 'reject', insertIds: readonly string[], acceptedRule?: JSONContent) {
  return async (request: MarkdownRevisionCommit) => {
    const content = structuredClone(request.baseline) as JSONContent
    if (mode === 'reject') {
      content.content = content.content?.filter(
        node => !(insertIds.includes(String(node.attrs?.id)) && isEmptyPlaceholder(node)),
      )
    } else if (acceptedRule) {
      for (const node of content.content ?? []) {
        if (insertIds.includes(String(node.attrs?.id))) node.content = [acceptedRule]
      }
    }
    return { success: true, data: snapshot(content, [], 2) }
  }
}

const editors: Editor[] = []
function createEditor(): Editor {
  setActivePinia(createPinia())
  const editor = new Editor({
    extensions: getAllExtensions({ layoutManagerInstance: ref(null), findReplaceStore: null }),
    content: documentOf(root('seed', paragraph('seed'))),
  })
  editors.push(editor)
  return editor
}

async function open(editor: Editor, data: MarkdownRevisionSnapshot, documentId = 'doc-a') {
  mocks.read.mockResolvedValueOnce({ success: true, data })
  const session = beginMarkdownDocumentSession(editor, documentId, {
    setDirty: vi.fn(),
    reportError: vi.fn(),
  })
  await loadMarkdownDocumentSession(editor, session)
  return session
}

const HORIZONTAL_RULE_WARNING = /HorizontalRule|水平分割线|inline projection 为空|暂未接入 pending canonical block|未找到 contentBlock/

let warnings: MockInstance<typeof console.warn>
beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockReset()
  mocks.commit.mockReset()
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  vi.restoreAllMocks()
})

function expectNoHorizontalRuleWarnings(): void {
  const messages = warnings.mock.calls
    .map(args => args.map(String).join(' '))
    .filter(message => HORIZONTAL_RULE_WARNING.test(message))
  expect(messages).toEqual([])
}

const baseline = documentOf(
  root('anchor', paragraph('anchor', '前文')),
  root('ins', paragraph('ins')),
  root('upd', paragraph('upd', '旧段落')),
  root('same', rule('same')),
  root('rev', rule('rev')),
  root('del', rule('del')),
  root('tail', paragraph('tail', '后文')),
)

const allPendings = [
  pending('p-ins', 'ins', 'insert', '---', 'anchor'),
  pending('p-upd', 'upd', 'update', '***'),
  pending('p-same', 'same', 'update', '___'),
  pending('p-rev', 'rev', 'update', '新段落'),
  pending('p-del', 'del', 'delete', ''),
]

describe('水平分割线 Pending 在生产 schema 下的预览', () => {
  it('insert：占位块物化为 rootBlock -> horizontalRuleBlock，不生成文字、不打行内标记', async () => {
    const editor = createEditor()
    await open(editor, snapshot(baseline, [pending('p-ins', 'ins', 'insert', '---', 'anchor')]))

    expect(contentTypeOf(editor, 'ins')).toBe('horizontalRuleBlock')
    expect(rootOf(editor, 'ins').textContent).toBe('')
    expect(revisionMarkCount(editor)).toBe(0)
    expect(useRevisionStore(editor).getCanonicalSession('ins')).toMatchObject({
      projection: 'ready',
      diffStats: { insertCount: 1, deleteCount: 0 },
    })
    expectNoHorizontalRuleWarnings()
  })

  it('insert：分割线与后续段落在同一批新增中各按自己的类型投影', async () => {
    const editor = createEditor()
    const withTwoPlaceholders = documentOf(
      root('anchor', paragraph('anchor', '前文')),
      root('ins-rule', paragraph('ins-rule')),
      root('ins-text', paragraph('ins-text')),
    )
    await open(editor, snapshot(withTwoPlaceholders, [
      { ...pending('p-rule', 'ins-rule', 'insert', '---', 'anchor'), createdAt: 1 },
      { ...pending('p-text', 'ins-text', 'insert', '分割线之后的段落', 'anchor'), createdAt: 2 },
    ]))

    expect(contentTypeOf(editor, 'ins-rule')).toBe('horizontalRuleBlock')
    expect(rootOf(editor, 'ins-rule').textContent).toBe('')
    expect(contentTypeOf(editor, 'ins-text')).toBe('baseBlock')
    expect(rootOf(editor, 'ins-text').textContent).toBe('分割线之后的段落')
    // 只有真正的文字被打上插入标记；分割线整块不带任何行内标记。
    expect(revisionMarkCount(editor)).toBe(1)
    expectNoHorizontalRuleWarnings()
  })

  it('update：普通段落整块换成分割线并计一次删除；本来就是分割线则不改动、不登记', async () => {
    const editor = createEditor()
    await open(editor, snapshot(baseline, [
      pending('p-upd', 'upd', 'update', '***'),
      pending('p-same', 'same', 'update', '___'),
    ]))
    const sameBefore = rootOf(editor, 'same')

    expect(contentTypeOf(editor, 'upd')).toBe('horizontalRuleBlock')
    expect(rootOf(editor, 'upd').textContent).toBe('')
    expect(useRevisionStore(editor).getCanonicalSession('upd')).toMatchObject({
      projection: 'ready',
      diffStats: { insertCount: 1, deleteCount: 1 },
    })

    expect(rootOf(editor, 'same').eq(sameBefore)).toBe(true)
    expect(contentTypeOf(editor, 'same')).toBe('horizontalRuleBlock')
    expect(useRevisionStore(editor).getCanonicalSession('same')).toMatchObject({ projection: 'ready' })
    expect(useRevisionStore(editor).getCanonicalSession('same')?.diffStats).toBeUndefined()
    expect(revisionMarkCount(editor)).toBe(0)
    expectNoHorizontalRuleWarnings()
  })

  it('update：当前是分割线、提议是文字时转换为文本块并以插入标记显示，不静默丢失', async () => {
    const editor = createEditor()
    await open(editor, snapshot(baseline, [pending('p-rev', 'rev', 'update', '新段落')]))

    expect(contentTypeOf(editor, 'rev')).toBe('baseBlock')
    expect(rootOf(editor, 'rev').textContent).toBe('新段落')
    expect(revisionMarkCount(editor)).toBe(1)
    expect(useRevisionStore(editor).getCanonicalSession('rev')).toMatchObject({
      projection: 'ready',
      diffStats: { insertCount: 1, deleteCount: 0 },
    })
    expectNoHorizontalRuleWarnings()
  })

  it('delete：分割线保持原样，登记一次整块删除，而不是被当作“内容已为空”', async () => {
    const editor = createEditor()
    await open(editor, snapshot(baseline, [pending('p-del', 'del', 'delete', '')]))

    expect(contentTypeOf(editor, 'del')).toBe('horizontalRuleBlock')
    expect(revisionMarkCount(editor)).toBe(0)
    expect(useRevisionStore(editor).getCanonicalSession('del')).toMatchObject({
      projection: 'ready',
      diffStats: { insertCount: 0, deleteCount: 1 },
    })
    expectNoHorizontalRuleWarnings()
  })

  it('预览结构与后端接受后的结构一致（新增与替换都是同一个 horizontalRuleBlock）', async () => {
    const editor = createEditor()
    await open(editor, snapshot(baseline, [
      pending('p-ins', 'ins', 'insert', '---', 'anchor'),
      pending('p-upd', 'upd', 'update', '***'),
    ]))

    const accepted = stripIds(backendRuleContent())
    expect(stripIds(rootOf(editor, 'ins').firstChild?.toJSON())).toEqual(accepted)
    expect(stripIds(rootOf(editor, 'upd').firstChild?.toJSON())).toEqual(accepted)
  })
})

describe('水平分割线 Pending 的拒绝、接受与重开', () => {
  it('拒绝：提交给后端的基线与打开时的正文完全一致，决策后只剩原正文', async () => {
    const editor = createEditor()
    await open(editor, snapshot(baseline, allPendings))
    const original = parseEditorDocumentJson(baseline, editor.schema).toJSON()

    mocks.commit.mockImplementation(backendCommit('reject', ['ins']))
    await useRevisionStore(editor).rejectAllRevisionsInDocument()

    const request: MarkdownRevisionCommit = mocks.commit.mock.calls[0]?.[0]
    expect(request.decision).toEqual({ mode: 'reject' })
    expect(request.baseline).toEqual(original)
    // 新增占位被后端清理，其余块回到打开时的结构：分割线仍是分割线，段落仍是段落。
    expect(editor.state.doc.childCount).toBe(original.content!.length - 1)
    expect(contentTypeOf(editor, 'upd')).toBe('baseBlock')
    expect(rootOf(editor, 'upd').textContent).toBe('旧段落')
    expect(contentTypeOf(editor, 'rev')).toBe('horizontalRuleBlock')
    expect(contentTypeOf(editor, 'del')).toBe('horizontalRuleBlock')
    expect(revisionMarkCount(editor)).toBe(0)
    expect(useRevisionStore(editor).canonicalPendingBlockCount.value).toBe(0)
  })

  it('接受：提交基线与原正文一致，后端物化的分割线与预览同构', async () => {
    const editor = createEditor()
    await open(editor, snapshot(baseline, [pending('p-ins', 'ins', 'insert', '---', 'anchor')]))
    const original = parseEditorDocumentJson(baseline, editor.schema).toJSON()
    const preview = stripIds(rootOf(editor, 'ins').firstChild?.toJSON())

    mocks.commit.mockImplementation(backendCommit('accept', ['ins'], backendRuleContent()))
    await useRevisionStore(editor).acceptAllRevisions('ins')

    const request: MarkdownRevisionCommit = mocks.commit.mock.calls[0]?.[0]
    expect(request.decision).toEqual({ mode: 'accept', blockId: 'ins' })
    expect(request.baseline).toEqual(original)
    expect(contentTypeOf(editor, 'ins')).toBe('horizontalRuleBlock')
    expect(stripIds(rootOf(editor, 'ins').firstChild?.toJSON())).toEqual(preview)
    expect(useRevisionStore(editor).canonicalPendingBlockCount.value).toBe(0)
  })

  it('重开：同一份快照在新的 Editor、以及同一 Editor 重新打开时得到相同的预览结构', async () => {
    const data = snapshot(baseline, allPendings)
    const first = createEditor()
    await open(first, data)
    const preview = stripIds(first.state.doc.toJSON())

    const second = createEditor()
    await open(second, data)
    expect(stripIds(second.state.doc.toJSON())).toEqual(preview)

    await open(first, data)
    expect(stripIds(first.state.doc.toJSON())).toEqual(preview)

    for (const editor of [first, second]) {
      expect(contentTypeOf(editor, 'ins')).toBe('horizontalRuleBlock')
      expect(contentTypeOf(editor, 'upd')).toBe('horizontalRuleBlock')
      expect(contentTypeOf(editor, 'same')).toBe('horizontalRuleBlock')
      expect(contentTypeOf(editor, 'rev')).toBe('baseBlock')
      expect(contentTypeOf(editor, 'del')).toBe('horizontalRuleBlock')
    }
    expectNoHorizontalRuleWarnings()
  })
})
