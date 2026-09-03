import { Schema } from 'prosemirror-model'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { CellSelection } from '@tiptap/pm/tables'
import { describe, expect, it } from 'vitest'
import {
  createRenderVirtualizationPlugin,
  findSelectionRootBlockId,
  getRenderVirtualizationState,
  isRootBlockHydratedByVirtualizationState,
  prepareInitialRenderVirtualizationState,
  renderVirtualizationPluginKey,
  type RenderVirtualizationMeta,
} from './renderVirtualizationPlugin'

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'paragraph | imageBlock | table',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    imageBlock: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { id: { default: null } },
      toDOM: (node) => ['img', { 'data-block-id': node.attrs.id }],
      parseDOM: [{ tag: 'img[data-block-id]' }],
    },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    table: {
      group: 'block',
      content: 'tableRow+',
      tableRole: 'table',
      toDOM: () => ['table', ['tbody', 0]],
      parseDOM: [{ tag: 'table' }],
    },
    tableRow: {
      content: 'tableCell+',
      tableRole: 'row',
      toDOM: () => ['tr', 0],
      parseDOM: [{ tag: 'tr' }],
    },
    tableCell: {
      content: 'paragraph',
      tableRole: 'cell',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        colwidth: { default: null },
      },
      toDOM: () => ['td', 0],
      parseDOM: [{ tag: 'td' }],
    },
  },
})

function createDoc(blockIds: string[]) {
  return schema.nodes.doc.create(
    null,
    blockIds.map((id) =>
      schema.nodes.rootBlock.create(
        { id },
        schema.nodes.paragraph.create(null, schema.text(id))
      )
    )
  )
}

function createDocWithImageBlock(): import('prosemirror-model').Node {
  return schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create(
      { id: 'image-root' },
      schema.nodes.imageBlock.create({ id: 'image-content' })
    ),
    schema.nodes.rootBlock.create(
      { id: 'text-root' },
      schema.nodes.paragraph.create(null, schema.text('text-root'))
    ),
  ])
}

function createDocWithTableBlock(): import('prosemirror-model').Node {
  const createCell = (text: string) =>
    schema.nodes.tableCell.create(
      null,
      schema.nodes.paragraph.create(null, schema.text(text))
    )

  const table = schema.nodes.table.create(null, [
    schema.nodes.tableRow.create(null, [
      createCell('A1'),
      createCell('B1'),
    ]),
    schema.nodes.tableRow.create(null, [
      createCell('A2'),
      createCell('B2'),
    ]),
  ])

  return schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'table-root' }, table),
    schema.nodes.rootBlock.create(
      { id: 'text-root' },
      schema.nodes.paragraph.create(null, schema.text('text-root'))
    ),
  ])
}

function createImageState(): EditorState {
  return EditorState.create({
    schema,
    doc: createDocWithImageBlock(),
    plugins: [createRenderVirtualizationPlugin()],
  })
}

function createTableState(): EditorState {
  return EditorState.create({
    schema,
    doc: createDocWithTableBlock(),
    plugins: [createRenderVirtualizationPlugin()],
  })
}

function createState(blockIds: string[]): EditorState {
  return EditorState.create({
    schema,
    doc: createDoc(blockIds),
    plugins: [createRenderVirtualizationPlugin()],
  })
}

function applyMeta(state: EditorState, meta: RenderVirtualizationMeta): EditorState {
  return state.apply(state.tr.setMeta(renderVirtualizationPluginKey, meta))
}

function findTextPosForBlockId(state: EditorState, blockId: string): number {
  let rootBlockStart: number | null = null
  let textPos: number | null = null

  state.doc.descendants((node, pos) => {
    if (node.type.name === 'rootBlock') {
      rootBlockStart = node.attrs.id === blockId ? pos : null
      return rootBlockStart !== null
    }

    if (rootBlockStart !== null && node.isText && textPos === null) {
      textPos = pos
      return false
    }

    return true
  })

  if (textPos === null) {
    throw new Error(`未找到 ${blockId} 的文本位置`)
  }
  return textPos
}

