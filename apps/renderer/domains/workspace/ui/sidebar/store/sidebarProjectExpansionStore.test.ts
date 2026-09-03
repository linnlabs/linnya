import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSidebarProjectExpansionStore } from './sidebarProjectExpansionStore';

describe('sidebarProjectExpansionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('切换项目展开态，并保持 ID 去重', () => {
    const store = useSidebarProjectExpansionStore();

    store.expandProject('project-1');
    store.expandProject('project-1');
    expect(store.expandedProjectIds).toEqual(['project-1']);

    store.toggleProject('project-1');
    expect(store.expandedProjectIds).toEqual([]);

    store.toggleProject('project-2');
    expect(store.expandedProjectIds).toEqual(['project-2']);
  });

  it('项目列表变化后清理不存在项目的展开态', () => {
    const store = useSidebarProjectExpansionStore();

    store.expandProject('project-1');
    store.expandProject('project-2');
    store.retainExistingProjects(['project-2', 'project-3']);

    expect(store.expandedProjectIds).toEqual(['project-2']);
  });
});
