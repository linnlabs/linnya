import { describe, expect, it } from 'vitest'
import type { BlockVersion } from '../../../../../shared/ipc/blockHistoryGateway'
import {
  findSelectedBlockHistoryVersion,
  readCurrentBlockHistoryVersionLabel,
  shouldPromptBeforeBlockHistoryRestore,
} from './readBlockHistoryPanelState'
import type { EditorMessageKey, EditorMessageResolver } from '../../../definitions/editorMessages'

const testMessage: EditorMessageResolver = (key, params) => {
  const messages: Partial<Record<EditorMessageKey, string>> = {
    'editor.blockHistory.currentVersion': `当前版本 v${params?.version}`,
    'editor.blockHistory.currentVersionUnsaved': '当前版本（未创建版本）',
    'editor.blockHistory.noSelectedVersion': '未选择版本',
    'editor.blockHistory.selectedVersionWithTime': `版本 v${params?.version} (${params?.time})`,
    'editor.blockHistory.selectedVersion': `版本 v${params?.version}`,
    'editor.blockHistory.deleteDialog.message': '确定要删除这个历史版本吗？此操作无法撤销。',
    'editor.blockHistory.deleteDialog.messageWithVersion': `确定要删除版本 v${params?.version} 吗？此操作无法撤销。`,
  }
  return messages[key] ?? key
}

function version(overrides: Partial<BlockVersion>): BlockVersion {
  return {
    id: 'version-a',
    document_node_id: 'doc-a',
    target_block_id: 'root-a',
    block_type: 'baseBlock',
    content_json: '{"type":"rootBlock","content":[]}',
    version_number: 1,
    origin_type: 'manual',
    origin_metadata: null,
    created_at: Date.now(),
    ...overrides,
  }
}

describe('readBlockHistoryPanelState', () => {
  it('按 selectedVersionId 找到当前选中版本', () => {
    const versions = [
      version({ id: 'version-a', version_number: 1 }),
      version({ id: 'version-b', version_number: 2 }),
    ]

    expect(findSelectedBlockHistoryVersion(versions, 'version-b')?.version_number).toBe(2)
    expect(findSelectedBlockHistoryVersion(versions, 'missing')).toBeNull()
  })

  it('当前内容已有快照时不提示创建版本', () => {
    const currentContentJson = '{"type":"rootBlock","content":[{"type":"baseBlock"}]}'
    const versions = [
      version({ id: 'version-a', content_json: currentContentJson, version_number: 3 }),
    ]

    expect(shouldPromptBeforeBlockHistoryRestore({ currentContentJson, versions })).toBe(false)
    expect(readCurrentBlockHistoryVersionLabel(currentContentJson, versions, testMessage)).toBe('当前版本 v3')
  })

  it('当前内容没有快照时提示用户选择是否保存', () => {
    const currentContentJson = '{"type":"rootBlock","content":[{"type":"baseBlock"}]}'
    const versions = [
      version({ id: 'version-a', content_json: '{"type":"rootBlock","content":[]}' }),
    ]

    expect(shouldPromptBeforeBlockHistoryRestore({ currentContentJson, versions })).toBe(true)
    expect(readCurrentBlockHistoryVersionLabel(currentContentJson, versions, testMessage)).toBe('当前版本（未创建版本）')
  })
})
