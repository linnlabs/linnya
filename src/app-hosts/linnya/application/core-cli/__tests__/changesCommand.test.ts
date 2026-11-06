import { expect, it } from 'vitest';
import type { ActionLedgerDocumentChange } from 'src/domains/action-ledger';
import { parseChangesCommand } from '../functions/parseChangesCommand';
import { formatDocumentChanges } from '../functions/formatDocumentChanges';

it('昨天、显式半开区间和运行过滤可交叉使用，拒绝不存在的日期与倒序区间', () => {
  const now = new Date(2028, 2, 1, 15);
  const range = parseChangesCommand(['--since', '2028-02-29', '--until', '2028-03-01', '--run', 'root'], now);
  expect(range).toEqual(parseChangesCommand(['--day', 'yesterday', '--run', 'root'], now));
  expect(range).toMatchObject({ since: new Date(2028, 1, 29).getTime(), until: new Date(2028, 2, 1).getTime() });
  expect(() => parseChangesCommand(['--day', '2027-02-29'], now)).toThrow('无效日期');
  expect(() => parseChangesCommand(['--since', '2028-03-02', '--until', '2028-03-01'], now)).toThrow('until');
});

it('超过 Shell 可展示的范围时只返回完整行，且留下看得见的截断提示', () => {
  const entry: ActionLedgerDocumentChange = {
    documentId: 'first', documentType: 'document', actorKind: 'user', pluginId: null,
    runId: null, rootRunId: null, parentRunId: null, conversationId: null,
    actions: ['update'], entryCount: 1, granularity: 'coarse', firstRecordedAt: 1, lastRecordedAt: 2,
  };
  const output = formatDocumentChanges({ truncated: false, changes: [entry, { ...entry, documentId: 'long' }] },
    id => id === 'first' ? 'workspace:/短.md' : '文'.repeat(1000), 600);
  expect(output.length).toBeLessThanOrEqual(600);
  expect(JSON.parse(output)).toMatchObject({ truncated: true, notice: expect.any(String),
    changes: [expect.objectContaining({ documentId: 'first' })] });
});
