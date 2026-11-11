import { expect, it } from 'vitest';
import { CanvasCliBatchSchema } from '../../../../shared/cli/definitions/canvasCli';
import { parseCanvasCli } from '../functions/parseCanvasCli';

it('子命令help不要求文档路径或写参数，也不会进入写流程', () => {
  for (const argv of [['arrange', '--help'], ['apply', '-h'], ['render', 'workspace:/讨论.canvas', '--help'], ['-h']]) expect(parseCanvasCli(argv)).toEqual({ kind: 'help' });
  expect(() => parseCanvasCli(['unknown-command', '--help'])).toThrow('未知子命令');
});

it('requires explicit stable mutation IDs and keeps Agent-only paths and options narrow', () => {
  for (const op of ['delete', 'disconnect']) {
    expect(CanvasCliBatchSchema.safeParse([{ op, id: op === 'delete' ? 'c1' : 'e1' }]).success).toBe(false);
    expect(CanvasCliBatchSchema.safeParse([{ op, id: op === 'delete' ? 'c1' : 'e1', revision: 1 }]).success).toBe(true);
  }
  expect(parseCanvasCli(['apply', 'workspace:/讨论.canvas', '--ops-file', 'batch.json', '--request-id', 'retry-1', '--dry-run'])).toMatchObject({ kind: 'apply', requestId: 'retry-1', dryRun: true });
  expect(() => parseCanvasCli(['apply', 'workspace:/讨论.canvas', '--ops-file', 'batch.json'])).toThrow('request-id');
  expect(() => parseCanvasCli(['check', '/etc/passwd'])).toThrow('workspace:');
  expect(() => parseCanvasCli(['render', 'workspace:/讨论.canvas', '--output', '/tmp/anywhere'])).toThrow();
  expect(() => parseCanvasCli(['apply', 'workspace:/讨论.canvas', '--approved'])).toThrow();
  expect(parseCanvasCli(['arrange', 'workspace:/讨论.canvas', '--request-id', 'a', '--algorithm', 'grid', '--scope', 'c1,c2', '--columns', '2'])).toMatchObject({ options: { algorithm: 'grid', elementIds: ['c1', 'c2'], columns: 2 } });
});
it('bounds raw model operations while allowing a final semantic arrange and strict card fields', () => {
  expect(CanvasCliBatchSchema.parse([{ op: 'add', ref: '$new', text: '新卡' }, { op: 'arrange', algorithm: 'tree', elementIds: ['$new'] }])).toHaveLength(2);
  expect(() => CanvasCliBatchSchema.parse([{ op: 'arrange' }, { op: 'add', text: '逆序' }])).toThrow('最后');
  expect(() => CanvasCliBatchSchema.parse(Array.from({ length: 501 }, () => ({ op: 'add', text: '同样正文是合法的新卡' })))).toThrow();
  expect(() => CanvasCliBatchSchema.parse([{ op: 'add', text: '不允许坐标', x: 10 }])).toThrow();
  expect(() => CanvasCliBatchSchema.parse([{ op: 'update', id: 'c1', text: '缺版本' }])).toThrow();
});
it('changes 只接受一个范围：read 给出的提交序号，或 read/show 同格式的本机时间', () => {
  expect(parseCanvasCli(['changes', 'workspace:/讨论.canvas', '--after', '12'])).toEqual({ kind: 'changes', path: 'workspace:/讨论.canvas', after: 12 });
  expect(parseCanvasCli(['changes', 'workspace:/讨论.canvas', '--since', '2026-11-11 19:20'])).toEqual({ kind: 'changes', path: 'workspace:/讨论.canvas', since: new Date('2026-11-11 19:20').getTime() });
  for (const argv of [[], ['--after', '1', '--since', '2026-11-11 19:20'], ['--after', '-1'], ['--after', '1.5'], ['--since', '昨天']])
    expect(() => parseCanvasCli(['changes', 'workspace:/讨论.canvas', ...argv])).toThrow();
});
