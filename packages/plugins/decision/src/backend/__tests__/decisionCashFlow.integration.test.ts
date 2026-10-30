import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { deliveryPurchaseModel } from './fixtures/deliveryPurchase';
import { DecisionRecordSchema, type DecisionModel } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';

function purchaseModel(): DecisionModel {
  const source = deliveryPurchaseModel();
  return { ...source, checks: [{ id: 'cash_covered', optionId: 'order', label: '全额资金覆盖', operator: 'lte',
    left: { op: 'add', left: { input: 'first' }, right: { op: 'subtract', left: { input: 'total' }, right: { input: 'first' } } },
    right: { op: 'subtract', left: { input: 'bank' }, right: { input: 'reserve' } } }] };

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
      balances: [{ entryId: 'supplier:first', balance: 30 }, { entryId: 'supplier:rest', balance: -225 }, { entryId: 'customer:collect', balance: 215 }] });
    const preview = run(['check', record.id, '--expected-revision', '1', '--json', '{"optionIds":["order"]}']);
    expect(preview).toMatchObject({ cashFlows: [{ minimumBalance: -225 }], persisted: false });
    // B2反馈反例：尾款由总价推出后，改变首款不改变505总额，不能再输出伪≤25。
    expect(preview).toMatchObject({ changeConditions: expect.arrayContaining([expect.stringContaining('此检查与first无关，检查不成立')]) });
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
    expect(() => run(['update', record.id, '--expected-revision', '1', '--json', JSON.stringify({ reason: '坏引用', funds: { unit: 'CNY', timeAnchor: '交货日', bank: { input: 'missing' }, reserve: { literal: 0 } } })])).toThrow('Unknown input');
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_record_versions').get()).toEqual({ n: 1 });
  } finally { db.close(); }
});
