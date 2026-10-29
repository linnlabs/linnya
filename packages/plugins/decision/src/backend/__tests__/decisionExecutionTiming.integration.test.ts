import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { DecisionRecordSchema, type DecisionModel } from '../../shared';
import { decisionMigrations } from '../features/decision-record/persistence/migrations';
import { parseDecisionCli } from '../features/decision-cli/functions/parseDecisionCli';
import { executeDecisionCommand } from '../features/decision-cli/orchestration/executeDecisionCommand';
import { projectDecisionRecord } from '../features/decision-record/functions/updateDecisionRecord';

it('delivers an execution cutoff from the declared check, keeps equality and invalidates the old recommendation after travel changes', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p');");
    for (const migration of decisionMigrations) migration.up(db);
    const run = (argv: string[]) => {
      const command = parseDecisionCli(argv);
      if (command.kind === 'file') throw new Error('Inline test transport');
      return executeDecisionCommand(command, db, 'p');
    };
    const view = (value: unknown) => {
      if (typeof value !== 'object' || value === null || !('record' in value)) throw new Error('Record projection expected');
      return projectDecisionRecord(DecisionRecordSchema.parse(value.record));
    };
    const model: DecisionModel = {
      title: '最晚上车时点', question: '最慢45分钟行程能否在13:40前到场？',
      inputs: [
        { id: 'board', label: '坐上出租车时刻', value: null, quantityType: 'day_clock', unit: '分钟', kind: 'assumption', status: 'available', origin: '尚未发生的上车时点' },
        { id: 'travel', label: '最慢行程', value: 45, quantityType: 'duration', unit: '分钟', kind: 'fact', status: 'available', origin: '合成已知事实' },
        { id: 'deadline', label: '到场截止', value: 820, quantityType: 'day_clock', unit: '分钟', kind: 'constraint', status: 'available', origin: '合成用户要求' },
      ],
      options: [{ id: 'taxi', label: '出租车', description: '仅分析，不执行叫车' }],
      calculations: [{ id: 'arrival', label: '最慢到场时刻', quantityType: 'day_clock', unit: '分钟', expression: { op: 'add', left: { input: 'board' }, right: { input: 'travel' } } }],
      checks: [{ id: 'on_time', optionId: 'taxi', label: '最慢行程不晚于到场截止', left: { op: 'add', left: { input: 'board' }, right: { input: 'travel' } }, operator: 'lte', right: { input: 'deadline' } }],
    };
    const created = view(run(['create', '--json', JSON.stringify(model)]));
    const id = created.record.id;
    const preview = run(['check', id, '--expected-revision', '1', '--json', '{"optionIds":["taxi"]}']);
    expect(preview).toMatchObject({ persisted: false, overall: 'undetermined' });
    expect(JSON.stringify(preview)).toContain('775（12:55）');
    expect(JSON.stringify(preview)).toContain('820（13:40）');
    const basis = { calculationIds: ['arrival'], boundaries: [{ checkId: 'on_time', inputId: 'board' }] };
    const saved = view(run(['recommend', id, '--expected-revision', '1', '--json', JSON.stringify({
      optionIds: ['taxi'], rationale: '上车前按当前最慢行程核对', changeConditions: '行程或报到要求变化后重算',
      nextAction: '以程序上车边界为止损线；先确认车辆', unresolved: ['是否能按时上车'], numericBasis: basis,
    })]));
    if (saved.recommendationBasis?.status !== 'current') throw new Error('Current basis expected');
    expect(saved.recommendationBasis.boundaries[0].text).toContain('775（12:55）');
    expect(saved.recommendationBasis.boundaries[0].text).toContain('820（13:40）');
    // 作者只保存引用，程序每次从相应保存版重建数值；不引入另一份手填时刻。
    const report = run(['export', id, '--expected-revision', '2']);
    expect(JSON.stringify(report)).toContain('775（12:55）');
    expect(JSON.stringify(report)).toContain('820（13:40）');
    const at = (revision: number, value: number) => view(run(['update', id, '--expected-revision', String(revision), '--json', JSON.stringify({ reason: '上车时点确定', inputs: [{ ...model.inputs[0], value }] })]));
    expect(at(2, 775).evaluation.checks[0].passes).toBe(true);
    expect(at(3, 785).evaluation.checks[0].passes).toBe(false);
    const changed = view(run(['update', id, '--expected-revision', '4', '--json', JSON.stringify({ reason: '最慢行程改为55分钟', inputs: [{ ...model.inputs[1], value: 55 }] })]));
    expect(changed.recommendationBasis).toEqual({ status: 'needs_review', basedOnInputRevision: 1 });
    const fresh = run(['check', id, '--expected-revision', '5', '--json', '{"optionIds":["taxi"]}']);
    expect(JSON.stringify(fresh)).toContain('765（12:45）');
    const history = view(run(['read', id, '--revision', '2']));
    expect(history).toEqual(saved);
    expect(view(run(['read', id])).record.revision).toBe(5);
  } finally { db.close(); }
});
