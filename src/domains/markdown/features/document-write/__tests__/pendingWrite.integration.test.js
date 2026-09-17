import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema'
import { ASSET_LEDGER_SCHEMAS } from 'src/domains/assets/features/asset-ledger/infrastructure/sqlite/schemas/assetLedger.schema'
import { MARKDOWN_DOCUMENT_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/document.schema'
import { PENDING_REVISION_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/pending-revision.schema'
import { BLOCK_HISTORY_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema'
import { IMAGE_BLOCK_SCHEMAS } from '../../document-storage/infrastructure/sqlite/schemas/blocks/image.schema'
import { MarkdownDocumentService } from '../../document-storage'
import { writeMarkdownDocumentFromText } from '../orchestration/writeMarkdownDocumentFromText'

const databases = []
afterEach(() => databases.splice(0).forEach(db => db.close()))
function setup(texts) {
  const db = new Database(':memory:')
  databases.push(db)
  db.pragma('foreign_keys = ON')
  for (const sql of [...CORE_SCHEMAS, ...ASSET_LEDGER_SCHEMAS, ...MARKDOWN_DOCUMENT_SCHEMAS, ...IMAGE_BLOCK_SCHEMAS, ...PENDING_REVISION_SCHEMAS, ...BLOCK_HISTORY_SCHEMAS]) db.exec(sql)
  db.prepare("INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, created_at, updated_at) VALUES ('test-document', NULL, NULL, 'document', 'test', 1, 1)").run()
  const store = new MarkdownDocumentService(db)
  store.createDocument('test-document', { type: 'doc', content: texts.map((text, i) => ({
    type: 'rootBlock', attrs: { id: `b${i}` }, content: [{ type: 'baseBlock', attrs: { id: `i${i}` }, content: [{ type: 'text', text }] }],
  })) })
  return { store, write: targetText => writeMarkdownDocumentFromText({
    documentStore: store, documentId: 'test-document', targetText, toolName: 'edit_file',
    annotationAdmission: { author: 'AI', meta: { source: 'agent' } }, touchDocumentUpdatedAt: () => undefined,
  }), rows: () => store.getPendingRevisions('test-document') }
}

it('修改后改回基线会清除 Pending', async () => {
  const { write, rows } = setup(['Alpha', 'Beta'])
  await write('Alpha changed\n\nBeta changed')
  await write('Alpha\n\nBeta')
  expect(rows()).toHaveLength(0)
})

it('文首新增仅生成一个 insert，不平移旧块身份', async () => {
  const { write, rows } = setup(['Alpha', 'Beta', 'Gamma'])
  const result = await write('Intro\n\nAlpha\n\nBeta\n\nGamma')
  expect(result.edits.map(edit => edit.operation)).toEqual(['insert'])
  expect(rows()).toHaveLength(1)
})

it('取消新增块后返回真实 Pending 数量', async () => {
  const { write, rows } = setup(['Alpha'])
  await write('Alpha\n\nAdded')
  expect(rows()).toHaveLength(1)
  const result = await write('Alpha')
  expect(rows()).toHaveLength(0)
  expect(result.edits).toEqual([])
  expect(result.pendingCount).toBe(0)
  expect(result.cancelledCount).toBe(1)
})

it('继续编辑保持 Pending ID 并递增 revision，重复相同文本不制造更新', async () => {
  const { write, rows } = setup(['Alpha'])
  await write('First')
  const first = rows()[0]
  await write('Second')
  expect(rows()[0]).toMatchObject({ id: first.id, revision: first.revision + 1, new_markdown: 'Second' })
  await write('Second')
  expect(rows()[0].revision).toBe(first.revision + 1)
})

it('连续新增、删除和恢复原段落保持最终预览和原块身份', async () => {
  const { write, rows, store } = setup(['Alpha', 'Beta', 'Gamma'])
  await write('Intro\n\nAlpha\n\nGamma')
  expect(rows().map(item => item.operation).sort()).toEqual(['delete', 'insert'])
  await write('Alpha\n\nBeta\n\nGamma')
  expect(rows()).toEqual([])
  expect(store.getDocument('test-document').content.map(root => root.attrs.id)).toEqual(['b0', 'b1', 'b2'])
})

it('文首新增后批注仍绑定对齐的原段落，不能按位置串到其他块', async () => {
  const { write, rows, store } = setup(['Alpha', 'Beta'])
  const result = await write('Intro\n\nAlpha\n\nBeta\n\n<!-- Review Beta -->')
  const roots = store.getDocument('test-document').content
  expect(result.createdAnnotationIds).toHaveLength(1)
  expect(roots.find(root => root.attrs.id === 'b1').attrs.annotations).toEqual([
    expect.objectContaining({ content: 'Review Beta' }),
  ])
  expect(roots.find(root => root.attrs.id === 'b0').attrs.annotations ?? []).toEqual([])
  expect(rows()).toHaveLength(1)
  expect(rows()[0].operation).toBe('insert')
})
