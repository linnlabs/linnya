import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { DecisionRecordSchema, type DecisionModel } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';

const model: DecisionModel = { obligations: [],
  title: '时刻类型回归', question: '同一时刻类型不依赖单位文字',
  inputs: [
    { id: 'start', label: '出发', quantityType: 'day_clock', value: 510, unit: 'min', kind: 'fact', origin: '合成事实', status: 'available' },
    { id: 'travel', label: '耗时', quantityType: 'duration', value: 45, unit: '分钟', kind: 'fact', origin: '合成事实', status: 'available' },
  ],
  options: [{ obligationIds: [], id: 'b', label: 'B', description: '到场' }],
  calculations: [{ id: 'arrival', label: '到场', quantityType: 'day_clock', unit: 'min', expression: { op: 'add', left: { input: 'start' }, right: { input: 'travel' } } }],
  checks: [],
};

it('migrates every stored revision without changing advice, revision identities or source facts', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
    for (const migration of decisionMigrations.filter(item => item.version < 3)) migration.up(db);
    const id = '562ef923-394b-4bcb-9b6e-589f1b07de99';
    const [oldClock, oldDuration] = model.inputs.map(({ quantityType: _type, ...input }) => input);
    const old = { schemaVersion: 1, id, revision: 1, inputRevision: 1, reason: '原始记录', model: {
      ...model, inputs: [{ ...oldClock, unit: '当天00:00起分钟' }, oldDuration],
      calculations: model.calculations.map(({ quantityType: _type, ...item }) => item),
    }, recommendation: null };
    for (const revision of [1, 2]) db.prepare('INSERT INTO decision_record_versions VALUES (?, ?, ?, ?, ?)').run(id, 'p', revision, JSON.stringify({ ...old, revision }), 7);
    for (const migration of decisionMigrations.filter(item => item.version >= 3)) migration.up(db);
    const run = (argv: string[]) => {
      const command = parseDecisionCli(argv);
      if (command.kind === 'file') throw new Error('Inline expected');
      return executeDecisionCommand(command, db, 'p');
    };
    for (const revision of [1, 2]) {
      const view = run(['read', id, '--revision', String(revision)]);
      if (typeof view !== 'object' || view === null || !('record' in view)) throw new Error('Record expected');
      const record = DecisionRecordSchema.parse(view.record);
      expect(record.revision).toBe(revision); expect(record.inputRevision).toBe(1);
      expect(record.model.inputs.map(item => item.quantityType)).toEqual(['day_clock', 'other']);
      expect(record.model.calculations[0].quantityType).toBe('other');
      expect(record.model.inputs[0].value).toBe(510); expect(record.recommendation).toBeNull();
    }
    expect(db.prepare('SELECT revision, created_at FROM decision_record_versions ORDER BY revision').all()).toEqual([{ revision: 1, created_at: 7 }, { revision: 2, created_at: 7 }]);
    const [missingType] = model.inputs.map(({ quantityType: _type, ...input }) => input);
    expect(() => run(['create', '--json', JSON.stringify({ ...model, inputs: [missingType] })])).toThrow('quantityType');
    expect(db.prepare('SELECT COUNT(*) AS n FROM decision_record_versions').get()).toEqual({ n: 2 });
  } finally { db.close(); }
});

it('uses explicit clock types for formatting and atomic scenario rejection, not unit text', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
    for (const migration of decisionMigrations) migration.up(db);
    const run = (argv: string[]) => {
      const command = parseDecisionCli(argv);
      if (command.kind === 'file') throw new Error('Inline expected');
      return executeDecisionCommand(command, db, 'p');
    };
    const created = run(['create', '--json', JSON.stringify(model)]);
    if (typeof created !== 'object' || created === null || !('record' in created)) throw new Error('Record expected');
    const record = DecisionRecordSchema.parse(created.record);
    const advice = { optionIds: ['b'], rationale: '取证后再决定', nextAction: '核对', changeConditions: '条件变动', unresolved: [],
      conditionalAdvice: { cases: [{ id: 'late', label: '08:45出发', inputs: [{ inputId: 'start', value: 525 }], nextAction: '09:15到场' }], whenNonePass: '改计划', whenUndetermined: '补信息' } };
    expect(() => run(['recommend', record.id, '--expected-revision', '1', '--json', JSON.stringify(advice)])).toThrow('570（09:30）');
    const read = run(['read', record.id]);
    if (typeof read !== 'object' || read === null || !('record' in read)) throw new Error('Record expected');
    expect(DecisionRecordSchema.parse(read.record).revision).toBe(1);
    const report = run(['export', record.id, '--expected-revision', '1']);
    expect(JSON.stringify(report)).toContain('555（09:15）');
    // 单位文字与类型矛盾时仍遵守显式类型，不能恢复字符串特判。
    const durationModel = { ...model, inputs: model.inputs.map(item => ({ ...item, quantityType: 'duration', unit: '当天00:00起分钟' })), calculations: [] };
    const second = run(['create', '--json', JSON.stringify(durationModel)]);
    if (typeof second !== 'object' || second === null || !('record' in second)) throw new Error('Record expected');
    run(['recommend', DecisionRecordSchema.parse(second.record).id, '--expected-revision', '1', '--json', JSON.stringify(advice)]);
  } finally { db.close(); }
});
