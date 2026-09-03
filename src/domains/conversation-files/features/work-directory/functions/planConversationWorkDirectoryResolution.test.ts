import { describe, expect, it } from 'vitest';

import {
  planConversationWorkDirectoryResolution,
} from './planConversationWorkDirectoryResolution';

describe('Conversation work directory lifecycle rules', () => {
  it.each([
    {
      label: '首次创建时先发布 owner，再发布 initialized',
      state: { ownerExists: false, initializedExists: false, directoryExists: false },
      expected: {
        ownerAction: 'publish',
        initializedAction: 'publish',
        resolutionStatus: 'created',
      },
    },
    {
      label: 'owner 发布后崩溃可以继续首次初始化',
      state: { ownerExists: true, initializedExists: false, directoryExists: false },
      expected: {
        ownerAction: 'reuse',
        initializedAction: 'publish',
        resolutionStatus: 'created',
      },
    },
    {
      label: '目录创建后崩溃可以继续首次初始化',
      state: { ownerExists: true, initializedExists: false, directoryExists: true },
      expected: {
        ownerAction: 'reuse',
        initializedAction: 'publish',
        resolutionStatus: 'created',
      },
    },
    {
      label: '完整生命周期直接复用',
      state: { ownerExists: true, initializedExists: true, directoryExists: true },
      expected: {
        ownerAction: 'reuse',
        initializedAction: 'reuse',
        resolutionStatus: 'existing',
      },
    },
    {
      label: 'initialized 存在但目录丢失时允许重建',
      state: { ownerExists: true, initializedExists: true, directoryExists: false },
      expected: {
        ownerAction: 'reuse',
        initializedAction: 'reuse',
        resolutionStatus: 'recreated_missing',
      },
    },
  ])('$label', ({ state, expected }) => {
    expect(planConversationWorkDirectoryResolution(state)).toEqual(expected);
  });

  it.each([
    { initializedExists: false, directoryExists: true, code: 'work_directory_path_occupied' },
    { initializedExists: true, directoryExists: false, code: 'work_directory_unsafe_entry' },
    { initializedExists: true, directoryExists: true, code: 'work_directory_unsafe_entry' },
  ])(
    'owner 缺失时拒绝不受 Linnya 所有的状态 %#',
    ({ initializedExists, directoryExists, code }) => {
      expect(() => planConversationWorkDirectoryResolution({
        ownerExists: false,
        initializedExists,
        directoryExists,
      })).toThrow(expect.objectContaining({ code }));
    },
  );

  it('目录缺失结果在观察时冻结，不取决于随后哪个 adapter 抢到 mkdir', () => {
    const plan = planConversationWorkDirectoryResolution({
      ownerExists: true,
      initializedExists: true,
      directoryExists: false,
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(plan.resolutionStatus).toBe('recreated_missing');
  });
});