describe('renderVirtualizationPlugin', () => {
  it('starts disabled without decorations', () => {
    const state = createState(['block-a', 'block-b'])
    const pluginState = getRenderVirtualizationState(state)

    expect(pluginState?.enabled).toBe(false)
    expect(pluginState?.decorations.find().length).toBe(0)
  })

  it('throws on malformed render virtualization meta instead of silently dropping it', () => {
    const state = createState(['block-a'])

    expect(() => state.apply(
      state.tr.setMeta(renderVirtualizationPluginKey, {
        setEnabled: true,
        hydrate: 'block-a',
      })
    )).toThrow('[RenderVirtualization] meta.hydrate 必须是 string[]')
  })

  it('exposes runtime read-only set snapshots from plugin state', () => {
    const state = applyMeta(createState(['block-a']), {
      setEnabled: true,
      hydrate: ['block-a'],
    })
    const pluginState = getRenderVirtualizationState(state)

    expect(pluginState?.hydratedSet.has('block-a')).toBe(true)
    expect('add' in (pluginState?.hydratedSet ?? new Set())).toBe(false)
  })

  it('creates hydrated decorations only for hydrated or pinned blocks', () => {
    let state = createState(['block-a', 'block-b', 'block-c'])

    state = applyMeta(state, {
      setEnabled: true,
      hydrate: ['block-a'],
      pin: ['block-c'],
    })

    const pluginState = getRenderVirtualizationState(state)
    const decorations = pluginState?.decorations.find() ?? []

    expect(pluginState?.enabled).toBe(true)
    expect(decorations).toHaveLength(2)
    expect(decorations.map((decoration) => decoration.spec.blockId).sort()).toEqual([
      'block-a',
      'block-c',
    ])
  })

  it('lets hydrate win when a block is both hydrated and dehydrated in the same render meta', () => {
    let state = applyMeta(createState(['block-a', 'block-b']), {
      setEnabled: true,
      hydrate: ['block-a'],
    })

    state = applyMeta(state, {
      hydrate: ['block-b'],
      dehydrate: ['block-a', 'block-b'],
    })

    const pluginState = getRenderVirtualizationState(state)

    expect(pluginState?.hydratedSet.has('block-a')).toBe(false)
    expect(pluginState?.hydratedSet.has('block-b')).toBe(true)
    expect([...(pluginState?.hydratedSet ?? [])]).toEqual(['block-b'])
  })

  it('does not keep a plugin-only selection block hydrated after explicit hydrate/pin are removed', () => {
    let state = createState(['block-a', 'block-b'])

    state = applyMeta(state, {
      setEnabled: true,
      hydrate: ['block-a'],
      pin: ['block-b'],
    })
    state = applyMeta(state, {
      dehydrate: ['block-a'],
      unpin: ['block-b'],
    })

    const pluginState = getRenderVirtualizationState(state)

    expect(findSelectionRootBlockId(state)).toBe('block-a')
    expect(pluginState?.decorations.find()).toHaveLength(0)
    expect(isRootBlockHydratedByVirtualizationState(state, 'block-a')).toBe(false)
    expect(isRootBlockHydratedByVirtualizationState(state, 'block-b')).toBe(false)
  })

  it('prepares initial enabled state before the first direct-state view update', () => {
    const state = createState(['block-a', 'block-b', 'block-c'])

    const preparedState = prepareInitialRenderVirtualizationState(state, {
      enabled: true,
      initialHydratedBlockCount: 2,
    })
    const pluginState = getRenderVirtualizationState(preparedState)

    expect(pluginState?.enabled).toBe(true)
    expect([...(pluginState?.hydratedSet ?? [])]).toEqual(['block-a', 'block-b'])
    expect(pluginState?.decorations.find()).toHaveLength(2)
  })

  it('keeps selection lookup pure without mutating plugin keep-alive state', () => {
    let state = prepareInitialRenderVirtualizationState(createState(['block-a', 'block-b']), {
      enabled: true,
      initialHydratedBlockCount: 0,
    })

    const secondBlockTextPos = findTextPosForBlockId(state, 'block-b')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, secondBlockTextPos)))

    const pluginState = getRenderVirtualizationState(state)

    expect(findSelectionRootBlockId(state)).toBe('block-b')
    expect(isRootBlockHydratedByVirtualizationState(state, 'block-b')).toBe(false)
    expect(pluginState?.decorations.find()).toHaveLength(0)
  })

  it('reuses decorations when the selection moves without render meta changes', () => {
    let state = applyMeta(createState(['block-a', 'block-b']), {
      setEnabled: true,
      hydrate: ['block-b'],
    })
    const firstPluginState = getRenderVirtualizationState(state)
    const textPos = findTextPosForBlockId(state, 'block-a')

    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, textPos + 1)))
    const secondPluginState = getRenderVirtualizationState(state)

    expect(findSelectionRootBlockId(state)).toBe('block-a')
    expect(secondPluginState?.decorations).toBe(firstPluginState?.decorations)
  })

  it('finds the containing rootBlock for inner NodeSelection nodes such as imageBlock', () => {
    let state = prepareInitialRenderVirtualizationState(createImageState(), {
      enabled: true,
      initialHydratedBlockCount: 0,
    })

    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 1)))

    const pluginState = getRenderVirtualizationState(state)

    expect(findSelectionRootBlockId(state)).toBe('image-root')
    expect(isRootBlockHydratedByVirtualizationState(state, 'image-root')).toBe(false)
    expect(isRootBlockHydratedByVirtualizationState(state, 'text-root')).toBe(false)
    expect(pluginState?.decorations.find()).toHaveLength(0)
  })

  it('finds the containing rootBlock for table CellSelection', () => {
    let state = prepareInitialRenderVirtualizationState(createTableState(), {
      enabled: true,
      initialHydratedBlockCount: 0,
    })

    // 中文说明：第一个 rootBlock 从 0 开始，table 从 1 开始，第一行两个 tableCell 分别从 3 / 9 开始。
    state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, 3, 9)))

    const pluginState = getRenderVirtualizationState(state)

    expect(findSelectionRootBlockId(state)).toBe('table-root')
    expect(isRootBlockHydratedByVirtualizationState(state, 'table-root')).toBe(false)
    expect(isRootBlockHydratedByVirtualizationState(state, 'text-root')).toBe(false)
    expect(pluginState?.decorations.find()).toHaveLength(0)
  })

  it('drops decorations for stale active ids after a rootBlock is deleted', () => {
    let state = applyMeta(createState(['block-a', 'block-b']), {
      setEnabled: true,
      hydrate: ['block-a', 'block-b'],
    })

    const firstBlock = state.doc.nodeAt(0)
    if (!firstBlock) throw new Error('测试文档缺少第一个 rootBlock')
    state = state.apply(state.tr.delete(0, firstBlock.nodeSize))

    const pluginState = getRenderVirtualizationState(state)

    expect(pluginState?.hydratedSet.has('block-a')).toBe(true)
    expect(pluginState?.decorations.find().map((decoration) => decoration.spec.blockId)).toEqual([
      'block-b',
    ])
  })
})
