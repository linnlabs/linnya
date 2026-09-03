import { describe, expect, it } from 'vitest';
import { shouldRetainExpandedProjects } from './projectExpansionRetention';

describe('shouldRetainExpandedProjects', () => {
  it('项目列表首次加载前的空数组不能清理已恢复的展开态', () => {
    expect(shouldRetainExpandedProjects({
      isLoadingProjects: false,
      projectIds: [],
      hasObservedLoadedProjectList: false,
    })).toBe(false);
  });

  it('项目加载中不能清理展开态', () => {
    expect(shouldRetainExpandedProjects({
      isLoadingProjects: true,
      projectIds: ['project-1'],
      hasObservedLoadedProjectList: false,
    })).toBe(false);
  });

  it('加载到项目后可以清理不存在项目的展开态', () => {
    expect(shouldRetainExpandedProjects({
      isLoadingProjects: false,
      projectIds: ['project-1'],
      hasObservedLoadedProjectList: false,
    })).toBe(true);
  });

  it('已经观察过有效项目列表后，空列表可以用于清理展开态', () => {
    expect(shouldRetainExpandedProjects({
      isLoadingProjects: false,
      projectIds: [],
      hasObservedLoadedProjectList: true,
    })).toBe(true);
  });
});
