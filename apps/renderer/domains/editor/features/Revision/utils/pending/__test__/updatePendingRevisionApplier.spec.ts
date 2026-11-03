import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'

import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'

const {
  resolvePendingMarkdownForSingleBlock,
} = vi.hoisted(() => ({
  resolvePendingMarkdownForSingleBlock: vi.fn(),
}))

const {
  parsePendingMarkdownToInlineProjection,
} = vi.hoisted(() => ({
  parsePendingMarkdownToInlineProjection: vi.fn(),
}))

const {
  processCitationHydration,
  attachCitationHydrationToSpans,
} = vi.hoisted(() => ({
  processCitationHydration: vi.fn(),
  attachCitationHydrationToSpans: vi.fn(),
}))

const {
  useRevisionStore,
} = vi.hoisted(() => ({
  useRevisionStore: vi.fn(),
}))

vi.mock('../pendingRevisionHelpers', async () => {
  const actual = await vi.importActual<typeof import('../pendingRevisionHelpers')>(
    '../pendingRevisionHelpers'
  )

  return {
    ...actual,
    resolvePendingMarkdownForSingleBlock,
  }
})

vi.mock('../pendingMarkdownRuntime', () => ({
  parsePendingMarkdownToInlineProjection,
}))

vi.mock('../citationHydrationHelper', () => ({
  processCitationHydration,
  attachCitationHydrationToSpans,
}))

vi.mock('../../../useRevisionStore', () => ({
  useRevisionStore,
}))

import {
  batchApplyNonInsertPendingRevisions,
  batchApplyUpdatePendingRevisions,
} from '../updatePendingRevisionApplier'
import type { PendingMarkdownResolutionResult } from '../pendingRevisionHelpers'

function createMockEditor(docNode: ReturnType<typeof workspaceMarkdownSchemaLite.node>) {
  let state = EditorState.create({
    schema: workspaceMarkdownSchemaLite,
    doc: docNode,
  })
  let dispatchCount = 0

  const editor: any = {
    state,
    view: {
      dispatch(tr: any) {
        dispatchCount += 1
        state = state.apply(tr)
        editor.state = state
      },
    },
    get dispatchCount() {
      return dispatchCount
    },
  }

  return editor
}

function createDoc() {
  return workspaceMarkdownSchemaLite.node('doc', null, [
    workspaceMarkdownSchemaLite.node(
      'rootBlock',
      { id: 'block-1' },
      [
        workspaceMarkdownSchemaLite.node('baseBlock', { id: 'base-1', blockType: 'base' }, []),
      ]
    ),
    workspaceMarkdownSchemaLite.node(
      'rootBlock',
      { id: 'block-2' },
      [
        workspaceMarkdownSchemaLite.node('baseBlock', { id: 'base-2', blockType: 'base' }, [
          workspaceMarkdownSchemaLite.text('旧内容'),
        ]),
      ]
    ),
  ])
}

function createTableRows() {
  const schema = workspaceMarkdownSchemaLite
  const makeCellContent = (text: string) =>
    schema.node('tableCellContentBlock', { id: `cell-${text}`, blockType: 'tableCellContent' }, [
      schema.text(text),
    ])

  return [
    schema.node('tableRow', null, [
      schema.node('tableHeader', { colwidth: [150] }, [makeCellContent('表头')]),
    ]),
    schema.node('tableRow', null, [
      schema.node('tableCell', { colwidth: [150] }, [makeCellContent('正文')]),
    ]),
  ]
}

function createRule(id: string) {
  return workspaceMarkdownSchemaLite.nodes.horizontalRuleBlock.create({
    id,
    blockType: 'horizontalRule',
  })
}

function createDocWithRule() {
  const doc = createDoc()
  return doc.copy(
    doc.content.addToEnd(
      workspaceMarkdownSchemaLite.node('rootBlock', { id: 'block-rule' }, [createRule('rule-1')])
    )
  )
}

