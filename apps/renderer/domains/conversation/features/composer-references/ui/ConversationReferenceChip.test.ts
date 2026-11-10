// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- 用同一集成场景验证宿主和动态贡献组件的挂载边界。 */
import { createApp, defineComponent, h, nextTick, onMounted, onUnmounted } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import ConversationReferenceChip from './ConversationReferenceChip.vue';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('聚焦才挂载只读预览，进入弹层保持，Escape和移除均释放组件', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const mounted = vi.fn(), disposed = vi.fn(), activate = vi.fn(async () => {});
  const preview = defineComponent({ setup() { onMounted(mounted); onUnmounted(disposed); return () => h('button', { 'data-preview': '' }, '详情'); } });
  const host = document.createElement('div'); document.body.append(host);
  const app = createApp({ render: () => h(ConversationReferenceChip, {
    reference: { id: 'ref', pluginId: 'owner', kind: 'opaque', label: '引用', previewText: '摘要', text: '正文' },
    presentation: { label: '引用', preview: '摘要', previewComponent: preview, activate }, removeLabel: '移除',
  }) });
  try {
    app.mount(host);
    expect(mounted).not.toHaveBeenCalled();
    const trigger = host.querySelector<HTMLButtonElement>('.ai-assistant-quote-preview__pill-action');
    trigger?.focus(); await nextTick(); await nextTick();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.conversation-reference-hover__content--owned')).not.toBeNull();
    host.firstElementChild?.dispatchEvent(new MouseEvent('mouseleave'));
    document.querySelector('.conversation-reference-hover')?.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(250);
    expect(disposed).not.toHaveBeenCalled();
    document.querySelector('[data-preview]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick(); expect(disposed).toHaveBeenCalledTimes(1);
    trigger?.click(); await nextTick(); expect(activate).toHaveBeenCalledTimes(1);
    trigger?.dispatchEvent(new FocusEvent('focus')); await nextTick(); await nextTick();
    expect(mounted).toHaveBeenCalledTimes(2);
    app.unmount(); expect(disposed).toHaveBeenCalledTimes(2);
  } finally { app.unmount(); host.remove(); }
});
it('kind声明不弹预览时，悬停和聚焦都不出弹层，点击仍交回owner', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const activate = vi.fn(async () => {});
  const host = document.createElement('div'); document.body.append(host);
  const app = createApp({ render: () => h(ConversationReferenceChip, {
    reference: { id: 'ref', pluginId: 'owner', kind: 'opaque', label: '引用', previewText: '摘要', text: '正文' },
    presentation: { label: '引用', preview: '摘要', hoverPreview: false, activate }, removeLabel: '移除',
  }) });
  try {
    app.mount(host);
    const trigger = host.querySelector<HTMLButtonElement>('.ai-assistant-quote-preview__pill-action');
    host.firstElementChild?.dispatchEvent(new MouseEvent('mouseenter'));
    trigger?.focus(); await vi.advanceTimersByTimeAsync(500); await nextTick();
    expect(document.querySelector('.conversation-reference-hover')).toBeNull();
    trigger?.click(); await nextTick(); expect(activate).toHaveBeenCalledTimes(1);
  } finally { app.unmount(); host.remove(); }
});
