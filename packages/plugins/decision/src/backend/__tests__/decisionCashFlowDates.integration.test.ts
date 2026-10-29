import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { DecisionRecordSchema, type DecisionModel } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';

function model(): DecisionModel {
  return {
    title: '延期必须覆盖收款', question: '发货前付尾款与客户第7天回款',
    inputs: [
      ...[['cash', 280], ['total', 505], ['first', 250], ['collection', 440]].map(([id, value]) => ({
        id: String(id), label: String(id), value: Number(value), quantityType: 'money' as const, unit: 'CNY', kind: 'fact' as const, status: 'available' as const, origin: '合成资金事实',
      })),
      { id: 'due', label: '供应商尾款日', value: 0, quantityType: 'duration', unit: '天', kind: 'assumption', status: 'available', origin: '待谈条款，相对交货日' },
      { id: 'received', label: '客户实际回款日', value: 7, quantityType: 'duration', unit: '天', kind: 'assumption', status: 'available', origin: '第7天最早回款反事实，不是到账承诺' },
    ],
    options: [{ id: 'order', label: '订单', description: '桌面推演' }], calculations: [], checks: [],
    cashFlows: [{ id: 'flow', label: '回款前资金', optionId: 'order', unit: 'CNY', timeAnchor: '交货日', openingBalance: { input: 'cash' },
      // 故意把收款放在数组前面，验证实际排序而不是碰巧沿用声明顺序。
      entries: [
        { id: 'collect', label: '客户回款', direction: 'inflow', amount: { input: 'collection' }, at: { input: 'received' } },
        { id: 'rest', label: '总价减首款的尾款', direction: 'outflow', amount: { op: 'subtract', left: { input: 'total' }, right: { input: 'first' } }, at: { input: 'due' } },
        { id: 'first', label: '开工首款', direction: 'outflow', amount: { input: 'first' }, at: { literal: -5 } },
      ],
    }],
  };
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
      entries: [{ id: 'first' }, { id: 'rest' }, { id: 'collect' }],
      timingThresholds: expect.arrayContaining([
        expect.objectContaining({ inputId: 'due', status: 'available', zeroShortfallRanges: [{ lower: 7, upper: null, lowerInclusive: false, upperInclusive: false }] }),
        expect.objectContaining({ inputId: 'received', zeroShortfallRanges: [{ lower: null, upper: 0, lowerInclusive: false, upperInclusive: false }] }),
      ]),
    });
    const due = record.model.inputs.find(input => input.id === 'due'); if (!due) throw new Error('Fixture');
    const update = (revision: number, value: number) => run(['update', record.id, '--expected-revision', String(revision), '--json', JSON.stringify({ reason: '明确新的尾款日', inputs: [{ ...due, value }] })]);
    expect(update(1, 7)).toMatchObject({ evaluation: { cashFlows: [{ minimumBalance: -225, shortfall: 225, entries: [{ id: 'first' }, { id: 'rest' }, { id: 'collect' }] }] } });
    expect(update(2, 8)).toMatchObject({ evaluation: { cashFlows: [{ minimumBalance: 30, shortfall: 0, entries: [{ id: 'first' }, { id: 'collect' }, { id: 'rest' }] }] } });
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
    expect(() => run(['update', record.id, '--expected-revision', '2', '--json', JSON.stringify({ reason: '把金额错当时点', cashFlows: proposed.cashFlows?.map(flow => ({ ...flow, entries: flow.entries.map(entry => ({ ...entry, at: { input: 'cash' } })) })) })])).toThrow('quantityType=duration');
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_record_versions').get()).toEqual({ n: 2 });
  } finally { db.close(); }
});

it('does not invent date thresholds for nonlinear dates or date-dependent amounts', () => {
  const { db, run } = setup();
  try {
    for (const kind of ['nonlinear', 'amount_dependency']) {
      const proposed = model();
      proposed.cashFlows = proposed.cashFlows?.map(flow => ({ ...flow, entries: flow.entries.map(entry => entry.id !== 'rest' ? entry : {
        ...entry,
        ...(kind === 'nonlinear' ? { at: { op: 'multiply' as const, left: { input: 'due' }, right: { input: 'due' } } }
          : { amount: { op: 'add' as const, left: entry.amount, right: { input: 'due' } } }),
      }) }));
      const created = run(['create', '--json', JSON.stringify(proposed)]);
      expect(created).toMatchObject({ evaluation: { cashFlows: [{ timingThresholds: expect.arrayContaining([
        expect.objectContaining({ inputId: 'due', status: 'unavailable', zeroShortfallRanges: null }),
      ]) }] } });
    }
  } finally { db.close(); }
});

it('migrates historical undated flows to explicit unknowns without changing their amounts or author advice', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
    for (const migration of decisionMigrations.filter(item => item.version < 4)) migration.up(db);
    const proposed = model();
    const oldModel = { ...proposed, cashFlows: proposed.cashFlows?.map(({ timeAnchor: _anchor, ...flow }) => ({ ...flow, entries: flow.entries.map(({ at: _at, ...entry }) => entry) })) };
    const id = '40be6192-0938-44cf-9180-47edb2dd3910';
    const advice = { basedOnInputRevision: 1, content: { optionIds: ['order'], rationale: '旧作者文字原样保留', changeConditions: '旧变化条件', nextAction: '旧计划', unresolved: [] } };
    for (const revision of [1, 2]) db.prepare('INSERT INTO decision_record_versions VALUES(?,?,?,?,?)').run(id, 'p', revision, JSON.stringify({ schemaVersion: 2, id, revision, inputRevision: 1, reason: '旧版', model: oldModel, recommendation: advice }), 15);
    for (const migration of decisionMigrations.filter(item => item.version === 4)) migration.up(db);
    const parsed = parseDecisionCli(['read', id]); if (parsed.kind !== 'read') throw new Error('Read');
    const read = executeDecisionCommand(parsed, db, 'p');
    if (typeof read !== 'object' || read === null || !('record' in read) || !('evaluation' in read)) throw new Error('Read');
    const migrated = DecisionRecordSchema.parse(read.record);
    expect(migrated.schemaVersion).toBe(3); expect(migrated.revision).toBe(2); expect(migrated.inputRevision).toBe(1); expect(migrated.recommendation).toEqual(advice);
    expect(migrated.model.cashFlows?.[0].timeAnchor).toBeNull(); expect(migrated.model.cashFlows?.[0].entries.every(entry => entry.at === null)).toBe(true);
    expect(read.evaluation.cashFlows?.[0]).toMatchObject({ status: 'needs_information', shortfall: null });
    expect(migrated.model.cashFlows?.[0].entries.map(({ at: _at, ...entry }) => entry)).toEqual(oldModel.cashFlows?.[0].entries);
    expect(db.prepare('SELECT revision, created_at FROM decision_record_versions ORDER BY revision').all()).toEqual([{ revision: 1, created_at: 15 }, { revision: 2, created_at: 15 }]);
  } finally { db.close(); }
});