describe('batchApplyUpdatePendingRevisions', () => {
  beforeEach(() => {
    vi.mocked(resolvePendingMarkdownForSingleBlock).mockReset()
    vi.mocked(parsePendingMarkdownToInlineProjection).mockReset()
    vi.mocked(processCitationHydration).mockReset()
    vi.mocked(attachCitationHydrationToSpans).mockReset()
    vi.mocked(useRevisionStore).mockReset()

    vi.mocked(processCitationHydration).mockImplementation(async (markdown: string) => ({
      markdown,
      hydration: null,
    }))
    vi.mocked(attachCitationHydrationToSpans).mockImplementation((spans: unknown) => spans)
    vi.mocked(parsePendingMarkdownToInlineProjection).mockResolvedValue({
      fragments: [],
      spans: [{ text: '表格回退文本', marks: [] }],
      plainText: '表格回退文本',
      newlineMode: 'hardBreak',
      sourceBlockCount: 1,
      droppedBlockCount: 0,
    })
    vi.mocked(useRevisionStore).mockReturnValue({
      startRevision: vi.fn(),
    } as any)
  })

  it('applies content updates and table history updates inside one transaction dispatch', async () => {
    const editor = createMockEditor(createDoc())
    const startRevision = vi.fn()
    vi.mocked(useRevisionStore).mockReturnValue({
      startRevision,
    } as unknown as ReturnType<typeof useRevisionStore>)

    vi.mocked(resolvePendingMarkdownForSingleBlock)
      .mockResolvedValueOnce({
        kind: 'content-block',
        source: 'runtime-single-block',
        contentType: 'baseBlock',
        blockAttrs: {},
        cleanMarkdown: '新内容',
        spans: [{ text: '新内容', marks: [] }],
      })
      .mockResolvedValueOnce({
        kind: 'table-block',
        source: 'runtime-single-block',
        tableRowsResult: {
          rows: createTableRows(),
          source: 'wasm-table-model',
        },
      })

    const result = await batchApplyUpdatePendingRevisions(editor, [
      {
        id: 'upd-1',
        conversationId: 'conv-1',
        blockId: 'block-1',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: '新内容',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
      {
        id: 'upd-2',
        conversationId: 'conv-1',
        blockId: 'block-2',
        operation: 'update',
        originalMarkdown: '旧内容',
        newMarkdown: '| 表头 |\n| --- |\n| 正文 |',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
    ])

    expect(result).toEqual([
      { id: 'upd-1', success: true, operation: 'update', blockId: 'block-1' },
      {
        id: 'upd-2',
        success: true,
        operation: 'update',
        blockId: 'block-2',
        reason: '已通过表格整块替换（保留旧表格历史）应用修订',
      },
    ])
    expect(editor.dispatchCount).toBe(1)
    expect(startRevision).toHaveBeenCalledTimes(2)

    const json = editor.state.doc.toJSON()
    expect((json.content?.[0] as any)?.content?.[0]?.content?.[0]).toEqual(
      expect.objectContaining({
        type: 'text',
        text: '新内容',
      })
    )
    expect((json.content?.[1] as any)?.attrs?.id).toBe('history-block-2-upd-2')
    expect((json.content?.[2] as any)?.content?.[0]?.type).toBe('table')
  })

  it('prepares unique block updates in parallel before applying one transaction', async () => {
    const editor = createMockEditor(createDoc())
    const startRevision = vi.fn()
    vi.mocked(useRevisionStore).mockReturnValue({
      startRevision,
    } as any)

    const pendingResolutions: Array<(value: PendingMarkdownResolutionResult) => void> = []
    vi.mocked(resolvePendingMarkdownForSingleBlock).mockImplementation(
      () => new Promise((resolve) => {
        pendingResolutions.push(resolve)
      })
    )

    const batchPromise = batchApplyUpdatePendingRevisions(editor, [
      {
        id: 'upd-1',
        conversationId: 'conv-1',
        blockId: 'block-1',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: '第一块',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
      {
        id: 'upd-2',
        conversationId: 'conv-1',
        blockId: 'block-2',
        operation: 'update',
        originalMarkdown: '旧内容',
        newMarkdown: '第二块',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
    ])

    await vi.waitFor(() => {
      expect(resolvePendingMarkdownForSingleBlock).toHaveBeenCalledTimes(2)
    })
    expect(editor.dispatchCount).toBe(0)

    pendingResolutions[0]?.({
      kind: 'content-block',
      source: 'runtime-single-block',
      contentType: 'baseBlock',
      blockAttrs: {},
      cleanMarkdown: '第一块',
      spans: [{ text: '第一块', marks: [] }],
    })
    pendingResolutions[1]?.({
      kind: 'content-block',
      source: 'runtime-single-block',
      contentType: 'baseBlock',
      blockAttrs: {},
      cleanMarkdown: '第二块',
      spans: [{ text: '第二块', marks: [] }],
    })

    const result = await batchPromise

    expect(result).toEqual([
      { id: 'upd-1', success: true, operation: 'update', blockId: 'block-1' },
      { id: 'upd-2', success: true, operation: 'update', blockId: 'block-2' },
    ])
    expect(editor.dispatchCount).toBe(1)
    expect(startRevision).toHaveBeenCalledTimes(2)
  })

  it('does not dispatch or register a revision when an update batch item has no diff', async () => {
    const editor = createMockEditor(createDoc())
    const startRevision = vi.fn()
    vi.mocked(useRevisionStore).mockReturnValue({
      startRevision,
    } as any)

    vi.mocked(resolvePendingMarkdownForSingleBlock).mockResolvedValueOnce({
      kind: 'content-block',
      source: 'runtime-single-block',
      contentType: 'baseBlock',
      blockAttrs: {},
      cleanMarkdown: '',
      spans: [],
    })

    const result = await batchApplyUpdatePendingRevisions(editor, [
      {
        id: 'upd-noop',
        conversationId: 'conv-1',
        blockId: 'block-1',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: '',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
    ])

    expect(result).toEqual([
      {
        id: 'upd-noop',
        success: true,
        operation: 'update',
        blockId: 'block-1',
        reason: '内容无差异，无需应用修订',
      },
    ])
    expect(editor.dispatchCount).toBe(0)
    expect(startRevision).not.toHaveBeenCalled()
  })

  it('reuses the evolving mega-transaction doc when the same block receives consecutive updates', async () => {
    const editor = createMockEditor(createDoc())
    const startRevision = vi.fn()
    vi.mocked(useRevisionStore).mockReturnValue({
      startRevision,
    } as any)

    vi.mocked(resolvePendingMarkdownForSingleBlock)
      .mockResolvedValueOnce({
        kind: 'content-block',
        source: 'runtime-single-block',
        contentType: 'baseBlock',
        blockAttrs: {},
        cleanMarkdown: '第一次',
        spans: [{ text: '第一次', marks: [] }],
      })
      .mockResolvedValueOnce({
        kind: 'content-block',
        source: 'runtime-single-block',
        contentType: 'baseBlock',
        blockAttrs: {},
        cleanMarkdown: '第二次',
        spans: [{ text: '第二次', marks: [] }],
      })

    const result = await batchApplyUpdatePendingRevisions(editor, [
      {
        id: 'upd-a1',
        conversationId: 'conv-1',
        blockId: 'block-1',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: '第一次',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
      {
        id: 'upd-a2',
        conversationId: 'conv-1',
        blockId: 'block-1',
        operation: 'update',
        originalMarkdown: '第一次',
        newMarkdown: '第二次',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
    ])

    expect(result).toEqual([
      { id: 'upd-a1', success: true, operation: 'update', blockId: 'block-1' },
      { id: 'upd-a2', success: true, operation: 'update', blockId: 'block-1' },
    ])
    expect(editor.dispatchCount).toBe(1)
    expect(startRevision).toHaveBeenCalledTimes(2)
    expect(resolvePendingMarkdownForSingleBlock).toHaveBeenCalledTimes(2)
  })

  it('batches delete together with updates inside one mega-transaction', async () => {
    const editor = createMockEditor(createDoc())
    const startRevision = vi.fn()
    vi.mocked(useRevisionStore).mockReturnValue({
      startRevision,
    } as any)

    vi.mocked(resolvePendingMarkdownForSingleBlock).mockResolvedValueOnce({
      kind: 'content-block',
      source: 'runtime-single-block',
      contentType: 'baseBlock',
      blockAttrs: {},
      cleanMarkdown: '更新后',
      spans: [{ text: '更新后', marks: [] }],
    })

    const result = await batchApplyNonInsertPendingRevisions(editor, [
      {
        id: 'upd-1',
        conversationId: 'conv-1',
        blockId: 'block-1',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: '更新后',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
      {
        id: 'del-2',
        conversationId: 'conv-1',
        blockId: 'block-2',
        operation: 'delete',
        originalMarkdown: '旧内容',
        newMarkdown: '',
        metadata: { operation: 'delete' },
        shouldRetry: false,
      },
    ])

    expect(result).toEqual([
      { id: 'upd-1', success: true, operation: 'update', blockId: 'block-1' },
      { id: 'del-2', success: true, operation: 'delete', blockId: 'block-2' },
    ])
    expect(editor.dispatchCount).toBe(1)
    expect(startRevision).toHaveBeenCalledTimes(2)
  })

  it('replaces blocks with an atomic block resolution inside one dispatch and counts whole blocks', async () => {
    const editor = createMockEditor(createDoc())
    const startRevision = vi.fn()
    vi.mocked(useRevisionStore).mockReturnValue({
      startRevision,
    } as unknown as ReturnType<typeof useRevisionStore>)

    vi.mocked(resolvePendingMarkdownForSingleBlock).mockImplementation(async () => ({
      kind: 'atomic-block',
      source: 'runtime-single-block',
      contentBlock: createRule('rule-new'),
    }))

    const result = await batchApplyNonInsertPendingRevisions(editor, [
      {
        id: 'upd-rule-1',
        conversationId: 'conv-1',
        blockId: 'block-1',
        operation: 'update',
        originalMarkdown: '',
        newMarkdown: '---',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
      {
        id: 'upd-rule-2',
        conversationId: 'conv-1',
        blockId: 'block-2',
        operation: 'update',
        originalMarkdown: '旧内容',
        newMarkdown: '***',
        metadata: { operation: 'update' },
        shouldRetry: false,
      },
    ])

    expect(result.map((detail) => [detail.id, detail.success])).toEqual([
      ['upd-rule-1', true],
      ['upd-rule-2', true],
    ])
    expect(editor.dispatchCount).toBe(1)
    const contentTypes: string[] = []
    editor.state.doc.forEach((root: ProseMirrorNode) => contentTypes.push(root.firstChild?.type.name ?? ''))
    expect(contentTypes).toEqual(['horizontalRuleBlock', 'horizontalRuleBlock'])
    expect(JSON.stringify(editor.state.doc.toJSON())).not.toContain('revisionMark')
    expect(startRevision.mock.calls.map(([params]) => [params.blockId, params.diffStats])).toEqual([
      ['block-1', { insertCount: 1, deleteCount: 0 }],
      ['block-2', { insertCount: 1, deleteCount: 1 }],
    ])
  })

  it.each([
    ['parallel preparation', [], 'batchApplyUpdatePendingRevisions.prepare'],
    // Several pendings on one block switch the batch to the serial path; the delete plan must match.
    ['serial path', ['upd-a', 'upd-b'], 'batchApplyUpdatePendingRevisions'],
  ] as const)(
    'registers one whole-block deletion for an atomic delete target without touching the document (%s)',
    async (_path, repeatedUpdateIds, resolveOperation) => {
      const editor = createMockEditor(createDocWithRule())
      const before = editor.state.doc
      const startRevision = vi.fn()
      vi.mocked(useRevisionStore).mockReturnValue({
      startRevision,
    } as unknown as ReturnType<typeof useRevisionStore>)
      vi.mocked(resolvePendingMarkdownForSingleBlock).mockResolvedValue({
        kind: 'content-block',
        source: 'runtime-single-block',
        contentType: 'baseBlock',
        blockAttrs: {},
        cleanMarkdown: '',
        spans: [],
      })

      const result = await batchApplyNonInsertPendingRevisions(editor, [
        {
          id: 'del-rule',
          conversationId: 'conv-1',
          blockId: 'block-rule',
          operation: 'delete',
          originalMarkdown: '---',
          newMarkdown: '',
          metadata: { operation: 'delete' },
          shouldRetry: false,
        },
        ...repeatedUpdateIds.map((id) => ({
          id,
          conversationId: 'conv-1',
          blockId: 'block-1',
          operation: 'update' as const,
          originalMarkdown: '',
          newMarkdown: '',
          metadata: { operation: 'update' },
          shouldRetry: false,
        })),
      ])

      expect(result.every((detail) => detail.success)).toBe(true)
      if (repeatedUpdateIds.length > 0) {
        expect(resolvePendingMarkdownForSingleBlock).toHaveBeenCalledWith(
          expect.anything(),
          '',
          expect.objectContaining({ operation: resolveOperation })
        )
      }
      expect(editor.dispatchCount).toBe(0)
      expect(editor.state.doc.eq(before)).toBe(true)
      expect(startRevision).toHaveBeenCalledTimes(1)
      expect(startRevision).toHaveBeenCalledWith({
        blockId: 'block-rule',
        revisionId: 'ai-del-rule',
        operation: 'delete',
        diffStats: { insertCount: 0, deleteCount: 1 },
        createdAt: undefined,
      })
    }
  )
})
