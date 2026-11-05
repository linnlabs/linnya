import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { tokenAccounting } from '@linnlabs/linnkit/runtime-kernel';
import { RunCostStateSchema } from 'src/app-hosts/linnya/adapters/token-accounting/definitions/runCostState';
import { migrateV69ToV70RunCostLedgerTotals } from '../v69-to-v70-run-cost-ledger-totals';

function legacyState(runId: string) {
  const tokenLedgerEntries = [
    tokenAccounting.createContextComponentLedgerEntry({
      id: `context-ledger-${runId}-1`,
      runId,
      components: [
        {
          componentId: '0:system',
          kind: 'system',
          tokens: 30,
          source: 'local-estimate',
          confidence: 'estimate',
        },
        {
          componentId: '1:user',
          kind: 'user',
          tokens: 12,
          source: 'local-estimate',
          confidence: 'estimate',
        },
      ],
    }),
    tokenAccounting.createLlmUsageLedgerEntry({
      id: `run-cost:${runId}:llm:1`,
      runId,
      modelId: 'test-model',
      usage: {
        inputTokens: 42,
        outputTokens: 7,
        cacheReadTokens: 10,
        source: 'provider-response-usage',
        confidence: 'actual',
      },
    }),
  ];
  return {
    tokensInput: 42,
    tokensOutput: 7,
    latencyMs: 120,
    llmCallCount: 1,
    tokenLedgerEntries,
    tokenLedgerSequence: 1,
    contextLedgerSequence: 0,
    computedCostUsd: 0,
    computedActualCostCount: 0,
    unknownActualCostCount: 1,
    childRunIds: ['child'],
    uncertainExecutions: [],
  };
}

it('rewrites every legacy run cost row to totals and entry ids; rolls back with its enclosing migration', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE agent_run_costs (run_id TEXT PRIMARY KEY, state_json TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO agent_run_costs VALUES (?, ?)');
    // 超过一批，覆盖游标翻页。
    const runIds = Array.from({ length: 70 }, (_, index) => `run-${String(index).padStart(3, '0')}`);
    for (const runId of runIds) insert.run(runId, JSON.stringify(legacyState(runId)));

    expect(() =>
      db.transaction(() => {
        migrateV69ToV70RunCostLedgerTotals(db);
        throw new Error('abort');
      })()
    ).toThrow('abort');
    const untouched = db.prepare("SELECT state_json FROM agent_run_costs WHERE run_id = 'run-000'").get() as {
      state_json: string;
    };
    expect(JSON.parse(untouched.state_json)).toHaveProperty('tokenLedgerEntries');

    db.transaction(() => migrateV69ToV70RunCostLedgerTotals(db))();
    const rows = db.prepare('SELECT run_id, state_json FROM agent_run_costs ORDER BY run_id').all() as Array<{
      run_id: string;
      state_json: string;
    }>;
    expect(rows).toHaveLength(runIds.length);
    for (const row of rows) {
      const legacy = legacyState(row.run_id);
      const state = RunCostStateSchema.parse(JSON.parse(row.state_json));
      expect(state.tokenLedgerAggregate).toEqual(
        JSON.parse(JSON.stringify(tokenAccounting.aggregateTokenLedgerEntries(legacy.tokenLedgerEntries)))
      );
      expect(state.tokenLedgerEntryIds).toEqual(legacy.tokenLedgerEntries.map(entry => entry.id));
      expect(state).toMatchObject({ tokensInput: 42, childRunIds: ['child'], unknownActualCostCount: 1 });
      expect(row.state_json).not.toContain('componentId');
    }
  } finally {
    db.close();
  }
});

it('fails the migration instead of guessing when a row is not a recognised ledger', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE agent_run_costs (run_id TEXT PRIMARY KEY, state_json TEXT NOT NULL)');
    db.prepare('INSERT INTO agent_run_costs VALUES (?, ?)').run('broken', '{"tokensInput":1}');
    expect(() => db.transaction(() => migrateV69ToV70RunCostLedgerTotals(db))()).toThrow();
    expect(
      (db.prepare('SELECT state_json FROM agent_run_costs').get() as { state_json: string }).state_json
    ).toBe('{"tokensInput":1}');
  } finally {
    db.close();
  }
});
