// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { workspaceMarkdownSchemaLite as schema } from 'src/domains/markdown'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { admitMarkdownChartSpec } from '@app/schemas'

const fakeStore = vi.hoisted(() => ({
  sessions: new Map<string, { operation: 'insert' | 'update' | 'delete'; projection: 'deferred' | 'ready' | 'failed' }>(),
  baselines: new Map<string, unknown>(),
}))

vi.mock('../../../features/Revision/useRevisionStore', () => ({
  useRevisionStore: () => ({
    getCanonicalSession: (id: string) => fakeStore.sessions.get(id) ?? null,
    readProjectionBaseline: (id: string) => fakeStore.baselines.get(id) ?? null,
  }),
}))

import { useChartRevisionView } from './useChartRevisionView'

const admission = admitMarkdownChartSpec({ chartType: 'bar', title: '原图', categories: ['A'], series: [{ name: 'S', values: [1] }] })
if (!admission.ok) throw new Error('fixture invalid')

function baselineRoot(contentType: string, spec?: unknown): ProseMirrorNode {
  const content = schema.nodes[contentType]!.create(spec ? { spec } : null)
  return schema.nodes['rootBlock']!.create(null, content)
}

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()))
function setup(rootBlockId: string | null) {
  const editor = new Editor({ extensions: [Document, Paragraph, Text] })
  editors.push(editor)
  return useChartRevisionView({ editor, rootBlockId: ref(rootBlockId) })
}

describe('useChartRevisionView', () => {
  it('没有未决修订时与普通图表一致', () => {
    fakeStore.sessions.clear()
    fakeStore.baselines.clear()

    const { revision } = setup('root-1')

    expect(revision.value).toMatchObject({ pending: false, badge: null, editable: true })
  })

  it('节点脱离文档（没有 rootBlock id）时不报修订', () => {
    fakeStore.sessions.set('root-1', { operation: 'update', projection: 'ready' })

    expect(setup(null).revision.value.pending).toBe(false)
  })

  it('update 已投影：读取账本中的原图表，切换后展示它', () => {
    fakeStore.sessions.clear()
    fakeStore.sessions.set('root-1', { operation: 'update', projection: 'ready' })
    fakeStore.baselines.set('root-1', baselineRoot('chartBlock', admission.spec))

    const { revision, baselineSpec, showingBaseline, toggleBaseline } = setup('root-1')

    expect(revision.value).toMatchObject({ badge: 'proposed', canToggleBaseline: true, displaysBaseline: false })
    expect(baselineSpec.value?.title).toBe('原图')
    toggleBaseline()
    expect(showingBaseline.value).toBe(true)
    expect(revision.value).toMatchObject({ displaysBaseline: true, readingVariant: 'baseline' })
  })

  it('原内容不是图表：切换后提示而不展示图', () => {
    fakeStore.sessions.clear()
    fakeStore.sessions.set('root-1', { operation: 'update', projection: 'ready' })
    fakeStore.baselines.set('root-1', baselineRoot('baseBlock'))

    const { revision, baselineSpec, toggleBaseline } = setup('root-1')
    toggleBaseline()

    expect(baselineSpec.value).toBeNull()
    expect(revision.value).toMatchObject({ canToggleBaseline: true, displaysBaseline: false, showBaselineNote: true })
  })

  it('delete：标注待删除，不提供原内容对照', () => {
    fakeStore.sessions.clear()
    fakeStore.sessions.set('root-1', { operation: 'delete', projection: 'ready' })

    expect(setup('root-1').revision.value).toMatchObject({ badge: 'deleted', canToggleBaseline: false, editable: false })
  })
})
