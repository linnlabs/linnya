import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { refundableOrderModel } from './fixtures/refundableOrder';

let db: Database.Database; let id: string;
function run(args: string[]) {
  const command = parseDecisionCli(args); if (command.kind === 'file') throw new Error('Expected inline');
  return executeDecisionCommand(command, db, 'p');
}
function scenarios(cases: unknown[]) {
  const result = run(['simulate', id, '--expected-revision', '1', '--json', JSON.stringify({ cases })]);
  if (typeof result !== 'object' || result === null || !('cases' in result)) throw new Error('Expected simulation');
  return result;
}
beforeEach(() => {
  db = new Database(':memory:'); db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
  for (const migration of decisionMigrations) migration.up(db);
  const result = run(['create', '--json', JSON.stringify(refundableOrderModel())]);
  if (typeof result !== 'object' || result === null || !('record' in result)) throw new Error('Expected record'); id = result.record.id;
});
afterEach(() => db.close());

it('keeps total value distinct from collection/refund cash flows without recording hypothetical payments', () => {
  const before = db.prepare('SELECT * FROM decision_record_versions').all();
  const result = scenarios([
    { id: 'apply', label: '抵扣订金', inputs: [{ inputId: 'refund_before_collection', value: 0 }] },
    { id: 'refund', label: '先退再全收', inputs: [{ inputId: 'refund_before_collection', value: 150 }] },
  ]);
  const values = result.cases.map(item => Object.fromEntries(item.evaluation.calculations.map(calculation => [calculation.id, calculation.result])));
  expect(values[0]).toMatchObject({ intended_total: { value: 310 }, future_collection: { value: 160 }, refund_outflow: { value: 0 }, net_future_customer_flow: { value: 160 }, quote_only_gap: { value: 10 }, spending_allowance: { value: 820 } });
  expect(values[1]).toMatchObject({ intended_total: { value: 310 }, future_collection: { value: 310 }, refund_outflow: { value: 150 }, net_future_customer_flow: { value: 160 }, quote_only_gap: { value: 10 }, spending_allowance: { value: 820 } });
  expect(values.every(item => item.incremental_gap?.status === 'unavailable')).toBe(true);
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
});

it('distinguishes unknown scope from budget violation and does not turn fee hypotheses into current facts', () => {
  const before = db.prepare('SELECT * FROM decision_record_versions').all();
  const result = scenarios([
    { id: 'unknown', label: '费用仍未知', inputs: [{ inputId: 'extra_fees', value: null }] },
    { id: 'ten', label: '附加费10的假设', inputs: [{ inputId: 'extra_fees', value: 10 }] },
    { id: 'six_hundred', label: '附加费600的假设', inputs: [{ inputId: 'extra_fees', value: 600 }] },
  ]);
  expect(result.cases.map(item => item.evaluation.checks[0]?.passes)).toEqual([null, true, false]);
  expect(result.cases.map(item => item.evaluation.calculations.find(c => c.id === 'total_spending')?.result)).toMatchObject([
    { status: 'unavailable' }, { status: 'available', value: 490 }, { status: 'available', value: 1080 },
  ]);
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
});
