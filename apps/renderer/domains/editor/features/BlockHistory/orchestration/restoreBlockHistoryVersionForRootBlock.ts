import type { Editor } from '@tiptap/vue-3'
import { Fragment } from 'prosemirror-model'
import type { BlockVersion } from '../../../../../shared/ipc/blockHistoryGateway'
import type { BlockHistoryStore } from '../store/useBlockHistoryStore'

export type RestoreBlockHistoryVersionMode = 'create-current-snapshot' | 'discard-current'

export type RestoreBlockHistoryVersionFailureReason =
  | 'missing-document-node-id'
  | 'missing-block-id'
  | 'missing-version-id'
  | 'missing-current-content'
  | 'missing-version'
  | 'missing-root-block-position'
  | 'stale-root-block-position'
  | 'invalid-version-content'
  | 'create-snapshot-failed'

export type RestoreBlockHistoryVersionResult =
  | { ok: true; appliedVersionId: string }
  | { ok: false; reason: RestoreBlockHistoryVersionFailureReason; error?: unknown }

export interface RestoreBlockHistoryVersionForRootBlockInput {
  editor: Editor
  documentNodeId: string | null | undefined
  blockId: string | null | undefined
  versionId: string | null | undefined
  mode: RestoreBlockHistoryVersionMode
  currentContentJson: string | null
  getRootBlockPos: () => number | null
  store?: BlockHistoryStore
}

function normalizeRequiredId(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function readRootBlockContentPayload(version: BlockVersion): unknown {
  const parsed: unknown = JSON.parse(version.content_json)
  if (
    parsed &&
    typeof parsed === 'object' &&
    'content' in parsed &&
    Array.isArray(parsed.content)
  ) {
    return parsed.content
  }
  return [parsed]
}

function applyVersionContent(params: {
  editor: Editor
  blockId: string
  getRootBlockPos: () => number | null
  version: BlockVersion
}): RestoreBlockHistoryVersionResult {
  const blockPos = params.getRootBlockPos()
  if (blockPos === null) return { ok: false, reason: 'missing-root-block-position' }

  const { editor, blockId, version } = params
  const rootBlockNode = editor.state.doc.nodeAt(blockPos)
  if (
    !rootBlockNode ||
    rootBlockNode.type.name !== 'rootBlock' ||
    rootBlockNode.attrs.id !== blockId
  ) {
    return { ok: false, reason: 'stale-root-block-position' }
  }

  try {
    const replacementContent = Fragment.fromJSON(
      editor.state.schema,
      readRootBlockContentPayload(version)
    )
    const contentStart = blockPos + 1
    const contentEnd = blockPos + rootBlockNode.nodeSize - 1
    editor.view.dispatch(editor.state.tr.replaceWith(contentStart, contentEnd, replacementContent))
    return { ok: true, appliedVersionId: version.id }
  } catch (error) {
    return { ok: false, reason: 'invalid-version-content', error }
  }
}

async function resolveBlockHistoryStore(store?: BlockHistoryStore): Promise<BlockHistoryStore> {
  if (store) return store

  // 中文说明：默认 store 懒加载，避免纯函数 / 编排单测在导入模块时触发 IPC 单例初始化。
  const module = await import('../store/useBlockHistoryStore')
  return module.useBlockHistoryStore()
}

/**
 * 恢复某个 rootBlock 到指定历史版本。
 *
 * 中文说明：
 * - 这是 BlockHistory feature 的恢复编排，Host 只能传入当前块、当前内容快照和 action-time 位置读取函数；
 * - 是否先为当前内容创建版本由调用方根据用户选择传入 mode；
 * - 真正替换 ProseMirror 内容与退出历史模式都收束在这里，避免 Host 直接写历史业务规则。
 */
export async function restoreBlockHistoryVersionForRootBlock(
  input: RestoreBlockHistoryVersionForRootBlockInput
): Promise<RestoreBlockHistoryVersionResult> {
  const documentNodeId = normalizeRequiredId(input.documentNodeId)
  if (!documentNodeId) return { ok: false, reason: 'missing-document-node-id' }

  const blockId = normalizeRequiredId(input.blockId)
  if (!blockId) return { ok: false, reason: 'missing-block-id' }

  const versionId = normalizeRequiredId(input.versionId)
  if (!versionId) return { ok: false, reason: 'missing-version-id' }

  const store = await resolveBlockHistoryStore(input.store)
  const versions = store.getVersions(blockId)
  const targetVersion = versions.find((version) => version.id === versionId) ?? null
  if (!targetVersion) return { ok: false, reason: 'missing-version' }

  if (input.mode === 'create-current-snapshot') {
    if (!input.currentContentJson) return { ok: false, reason: 'missing-current-content' }

    const created = await store.createVersion({
      documentNodeId,
      targetBlockId: blockId,
      blockType: targetVersion.block_type,
      contentJson: input.currentContentJson,
      originType: 'manual',
    })
    if (!created) return { ok: false, reason: 'create-snapshot-failed' }
  }

  const applyResult = applyVersionContent({
    editor: input.editor,
    blockId,
    getRootBlockPos: input.getRootBlockPos,
    version: targetVersion,
  })
  if (!applyResult.ok) return applyResult.reason === 'invalid-version-content'
    ? applyResult
    : { ok: false, reason: applyResult.reason, error: applyResult.error }

  store.exitHistoryMode(blockId)
  return applyResult
}
