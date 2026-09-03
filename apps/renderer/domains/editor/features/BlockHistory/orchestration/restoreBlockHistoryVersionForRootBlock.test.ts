// @vitest-environment jsdom

import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Node } from '@tiptap/core'
import { Editor as VueTiptapEditor } from '@tiptap/vue-3'
import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockVersion, CreateBlockVersionParams } from '../../../../../shared/ipc/blockHistoryGateway'
import type { BlockHistoryStore, BlockHistoryUiState } from '../store/useBlockHistoryStore'
import { restoreBlockHistoryVersionForRootBlock } from './restoreBlockHistoryVersionForRootBlock'

const RootBlock = Node.create({
  name: 'rootBlock',
  group: 'block',
  content: 'paragraph',

  addAttributes() {
    return {
      id: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-id': HTMLAttributes.id }, 0]
  },
})

const editors: VueTiptapEditor[] = []

function createEditor(): VueTiptapEditor {
  const editor = new VueTiptapEditor({
    extensions: [
      Document.extend({
        content: 'rootBlock+',
      }),
      RootBlock,
      Paragraph,
      Text,
    ],
    content: {
      type: 'doc',
      content: [
        {
          type: 'rootBlock',
          attrs: { id: 'root-a' },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'current content' }],
            },
          ],
        },
      ],
    },
  })
  editors.push(editor)
  return editor
}

function createContentJson(text: string): string {
  return JSON.stringify({
    type: 'rootBlock',
    attrs: { id: 'root-a' },
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  })
}

function createVersion(patch: Partial<BlockVersion> = {}): BlockVersion {
  return {
    id: 'version-a',
    document_node_id: 'doc-a',
    target_block_id: 'root-a',
    block_type: 'rootBlock',
    version_number: 1,
    content_json: createContentJson('restored content'),
    origin_type: 'manual',
    origin_metadata: null,
    created_at: 1779200000000,
    ...patch,
  }
}

function createDefaultUiState(): BlockHistoryUiState {
  return {
    mode: 'none',
    selectedVersionId: undefined,
    selectedVersionIds: undefined,
    focusedLineIndex: undefined,
    isLoading: false,
  }
}

function createStore(versions: readonly BlockVersion[]): BlockHistoryStore & {
  createVersionSpy: ReturnType<typeof vi.fn<[CreateBlockVersionParams], Promise<BlockVersion | null>>>
  exitHistoryModeSpy: ReturnType<typeof vi.fn<[string], void>>
} {
  const versionsByBlock = ref<Record<string, BlockVersion[]>>({
    'root-a': [...versions],
  })
  const uiStateByBlock = ref<Record<string, BlockHistoryUiState>>({})

  const createVersionSpy = vi.fn<[CreateBlockVersionParams], Promise<BlockVersion | null>>(
    async (params) => {
      const version = createVersion({
        id: 'created-current-version',
        content_json: params.contentJson,
        origin_type: params.originType,
      })
      versionsByBlock.value[params.targetBlockId] = [
        ...(versionsByBlock.value[params.targetBlockId] ?? []),
        version,
      ]
      return version
    }
  )
  const exitHistoryModeSpy = vi.fn<[string], void>()

  return {
    versionsByBlock,
    uiStateByBlock,
    hasAnyHistoryMode: computed(() => false),
    loadBlockHistory: vi.fn(async () => undefined),
    getVersions: vi.fn((blockId: string) => versionsByBlock.value[blockId] ?? []),
    getUiState: vi.fn((blockId: string) => uiStateByBlock.value[blockId] ?? createDefaultUiState()),
    setViewMode: vi.fn(),
    selectVersion: vi.fn(),
    selectMultipleVersions: vi.fn(),
    setFocusedLineIndex: vi.fn(),
    restoreVersion: vi.fn(async () => null),
    createVersion: createVersionSpy,
    exitHistoryMode: exitHistoryModeSpy,
    clearBlockHistory: vi.fn(),
    isInHistoryMode: vi.fn(() => false),
    deleteVersion: vi.fn(async () => undefined),
    createVersionSpy,
    exitHistoryModeSpy,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  while (editors.length > 0) {
    editors.pop()?.destroy()
  }
})

describe('restoreBlockHistoryVersionForRootBlock', () => {
  it('将当前 rootBlock 内容替换为指定历史版本内容', async () => {
    const editor = createEditor()
    const store = createStore([createVersion()])

    const result = await restoreBlockHistoryVersionForRootBlock({
      editor,
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      versionId: 'version-a',
      mode: 'discard-current',
      currentContentJson: createContentJson('current content'),
      getRootBlockPos: () => 0,
      store,
    })

    expect(result).toEqual({ ok: true, appliedVersionId: 'version-a' })
    expect(editor.state.doc.firstChild?.textContent).toBe('restored content')
    expect(store.createVersionSpy).not.toHaveBeenCalled()
    expect(store.exitHistoryModeSpy).toHaveBeenCalledWith('root-a')
  })

  it('用户选择保存当前内容时，先创建当前快照再恢复目标版本', async () => {
    const editor = createEditor()
    const store = createStore([createVersion()])
    const currentContentJson = createContentJson('current content')

    const result = await restoreBlockHistoryVersionForRootBlock({
      editor,
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      versionId: 'version-a',
      mode: 'create-current-snapshot',
      currentContentJson,
      getRootBlockPos: () => 0,
      store,
    })

    expect(result.ok).toBe(true)
    expect(store.createVersionSpy).toHaveBeenCalledWith({
      documentNodeId: 'doc-a',
      targetBlockId: 'root-a',
      blockType: 'rootBlock',
      contentJson: currentContentJson,
      originType: 'manual',
    })
    expect(editor.state.doc.firstChild?.textContent).toBe('restored content')
  })

  it('找不到版本或当前位置失效时返回明确失败原因', async () => {
    const editor = createEditor()

    await expect(restoreBlockHistoryVersionForRootBlock({
      editor,
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      versionId: 'missing-version',
      mode: 'discard-current',
      currentContentJson: createContentJson('current content'),
      getRootBlockPos: () => 0,
      store: createStore([createVersion()]),
    })).resolves.toEqual({ ok: false, reason: 'missing-version' })

    await expect(restoreBlockHistoryVersionForRootBlock({
      editor,
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      versionId: 'version-a',
      mode: 'discard-current',
      currentContentJson: createContentJson('current content'),
      getRootBlockPos: () => null,
      store: createStore([createVersion()]),
    })).resolves.toEqual({ ok: false, reason: 'missing-root-block-position' })
  })
})
