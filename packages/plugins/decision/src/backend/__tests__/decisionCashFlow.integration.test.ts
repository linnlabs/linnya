import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { DecisionRecordSchema, type DecisionModel } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';

function purchaseModel(): DecisionModel {
  return {
    title: '供应商付款时序', question: '首付可付是否等于全程资金落实？',
    inputs: [['bank', 400], ['reserve', 120], ['upfront', 250], ['balance', 255], ['collection', 440]].map(([id, value]) => ({
      id: String(id), label: String(id), value: Number(value), quantityType: 'money', unit: 'CNY', kind: 'fact', origin: '合成已知事实', status: 'available',
    })),
    options: [{ id: 'buy', label: '采购', description: '仅用于模拟付款顺序' }], calculations: [], checks: [],
    cashFlows: [{ id: 'order', label: '回款前须付清供应商', optionId: 'buy', unit: 'CNY',
      openingBalance: { op: 'subtract', left: { input: 'bank' }, right: { input: 'reserve' } },
      entries: [
        { id: 'first', label: '先付开工', direction: 'outflow', amount: { input: 'upfront' } },
        { id: 'final', label: '发货前尾款', direction: 'outflow', amount: { input: 'balance' } },
        { id: 'collect', label: '交货7天后余款，假设全部成交', direction: 'inflow', amount: { input: 'collection' } },
      ],
    }],
  };
}

it('distinguishes an affordable first payment from a later shortfall and preserves the cash-flow model through versions', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
    for (const migration of decisionMigrations) migration.up(db);
    const run = (argv: string[]) => { const command = parseDecisionCli(argv); if (command.kind === 'file') throw new Error('inline'); return executeDecisionCommand(command, db, 'p'); };
    const created = run(['create', '--json', JSON.stringify(purchaseModel())]);
    if (typeof created !== 'object' || created === null || !('evaluation' in created) || !('record' in created)) throw new Error('record');
    const record = DecisionRecordSchema.parse(created.record);
    expect(created.evaluation.cashFlows?.[0]).toMatchObject({ status: 'available', minimumBalance: -225, endingBalance: 215, shortfall: 225,
      balances: [{ entryId: 'first', balance: 30 }, { entryId: 'final', balance: -225 }, { entryId: 'collect', balance: 215 }] });
    const preview = run(['check', record.id, '--expected-revision', '1', '--json', '{"optionIds":["buy"]}']);
    expect(preview).toMatchObject({ cashFlows: [{ minimumBalance: -225 }], persisted: false });
    const report = run(['export', record.id, '--expected-revision', '1']);
    expect(JSON.stringify(report)).toContain('资金缺口 225');
    const bank = record.model.inputs.find(input => input.id === 'bank'); if (!bank) throw new Error('fixture');
    const changed = run(['update', record.id, '--expected-revision', '1', '--json', JSON.stringify({ reason: '明确取得新增225可用资金', inputs: [{ ...bank, value: 625 }] })]);
    if (typeof changed !== 'object' || changed === null || !('evaluation' in changed)) throw new Error('evaluation');
    expect(changed.evaluation.cashFlows?.[0]).toMatchObject({ minimumBalance: 0, shortfall: 0 });
    expect(run(['read', record.id, '--revision', '1'])).toEqual(created);
  } finally { db.close(); }
});

it('returns needs_information for unknown opening cash and rejects malformed schedules without writing a revision', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
    for (const migration of decisionMigrations) migration.up(db);
    const run = (argv: string[]) => { const command = parseDecisionCli(argv); if (command.kind === 'file') throw new Error('inline'); return executeDecisionCommand(command, db, 'p'); };
    const model = purchaseModel();
    const created = run(['create', '--json', JSON.stringify({ ...model, inputs: model.inputs.map(input => input.id === 'bank' ? { ...input, value: null } : input) })]);
    if (typeof created !== 'object' || created === null || !('evaluation' in created) || !('record' in created)) throw new Error('record');
    expect(created.evaluation.cashFlows?.[0]).toMatchObject({ status: 'needs_information', missingInputIds: ['bank'], minimumBalance: null, shortfall: null });
    const record = DecisionRecordSchema.parse(created.record);
    expect(() => run(['update', record.id, '--expected-revision', '1', '--json', JSON.stringify({ reason: '坏引用', cashFlows: [{ ...model.cashFlows?.[0], openingBalance: { input: 'missing' } }] })])).toThrow('unknown input');
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_record_versions').get()).toEqual({ n: 1 });
  } finally { db.close(); }
});
