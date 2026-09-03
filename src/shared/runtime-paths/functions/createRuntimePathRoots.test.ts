import { describe, expect, it } from 'vitest';

import { createRuntimePathRoots } from './createRuntimePathRoots';

describe('createRuntimePathRoots', () => {
  it('冻结可以跨进程传递的绝对路径事实', () => {
    const roots = createRuntimePathRoots({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/data/linnya/AIService',
      workspaceRoot: '/documents/Linnya',
      workspaceRootIsCustom: false,
    });

    expect(roots).toEqual({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/data/linnya/AIService',
      workspaceRoot: '/documents/Linnya',
      workspaceRootIsCustom: false,
    });
    expect(Object.isFrozen(roots)).toBe(true);
  });

  it('拒绝依赖接收进程 cwd 的相对路径', () => {
    expect(() =>
      createRuntimePathRoots({
        developmentRoot: '/workspace/linnya',
        appDataRoot: 'AIService',
        workspaceRoot: '/documents/Linnya',
        workspaceRootIsCustom: false,
      })
    ).toThrow('appDataRoot 必须是绝对路径');
  });
});
