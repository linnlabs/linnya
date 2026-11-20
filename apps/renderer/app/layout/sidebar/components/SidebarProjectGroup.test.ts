// @vitest-environment jsdom
import { createApp, h, nextTick, reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/domains/conversation/ui/SidebarChatList.vue', () => ({ default: { render: () => null } }));
vi.mock('@/domains/workspace/ui/useWorkspaceLocalization', () => ({ useWorkspaceLocalization: () => ({ workspaceMessage: (key: string) => key }) }));
vi.mock('@/domains/workspace/ui/sidebar', async () => ({
  ...await import('@/domains/workspace/ui/sidebar/composables/useFixedDropdownPosition'),
  buildProjectMenuOptions: () => [],
  isProjectDeleteDisabled: () => false,
}));
import SidebarProjectGroup from './SidebarProjectGroup.vue';
import type { Project } from '@/domains/workspace/store';

const project = { id: 'project-1', name: 'Project' } as Project;

function mountGroup() {
  const state = reactive({ isExpanded: false });
  const events: string[] = [];
  const root = document.createElement('div'); document.body.append(root);
  const app = createApp({ render: () => h(SidebarProjectGroup, {
    project, isExpanded: state.isExpanded,
    onCollapseTransitionStart: () => events.push('start'),
    onCollapseTransitionEnd: () => events.push('end'),
  }) });
  app.mount(root);
  return { state, events, unmount: () => { app.unmount(); root.remove(); } };
}

describe('项目分组展开动画上报', () => {
  it('动画中途整组卸载（展开后立刻进入项目）仍补发一次 end，侧栏滚动层才能解除冻结', async () => {
    const group = mountGroup();
    group.state.isExpanded = true;
    await nextTick();
    // 首次插入的 v-if + v-show 元素 Vue 会调两次 before-enter；关心的是“还有未收尾的开始”。
    expect(group.events).toContain('start');
    expect(group.events).not.toContain('end');
    group.unmount();
    expect(group.events.filter(event => event === 'end')).toHaveLength(1);
    expect(group.events[group.events.length - 1]).toBe('end');
  });

  it('没有进行中的动画时卸载不额外上报', () => {
    const group = mountGroup();
    group.unmount();
    expect(group.events).toEqual([]);
  });
});
