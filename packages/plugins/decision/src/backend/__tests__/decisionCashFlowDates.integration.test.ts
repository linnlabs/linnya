import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { deliveryPurchaseModel } from './fixtures/deliveryPurchase';
import { DecisionRecordSchema, type DecisionModel } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';

function model(): DecisionModel {
  const source = deliveryPurchaseModel();
  return { ...source, options: source.options.filter(option => option.id === 'order'), checks: [] };

}

function setup() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
  for (const migration of decisionMigrations) migration.up(db);
  const run = (argv: string[]) => {
    const parsed = parseDecisionCli(argv);
    if (parsed.kind === 'file') throw new Error('Inline transport expected');
    return executeDecisionCommand(parsed, db, 'p');
  };
  return { db, run };
}

it('sorts dated payments, pays before collecting on the same day, and gives a strict gap-disappearance boundary', () => {
  const { db, run } = setup();
  try {
    const created = run(['create', '--json', JSON.stringify(model())]);
    if (typeof created !== 'object' || created === null || !('record' in created) || !('evaluation' in created)) throw new Error('Record projection');
    const record = DecisionRecordSchema.parse(created.record);
    expect(created.evaluation.cashFlows?.[0]).toMatchObject({ minimumBalance: -225, shortfall: 225,
      entries: [{ id: 'supplier:first' }, { id: 'supplier:rest' }, { id: 'customer:collect' }],
      timingThresholds: expect.arrayContaining([
        expect.objectContaining({ inputId: 'due', status: 'available', zeroShortfallRanges: [{ lower: 7, upper: null, lowerInclusive: false, upperInclusive: false }] }),
        expect.objectContaining({ inputId: 'received', zeroShortfallRanges: [{ lower: null, upper: 0, lowerInclusive: false, upperInclusive: false }] }),
      ]),
    });
    const due = record.model.inputs.find(input => input.id === 'due'); if (!due) throw new Error('Fixture');
    const update = (revision: number, value: number) => run(['update', record.id, '--expected-revision', String(revision), '--json', JSON.stringify({ reason: '明确新的尾款日', inputs: [{ ...due, value }] })]);
    expect(update(1, 7)).toMatchObject({ evaluation: { cashFlows: [{ minimumBalance: -225, shortfall: 225, entries: [{ id: 'supplier:first' }, { id: 'supplier:rest' }, { id: 'customer:collect' }] }] } });
    expect(update(2, 8)).toMatchObject({ evaluation: { cashFlows: [{ minimumBalance: 30, shortfall: 0, entries: [{ id: 'supplier:first' }, { id: 'customer:collect' }, { id: 'supplier:rest' }] }] } });
    expect(run(['read', record.id, '--revision', '1'])).toEqual(created);
    const report = run(['export', record.id, '--expected-revision', '3']);
    if (typeof report !== 'object' || report === null || !('markdown' in report) || typeof report.markdown !== 'string') throw new Error('Report');
    expect(report.markdown.replace(/\\([<>])/g, '$1')).toContain('供应商尾款日 > 7天');
    expect(report.markdown).toContain('同日先付后收');
  } finally { db.close(); }
});

it('keeps unknown dates unresolved while projecting a hypothetical bound, and rejects non-duration time references atomically', () => {
  const { db, run } = setup();
  try {
    const proposed = model(); proposed.inputs = proposed.inputs.map(input => input.id === 'due' ? { ...input, value: null } : input);
    const created = run(['create', '--json', JSON.stringify(proposed)]);
    if (typeof created !== 'object' || created === null || !('record' in created)) throw new Error('Record');
    const record = DecisionRecordSchema.parse(created.record);
    expect(created).toMatchObject({ evaluation: { cashFlows: [{ status: 'needs_information', shortfall: null, missingInputIds: ['due'],
      timingThresholds: expect.arrayContaining([expect.objectContaining({ inputId: 'due', status: 'available', zeroShortfallRanges: [{ lower: 7, upper: null, lowerInclusive: false, upperInclusive: false }] })]) }] } });
    const received = proposed.inputs.find(input => input.id === 'received'); if (!received) throw new Error('Fixture');
    expect(run(['update', record.id, '--expected-revision', '1', '--json', JSON.stringify({ reason: '实际回款未知', inputs: [{ ...received, value: null }] })])).toMatchObject({ evaluation: { cashFlows: [{ status: 'needs_information', shortfall: null,
      timingThresholds: expect.arrayContaining([expect.objectContaining({ inputId: 'due', status: 'needs_information' })]) }] } });
    expect(() => run(['update', record.id, '--expected-revision', '2', '--json', JSON.stringify({ reason: '把金额错当时点', obligations: proposed.obligations.map(item => ({ ...item, final: { ...item.final, at: { input: 'bank' } } })) })])).toThrow('quantityType=duration');
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_record_versions').get()).toEqual({ n: 2 });
  } finally { db.close(); }
});

