import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_BASE_SCHEMAS } from 'src/features/knowledge-base/infrastructure/sqlite/knowledge-base.schema';
import { BetterSqliteMetadataRepository } from 'src/features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository';
import { ProjectKnowledgeBaseLinksService } from 'src/features/knowledge-base/infrastructure/sqlite/project-knowledge-base-links.service';

/** 真实关系持久化；项目事实只经 owner 摘要口，知识库不读项目表。 */
describe('project knowledge associations', () => {
  it('保留关联角色和顺序，拒绝不存在的项目，摘要只显示仍可用的项目', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
    database.prepare('INSERT INTO projects VALUES (?)').run('project-a');
    database.prepare('INSERT INTO projects VALUES (?)').run('project-b');
    for (const ddl of KNOWLEDGE_BASE_SCHEMAS) database.exec(ddl);
    const projects = new Map([
      ['project-a', { id: 'project-a', name: '研究 A' }],
      ['project-b', { id: 'project-b', name: '研究 B' }],
    ]);
    const metadata = new BetterSqliteMetadataRepository(database);
    const links = new ProjectKnowledgeBaseLinksService(database, metadata, {
      get: id => projects.get(id),
      list: () => [...projects.values()],
    });
    try {
      await links.linkKnowledgeBaseToProject('project-a', 'default', 'read_only');
      await links.linkKnowledgeBaseToProject('project-b', 'default');
      expect((await links.getLinkDetail('project-a', 'default'))?.role).toBe('read_only');
      expect(await links.listKnowledgeBasesForProject('project-a')).toEqual(['default']);
      expect(await links.listKnowledgeBasesForProject('unrelated-project')).toEqual([]);
      expect((await links.listDetailedProjectsForKnowledgeBase('default')).map(p => p.name))
        .toEqual(['研究 A', '研究 B']);
      // 原子替换不会把仍选中的只读关联提升为可写。
      const original = await links.getLinkDetail('project-a', 'default');
      await links.replaceKnowledgeBasesForProject('project-a', ['default']);
      expect(await links.getLinkDetail('project-a', 'default')).toEqual(original);
      // 模拟正式 SQLite 写入故障：删除旧关联后，新插入失败，必须整批回滚。
      database.exec(`CREATE TRIGGER refuse_project_a BEFORE INSERT ON project_knowledge_base_links
        WHEN NEW.project_id = 'project-a' BEGIN SELECT RAISE(ABORT, 'fixture write rejected'); END`);
      await expect(links.replaceProjectsForKnowledgeBase('default', ['project-a']))
        .rejects.toThrow('fixture write rejected');
      expect(await links.listProjectsForKnowledgeBase('default')).toEqual(['project-a', 'project-b']);
      database.exec('DROP TRIGGER refuse_project_a');
      await expect(links.replaceKnowledgeBasesForProject('project-a', ['missing-library'])).rejects.toThrow('知识库不存在');
      expect(await links.getLinkDetail('project-a', 'default')).toEqual(original);
      await links.replaceProjectsForKnowledgeBase('default', ['project-a']);
      expect(await links.listProjectsForKnowledgeBase('default')).toEqual(['project-a']);
      await links.linkKnowledgeBaseToProject('project-b', 'default');
      projects.delete('project-b');
      expect((await links.listDetailedProjectsForKnowledgeBase('default')).map(p => p.id))
        .toEqual(['project-a']);
      await expect(links.linkKnowledgeBaseToProject('project-b', 'default'))
        .rejects.toThrow('项目不存在');
      await expect(links.linkKnowledgeBaseToProject('project-a', 'missing-library'))
        .rejects.toThrow('知识库不存在');
      expect(await links.unlinkKnowledgeBaseFromProject('project-a', 'default')).toBe(true);
      expect(await links.listKnowledgeBasesForProject('project-a')).toEqual([]);
    } finally {
      database.close();
    }
  });
});
