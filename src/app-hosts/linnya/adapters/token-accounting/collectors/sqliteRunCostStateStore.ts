import type Database from 'better-sqlite3';
import {
  RunCostStateSchema,
  type RunCostState,
  type RunCostStateStore,
} from '../definitions/runCostState';

export class SqliteRunCostStateStore implements RunCostStateStore {
  constructor(private readonly db: Database.Database) {}
  load(runId: string): RunCostState | null {
    const row = this.db
      .prepare<
        [string],
        { state_json: string }
      >('SELECT state_json FROM agent_run_costs WHERE run_id = ?')
      .get(runId);
    return row ? RunCostStateSchema.parse(JSON.parse(row.state_json)) : null;
  }
  save(runId: string, state: RunCostState): void {
    this.db
      .prepare(
        `INSERT INTO agent_run_costs (run_id, state_json) VALUES (?, ?)
      ON CONFLICT(run_id) DO UPDATE SET state_json = excluded.state_json`
      )
      .run(runId, JSON.stringify(RunCostStateSchema.parse(state)));
  }
}