it('does not invent date thresholds for nonlinear dates or date-dependent amounts', () => {
  const { db, run } = setup();
  try {
    for (const kind of ['nonlinear', 'amount_dependency']) {
      const proposed = model();
      proposed.obligations = proposed.obligations.map(item => item.id !== 'supplier' ? item : {
        ...item, ...(kind === 'nonlinear'
          ? { final: { ...item.final, at: { op: 'multiply' as const, left: { input: 'due' }, right: { input: 'due' } } } }
          : { total: { op: 'add' as const, left: item.total, right: { input: 'due' } } }),
      });
      const created = run(['create', '--json', JSON.stringify(proposed)]);
      expect(created).toMatchObject({ evaluation: { cashFlows: [{ timingThresholds: expect.arrayContaining([
        expect.objectContaining({ inputId: 'due', status: 'unavailable', zeroShortfallRanges: null }),
      ]) }] } });
    }
  } finally { db.close(); }
});

it('preserves historical cash declarations, advice and versions while requiring explicit obligation review', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
    for (const migration of decisionMigrations.filter(item => item.version < 6)) migration.up(db);
    const source = model();
    const base = Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'obligations' && key !== 'funds'));
    const oldModel = { ...base, options: source.options.map(({ obligationIds: _refs, ...option }) => option),
      checks: [{ id: 'funded', label: '历史资金检查', optionId: 'order', operator: 'cash_flow_funded', cashFlowId: 'old' }],
      cashFlows: [{ id: 'old', label: '历史表', optionId: 'order', unit: 'CNY', timeAnchor: '交货日', opening: { bank: { input: 'bank' }, reserve: { input: 'reserve' } },
        entries: [{ id: 'first', label: '旧首款', direction: 'outflow', amount: { input: 'first' }, at: null }] }],
    };
    const id = '40be6192-0938-44cf-9180-47edb2dd3910';
    const advice = { basedOnInputRevision: 1, content: { optionIds: ['order'], rationale: '旧作者文字原样保留', changeConditions: '旧变化条件', nextAction: '旧计划', unresolved: [] } };
    for (const revision of [1, 2]) db.prepare('INSERT INTO decision_record_versions VALUES(?,?,?,?,?)').run(id, 'p', revision, JSON.stringify({ schemaVersion: 4, id, revision, inputRevision: 1, reason: '旧版', model: oldModel, recommendation: advice }), 15);
    decisionMigrations.find(item => item.version === 6)?.up(db);
    const run = (argv: string[]) => { const command = parseDecisionCli(argv); if (command.kind === 'file') throw new Error('Inline'); return executeDecisionCommand(command, db, 'p'); };
    const read = run(['read', id]);
    if (typeof read !== 'object' || read === null || !('record' in read)) throw new Error('Read');
    const migrated = DecisionRecordSchema.parse(read.record);
    expect(migrated.revision).toBe(2); expect(migrated.inputRevision).toBe(1); expect(migrated.recommendation).toEqual(advice);
    expect(JSON.parse(migrated.legacyPaymentModelJson ?? '')).toEqual(oldModel);
    expect(read).toMatchObject({ recommendationStatus: 'needs_review', evaluation: { checks: [{ passes: null }] }, record: { model: { options: [{ obligationIds: null }] } } });
    expect(() => run(['recommend', id, '--expected-revision', '2', '--json', JSON.stringify(advice.content)])).toThrow('reviewed obligationIds');
    expect(db.prepare('SELECT revision, created_at FROM decision_record_versions ORDER BY revision').all()).toEqual([{ revision: 1, created_at: 15 }, { revision: 2, created_at: 15 }]);
    const updated = run(['update', id, '--expected-revision', '2', '--json', JSON.stringify({ reason: '从原件核清责任', options: source.options, obligations: source.obligations, funds: source.funds, checks: [] })]);
    expect(updated).toMatchObject({ evaluation: { cashFlows: [{ shortfall: 225 }] } });
  } finally { db.close(); }
});
