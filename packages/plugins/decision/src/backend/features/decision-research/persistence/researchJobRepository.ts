import type { PluginSqliteDatabasePort } from '@plugin/backend/toolRuntime';
import { ResearchJobSchema, type ResearchJob } from '../definitions/researchJob';
import { DecisionFailure } from '../../decision-record';

export function createResearchJobRepository(db: PluginSqliteDatabasePort, projectId: string) {
  function parse(row: unknown): ResearchJob {
    if (typeof row !== 'object' || row === null || !('content_json' in row) || typeof row.content_json !== 'string') {
      throw new DecisionFailure('not_found', 'Research request not found in this project.');
    }
    return ResearchJobSchema.parse(JSON.parse(row.content_json));
  }
  return {
    read(id: string) {
      return parse(db.prepare('SELECT content_json FROM decision_research_jobs WHERE project_id = ? AND id = ?').get(projectId, id));
    },
    list(decisionId: string) {
      return db.prepare('SELECT content_json FROM decision_research_jobs WHERE project_id = ? AND decision_id = ? ORDER BY created_at, id')
        .all(projectId, decisionId).map(parse);
    },
    insert(job: ResearchJob) {
      db.prepare('INSERT INTO decision_research_jobs (id, project_id, decision_id, content_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(job.id, projectId, job.decisionId, JSON.stringify(job), job.createdAt);
    },
    receive(job: ResearchJob) {
      // 同一委托只接纳一次真实结果；重复接回不覆盖原 observed version。
      db.transaction(() => {
        const saved = this.read(job.id);
        if (saved.delivery) throw new DecisionFailure('revision_conflict', 'Research delivery already received.');
        db.prepare('UPDATE decision_research_jobs SET content_json = ? WHERE project_id = ? AND id = ?')
          .run(JSON.stringify(job), projectId, job.id);
      }).immediate();
    },
  };
}
