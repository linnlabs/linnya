// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, onUnmounted } from 'vue';
import { createPinia } from 'pinia';
import { expect, it, vi } from 'vitest';
import { useLocalizationStore } from '@/app/localization';
import DocumentHistoryPanel from './DocumentHistoryPanel.vue';

const port = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn() }));
vi.mock('../infrastructure/historyPanelIpc', () => ({ historyPanelIpc: port }));

it('真实面板选历史、确认恢复并刷新 current；切换语言和卸载预览正常', async () => {
  const rows = [
    { versionId: 'new', order: 2, createdAt: 2000, isCurrent: true },
    { versionId: 'old', order: 1, createdAt: 1000, isCurrent: false },
  ];
  port.list.mockResolvedValue({ success: true, recent: rows, earlier: [] });
  port.restore.mockResolvedValue({
    success: true,
    current: { versionId: 'restored', order: 3, createdAt: 3000, isCurrent: true },
  });
  const disposed = vi.fn();
  const preview = defineComponent({
    props: { versionId: String },
    setup(props) {
      onUnmounted(() => disposed(props.versionId));
      return () => h('output', { 'data-version': props.versionId }, props.versionId);
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const pinia = createPinia();
  const app = createApp({
    render: () => h(DocumentHistoryPanel, { documentId: 'doc', previewComponent: preview }),
  }).use(pinia);
  const flush = async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    await nextTick();
  };
  const restoreButtons = () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
      button => button.textContent?.trim() === '恢复此版本'
    );
  try {
    app.mount(host);
    await flush();
    expect(restoreButtons()[0].disabled).toBe(true);
    document.querySelectorAll<HTMLButtonElement>('.document-history-version')[1].click();
    await flush();
    expect(document.querySelector('output')?.textContent).toBe('old');
    expect(disposed).toHaveBeenCalledWith('new');
    restoreButtons()[0].click();
    await flush();
    expect(port.restore).not.toHaveBeenCalled();
    port.list.mockResolvedValue({
      success: true,
      recent: [{ versionId: 'restored', order: 3, createdAt: 3000, isCurrent: true }],
      earlier: [],
    });
    restoreButtons().at(-1)?.click();
    await flush();
    expect(port.restore).toHaveBeenCalledExactlyOnceWith({
      documentId: 'doc',
      versionId: 'old',
      expectedCurrentVersionId: 'new',
    });
    expect(document.querySelector('output')?.textContent).toBe('restored');
    useLocalizationStore(pinia).setCurrentLocale('en-US');
    await nextTick();
    expect(document.body.textContent).toContain('Version history');
  } finally {
    app.unmount();
    host.remove();
  }
  expect(disposed).toHaveBeenCalledWith('restored');
});
