import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { DecisionModel, DecisionRecommendation } from '../../shared';
import { deliveryPurchaseModel } from './fixtures/deliveryPurchase';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';

let db: Database.Database;
beforeEach(() => { db = new Database(':memory:'); db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');"); for (const migration of decisionMigrations) migration.up(db); });
afterEach(() => db.close());
function run(argv: string[]) {
  const command = parseDecisionCli(argv); if (command.kind === 'file') throw new Error('Inline fixture');
  return executeDecisionCommand(command, db, 'p');
}
function model(): DecisionModel {
  const source = deliveryPurchaseModel();
  return { ...source, options: source.options.filter(option => option.id === 'order'),
    checks: [{ id: 'funded', optionId: 'order', label: '全部付款时点无缺口', operator: 'cash_flow_funded', cashFlowId: 'flow' }] };
}
function create(source = model()) {
  const value = run(['create', '--json', JSON.stringify(source)]);
  if (!value || typeof value !== 'object' || !('record' in value) || !('evaluation' in value)) throw new Error('Record');
  return value;
}

it('recomputes funding checks with same-day ordering, unknown cash and dates, without turning simulations into facts', () => {
  const initial = create(); const id = initial.record.id;
  const before = db.prepare('SELECT * FROM decision_record_versions').all();
  const cases = [
    { id: 'short', bank: 624 }, { id: 'funded', bank: 625 }, { id: 'same_day', due: 7 }, { id: 'after_receipt', due: 8 },
    { id: 'delivery', due: 0 }, { id: 'unknown_cash', bank: null }, { id: 'unknown_receipt', received: null },
    // 625银行余额已扣120准备；尾款更早、首款提高均仍由505可用额覆盖。
    { id: 'funded_early', bank: 625, due: -6 }, { id: 'funded_first', bank: 625, first: 300 },
  ].map(({ id, ...inputs }) => ({ id, label: id, inputs: Object.entries(inputs).map(([inputId, value]) => ({ inputId, value })) }));
  const result = run(['simulate', id, '--expected-revision', '1', '--json', JSON.stringify({ cases })]);
  if (!result || typeof result !== 'object' || !('cases' in result)) throw new Error('Simulation');
  expect(result.cases.map(item => item.evaluation.checks[0].passes)).toEqual([false, true, false, true, false, null, null, true, true]);
  expect(result.cases.map(item => item.evaluation.cashFlows?.[0].shortfall)).toEqual([1, 0, 225, 0, 225, null, null, 0, 0]);
  expect(result.cases.every(item => item.unreferencedInputIds.length === 0)).toBe(true);
  expect(db.prepare('SELECT * FROM decision_record_versions').all()).toEqual(before);
});

it('distinguishes releasing reserves, paying the reserved liability and making an additional ordinary payment', () => {
  const outcomes = [
    { bank: 400, direction: 'release_reserve', amount: 120, at: -6, gap: 105 },
    { bank: 400, direction: 'release_reserve', amount: 120, at: 0, gap: 225 },
    { bank: 400, direction: 'release_reserve', amount: 120, at: 8, gap: 225 },
    { bank: 625, direction: 'pay_reserve', amount: 120, at: -6, gap: 0 },
    { bank: 625, direction: 'outflow', amount: 120, at: -6, gap: 120 },
    { bank: 625, direction: 'pay_reserve', amount: 121, at: -6, gap: null },
    { bank: 625, direction: 'release_reserve', amount: 121, at: -6, gap: null },
  ] as const;
  for (const item of outcomes) {
    const source = model(); source.inputs = source.inputs.map(input => input.id === 'bank' ? { ...input, value: item.bank } : input);
    source.cashFlows = source.cashFlows?.map(flow => ({ ...flow, entries: [...flow.entries,
      { id: 'reserve_event', label: '明确的准备事件', direction: item.direction, amount: { literal: item.amount }, at: { literal: item.at } }] }));
    const projection = create(source);
    expect(projection.evaluation.cashFlows?.[0].shortfall).toBe(item.gap);
    expect(projection.evaluation.checks[0].passes).toBe(item.gap === null ? null : item.gap === 0);
    if (item.direction === 'pay_reserve' && item.amount === 120) expect(projection.evaluation.cashFlows?.[0]).toMatchObject({
      balances: expect.arrayContaining([{ entryId: 'reserve_event', bank: 505, reserve: 0, balance: 505 }]), endingReserve: 0,
    });
  }
});

it('persists recomputed release scenarios, rejects a failed current choice, and invalidates advice after cash changes', () => {
  const initial = create(); const id = initial.record.id;
  const content: DecisionRecommendation = { optionIds: [], rationale: '当前付款时点仍缺资金', nextAction: '确认收付款日期', changeConditions: '这段自由条件留在完整原件', unresolved: [],
    conditionalAdvice: { whenNonePass: '先补足资金条件', whenUndetermined: '先补齐未知', cases: [
      { id: 'defer', label: '尾款延至回款后', inputs: [{ inputId: 'due', value: 8 }] },
      { id: 'same_day', label: '尾款只延至回款当天', inputs: [{ inputId: 'due', value: 7 }] },
    ] } };
  expect(() => run(['recommend', id, '--expected-revision', '1', '--json', JSON.stringify({ ...content, optionIds: ['order'] })])).toThrow();
  expect(db.prepare('SELECT COUNT(*) n FROM decision_record_versions').get()).toEqual({ n: 1 });
  const saved = run(['recommend', id, '--expected-revision', '1', '--json', JSON.stringify(content)]);
  expect(saved).toMatchObject({ conditionalAdvice: { cases: [
    { options: [{ status: 'pass' }] }, { options: [{ status: 'fail' }], outcome: { status: 'no_option_passes' } },
  ] } });
  const bank = initial.record.model.inputs.find(input => input.id === 'bank'); if (!bank) throw new Error('Fixture');
  const changed = run(['update', id, '--expected-revision', '2', '--json', JSON.stringify({ reason: '资金已落实', inputs: [{ ...bank, value: 625 }] })]);
  expect(changed).toMatchObject({ recommendationStatus: 'needs_review', conditionalAdvice: { status: 'needs_review' }, evaluation: { checks: [{ passes: true }] } });
  expect(run(['read', id, '--revision', '2'])).toEqual(saved);
});

it('rejects a check tied to another option’s cash table without writing, and leaves historical unclassified openings unknown', () => {
  const bad = model(); bad.options.push({ id: 'other', label: '其他', description: '另一个选项' });
  bad.checks = [{ id: 'bad', label: '错配', optionId: 'other', operator: 'cash_flow_funded', cashFlowId: 'flow' }];
  expect(() => create(bad)).toThrow(); expect(db.prepare('SELECT COUNT(*) n FROM decision_record_versions').get()).toEqual({ n: 0 });
  const historical = model(); historical.cashFlows = historical.cashFlows?.map(flow => ({ ...flow, opening: { unclassified: { input: 'bank' } } }));
  expect(create(historical)).toMatchObject({ evaluation: { checks: [{ passes: null }], cashFlows: [{ status: 'needs_information', shortfall: null }] } });
});
