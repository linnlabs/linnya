import { expect, it } from 'vitest';
import { CanvasCliBatchSchema } from '../../../../shared/cli/definitions/canvasCli';
import { parseCanvasCli } from '../functions/parseCanvasCli';

it('子命令help不要求文档路径或写参数，也不会进入写流程', () => {
  for (const argv of [['arrange', '--help'], ['apply', '-h'], ['render', 'workspace:/讨论.canvas', '--help'], ['-h']]) expect(parseCanvasCli(argv)).toEqual({ kind: 'help' });
  expect(() => parseCanvasCli(['unknown-command', '--help'])).toThrow('未知子命令');
});

it('requires explicit stable mutation IDs and keeps Agent-only paths and options narrow', () => {
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
