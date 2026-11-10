// @vitest-environment jsdom
import { createApp, h, nextTick, reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/layout/composables/useLayoutLocalization', () => ({ useLayoutLocalization: () => ({ layoutMessage: (key: string) => key }) }));
vi.mock('@/domains/workspace/ui/sidebar', async () => import('@/domains/workspace/ui/sidebar/composables/useFixedDropdownPosition'));
import SidebarProjectNav from './SidebarProjectNav.vue';
describe('项目概览侧栏入口', () => {
  it.each(['chat', 'file'] as const)('%s 模式都可进入概览，并反映当前页面', async sidebarMode => {
    const props = reactive({ projectName: 'Project', sidebarMode, overviewSelected: false,
      chatSearchQuery: '', fileSearchQuery: '', showCreateMenu: false, createOptions: [] });
    const opened = vi.fn();
    const root = document.createElement('div'); document.body.append(root);
    const app = createApp({ render: () => h(SidebarProjectNav, { ...props, onOpenOverview: opened }) });
    try {
      app.mount(root);
      const entry = root.querySelector<HTMLButtonElement>('.project-nav-overview-entry');
      expect(entry).not.toBeNull(); entry?.click(); expect(opened).toHaveBeenCalledOnce();
      expect(entry?.hasAttribute('aria-current')).toBe(false);
      props.overviewSelected = true; await nextTick(); expect(entry?.getAttribute('aria-current')).toBe('page');
    } finally { app.unmount(); root.remove(); }
  });
});
