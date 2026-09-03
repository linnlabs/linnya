import { computed, nextTick, ref } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Editor } from '@tiptap/vue-3'
import { createPinia, setActivePinia } from 'pinia'
import type { BlockVersion } from '../../../../shared/ipc/blockHistoryGateway'
import type {
  BlockHistoryStore,
  BlockHistoryUiState,
} from '../../features/BlockHistory/store/useBlockHistoryStore'
import type { RestoreBlockHistoryVersionForRootBlockInput } from '../../features/BlockHistory/orchestration/restoreBlockHistoryVersionForRootBlock'
import { useBlockHistoryUi } from './useBlockHistoryUi'

const restoreBlockHistoryVersionForRootBlockMock = vi.fn()
const useBlockHistoryStoreMock = vi.fn()

vi.mock('../../../../shared/stores/file', () => ({
  useFileStore: () => ({
    currentFilePath: 'doc-a',
  }),
}))

vi.mock('../../features/BlockHistory/store/useBlockHistoryStore', () => ({
  useBlockHistoryStore: () => useBlockHistoryStoreMock(),
}))

vi.mock('../../features/BlockHistory/orchestration/restoreBlockHistoryVersionForRootBlock', () => ({
  restoreBlockHistoryVersionForRootBlock: (input: RestoreBlockHistoryVersionForRootBlockInput) =>
    restoreBlockHistoryVersionForRootBlockMock(input),
}))

function createVersion(contentJson: string): BlockVersion {
  return {
    id: 'version-a',
    document_node_id: 'doc-a',
    target_block_id: 'root-a',
    block_type: 'rootBlock',
    version_number: 1,
    content_json: contentJson,
    origin_type: 'manual',
    origin_metadata: null,
    created_at: 1779200000000,
  }
}

function createDefaultUiState(): BlockHistoryUiState {
  return {
    mode: 'side-by-side',
    selectedVersionId: 'version-a',
    selectedVersionIds: undefined,
    focusedLineIndex: undefined,
    isLoading: false,
  }
}

function createEmptyUiState(): BlockHistoryUiState {
  return {
    mode: 'none',
    selectedVersionId: undefined,
    selectedVersionIds: undefined,
    focusedLineIndex: undefined,
    isLoading: false,
  }
}

function createStore(versions: readonly BlockVersion[]): BlockHistoryStore {
  return {
    versionsByBlock: ref({ 'root-a': [...versions] }),
    uiStateByBlock: ref({ 'root-a': createDefaultUiState() }),
    hasAnyHistoryMode: computed(() => true),
    loadBlockHistory: vi.fn(async () => undefined),
    getVersions: vi.fn((blockId: string) => (blockId === 'root-a' ? [...versions] : [])),
    getUiState: vi.fn((blockId: string) =>
      blockId === 'root-a' ? createDefaultUiState() : createEmptyUiState()
    ),
    setViewMode: vi.fn(),
    selectVersion: vi.fn(),
    selectMultipleVersions: vi.fn(),
    setFocusedLineIndex: vi.fn(),
    restoreVersion: vi.fn(async () => null),
    createVersion: vi.fn(async () => null),
    exitHistoryMode: vi.fn(),
    clearBlockHistory: vi.fn(),
    isInHistoryMode: vi.fn((blockId: string) => blockId === 'root-a'),
    deleteVersion: vi.fn(async () => undefined),
  }
}

function createHistoryUi(options: { currentContentJson: string }) {
  const getRootBlockPos = vi.fn(() => 0)
  const editor = {} as Editor
  const history = useBlockHistoryUi({
    props: {
      editor,
      blockId: computed(() => 'root-a'),
      currentContentJson: computed(() => options.currentContentJson),
      getRootBlockPos,
    },
    enabled: computed(() => true),
  })

  return { editor, getRootBlockPos, history }
}

describe('useBlockHistoryUi', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    restoreBlockHistoryVersionForRootBlockMock.mockReset()
    restoreBlockHistoryVersionForRootBlockMock.mockResolvedValue({
      ok: true,
      appliedVersionId: 'version-a',
    })
    useBlockHistoryStoreMock.mockReset()
  })

  it('恢复已存在快照的版本时直接委托 BlockHistory orchestration', async () => {
    const version = createVersion('current-json')
    useBlockHistoryStoreMock.mockReturnValue(createStore([version]))

    const { editor, getRootBlockPos, history } = createHistoryUi({
      currentContentJson: 'current-json',
    })

    await history.handleHistoryRestore('version-a')

    expect(history.showUnsavedVersionDialog.value).toBe(false)
    expect(restoreBlockHistoryVersionForRootBlockMock).toHaveBeenCalledWith({
      editor,
      documentNodeId: 'doc-a',
      blockId: 'root-a',
      versionId: 'version-a',
      mode: 'discard-current',
      currentContentJson: 'current-json',
      getRootBlockPos,
      store: expect.any(Object),
    })
  })

  it('当前内容没有快照时先弹确认，再按用户选择创建当前快照', async () => {
    const version = createVersion('version-json')
    useBlockHistoryStoreMock.mockReturnValue(createStore([version]))

    const { getRootBlockPos, history } = createHistoryUi({
      currentContentJson: 'dirty-json',
    })

    await history.handleHistoryRestore('version-a')
    await nextTick()

    expect(history.showUnsavedVersionDialog.value).toBe(true)
    expect(restoreBlockHistoryVersionForRootBlockMock).not.toHaveBeenCalled()

    await history.confirmRestoreWithSnapshot()

    expect(restoreBlockHistoryVersionForRootBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        blockId: 'root-a',
        versionId: 'version-a',
        mode: 'create-current-snapshot',
        currentContentJson: 'dirty-json',
        getRootBlockPos,
      })
    )
    expect(history.showUnsavedVersionDialog.value).toBe(false)
  })
})
