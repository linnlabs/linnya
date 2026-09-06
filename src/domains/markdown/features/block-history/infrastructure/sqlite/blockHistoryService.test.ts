import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { BLOCK_HISTORY_SCHEMAS } from '../../../document-storage/infrastructure/sqlite/schemas/blocks/block-history.schema'
import { CORE_SCHEMAS } from 'src/features/workspace/infrastructure/sqlite/schemas/core.schema'
import { BlockHistoryService } from './blockHistoryService'

function setup(): { db: Database.Database; service: BlockHistoryService } {
  const db = new Database(':memory:')
  for (const statement of [...CORE_SCHEMAS, ...BLOCK_HISTORY_SCHEMAS]) db.exec(statement)
  db.prepare(`
    INSERT INTO workspace_nodes (id, project_id, parent_id, type, name, created_at, updated_at)
    VALUES (?, NULL, NULL, 'document', 'doc', ?, ?)
  `).run('document-1', 1, 1)
  return { db, service: new BlockHistoryService(db) }
}

const rootBlockContent = JSON.stringify({
  type: 'rootBlock',
  attrs: { id: 'root-1' },
  content: [{
    type: 'baseBlock',
    attrs: { id: 'block-1' },
    content: [],
  }],
})

describe('BlockHistoryService', () => {
  it('只保存通过 Markdown schema 的目标 rootBlock 快照', () => {
    const { db, service } = setup()
    try {
      const version = service.createVersion({
        documentNodeId: 'document-1',
        targetBlockId: 'root-1',
        blockType: 'rootBlock',
        contentJson: rootBlockContent,
        originType: 'manual',
      })

      expect(JSON.parse(version.content_json)).toMatchObject({
        type: 'rootBlock',
        attrs: { id: 'root-1', annotations: [] },
      })
      expect(() => service.createVersion({
        documentNodeId: 'document-1',
        targetBlockId: 'root-1',
        blockType: 'rootBlock',
        contentJson: JSON.stringify({
          type: 'rootBlock',
          attrs: { id: 'root-1', unknown: true },
          content: [],
        }),
        originType: 'manual',
      })).toThrow('未知属性 "unknown"')
    } finally {
      db.close()
    }
  })

  it('读取历史版本时拒绝数据库中已有的非法快照', () => {
    const { db, service } = setup()
    try {
      const version = service.createVersion({
        documentNodeId: 'document-1',
        targetBlockId: 'root-1',
        blockType: 'rootBlock',
        contentJson: rootBlockContent,
        originType: 'manual',
      })

      db.prepare('UPDATE markdown_block_versions SET content_json = ? WHERE id = ?').run(
        JSON.stringify({
          type: 'rootBlock',
          attrs: { id: 'root-1', unknown: true },
          content: [],
        }),
        version.id,
      )

      expect(() => service.getVersion(version.id)).toThrow('未知属性 "unknown"')
      expect(() => service.listVersions('document-1', 'root-1')).toThrow('未知属性 "unknown"')
      expect(() => service.getLatestVersion('document-1', 'root-1')).toThrow('未知属性 "unknown"')
    } finally {
      db.close()
    }
  })
})
