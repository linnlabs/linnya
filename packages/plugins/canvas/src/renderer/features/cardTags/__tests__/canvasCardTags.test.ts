import { expect, it } from 'vitest';
import {
  CanvasTextCardSchema,
  createCanvasPlainTextDocument,
  readCanvasCardTags,
  type CanvasCard,
} from '@plugin/canvas/shared';
import { buildCanvasStatusCommands, buildCanvasTagToggleCommands, readCanvasTagMenuChoice } from '..';

const source = { kind: 'user', conversationId: null, runId: null } as const;
const card = (id: string, extra: Partial<CanvasCard> = {}) =>
  CanvasTextCardSchema.parse({ schemaVersion: 1, revision: 2, order: 'a0', color: 'white', locked: false, createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0,
    type: 'text', id, x: 0, y: 0, width: 100, height: 60, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument(id), heightMode: 'auto' }, ...extra });
// t-old 已合并进 t-evidence；t-gone 已删除。
const names = new Map([['t-evidence', { id: 't-evidence', name: '证据' }], ['t-old', { id: 't-evidence', name: '证据' }], ['t-pending', { id: 't-pending', name: '待查' }]]);

it('显示时旧 ID 跟到合并目标并去重，删除的标签不显示，与状态相同的标签不重复列出', () => {
  expect(readCanvasCardTags({ tags: ['t-old', 't-evidence', 't-gone', 't-pending'], status: 't-pending' }, names)).toEqual({
    status: { id: 't-pending', name: '待查' }, tags: [{ id: 't-evidence', name: '证据' }],
  });
});

it('菜单勾标签：都带着就全部取下（含合并前的旧 ID），否则只给没带的卡挂上；锁定卡不改', () => {
  const elements = [card('c1', { tags: ['t-old'] }), card('c2'), card('c3', { locked: true })];
  expect(buildCanvasTagToggleCommands({ elements, ids: ['c1', 'c2', 'c3'], names, tagId: 't-evidence' })).toEqual([
    { op: 'update', id: 'c2', baseRevision: 2, patch: { tags: ['t-evidence'] } },
  ]);
  const tagged = [card('c1', { tags: ['t-old', 't-pending'] }), card('c2', { tags: ['t-evidence'] })];
  expect(buildCanvasTagToggleCommands({ elements: tagged, ids: ['c1', 'c2'], names, tagId: 't-evidence' }).map(command => command.op === 'update' && command.patch)).toEqual([
    { tags: ['t-pending'] }, { tags: [] },
  ]);
});

it('设定与清除状态只提交有变化的卡；菜单值按前缀读出', () => {
  const elements = [card('c1', { status: 't-pending' }), card('c2')];
  expect(buildCanvasStatusCommands({ elements, ids: ['c1', 'c2'], names, tagId: 't-pending' }).map(command => command.op === 'update' && command.id)).toEqual(['c2']);
  expect(buildCanvasStatusCommands({ elements, ids: ['c1', 'c2'], names, tagId: null })).toEqual([
    { op: 'update', id: 'c1', baseRevision: 2, patch: { status: null } },
  ]);
  expect([readCanvasTagMenuChoice('tag:t1'), readCanvasTagMenuChoice('status:t1'), readCanvasTagMenuChoice('status:'), readCanvasTagMenuChoice('color:red')]).toEqual([
    { kind: 'tag', id: 't1' }, { kind: 'status', id: 't1' }, { kind: 'status', id: null }, null,
  ]);
});
