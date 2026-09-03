import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceNodeDeduplicationPlan,
  createUniqueWorkspaceNodeCopyName,
  createUniqueWorkspaceNodeName,
} from '../uniqueWorkspaceNodeName';

describe('uniqueWorkspaceNodeName', () => {
  it('基础重名生成编号名称', () => {
    expect(createUniqueWorkspaceNodeName({
      desiredName: 'A',
      existingNames: ['A'],
    })).toBe('A (1)');
  });

  it('已有编号时递增到第一个可用编号', () => {
    expect(createUniqueWorkspaceNodeName({
      desiredName: 'A',
      existingNames: ['A', 'A (1)'],
    })).toBe('A (2)');
  });

  it('有扩展名时保留扩展名在末尾', () => {
    expect(createUniqueWorkspaceNodeName({
      desiredName: '报告.md',
      existingNames: ['报告.md'],
    })).toBe('报告 (1).md');
  });

  it('副本名在扩展名前追加后缀', () => {
    expect(createUniqueWorkspaceNodeCopyName({
      sourceName: '报告.md',
      existingNames: ['报告.md'],
    })).toBe('报告 副本.md');

    expect(createUniqueWorkspaceNodeCopyName({
      sourceName: '报告.md',
      existingNames: ['报告.md', '报告 副本.md'],
    })).toBe('报告 副本 (1).md');
  });

  it('历史重名改名计划保留最早创建的原名', () => {
    expect(buildWorkspaceNodeDeduplicationPlan([
      { id: 'node-2', name: 'A', createdAt: 20 },
      { id: 'node-1', name: 'A', createdAt: 10 },
      { id: 'node-3', name: 'A', createdAt: 30 },
    ])).toEqual([
      { nodeId: 'node-2', oldName: 'A', newName: 'A (1)' },
      { nodeId: 'node-3', oldName: 'A', newName: 'A (2)' },
    ]);
  });
});
