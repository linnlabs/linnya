// @vitest-environment jsdom

import { createApp, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import ConversationAnswerActions from './ConversationAnswerActions.vue';

describe('ConversationAnswerActions lifecycle', () => {
  let app: App<Element> | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
  });

  it('run settle 只启用既有操作区，不重新挂载 footer DOM', async () => {
    const disabled = ref(true);
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp({
      render: () => h(ConversationAnswerActions, {
        variant: 'turn',
        copyTitle: 'copy',
        saveTitle: 'save',
        copiedText: 'copied',
        savedStatusText: 'saved',
        showCopiedText: false,
        showSavedText: false,
        isSaving: false,
        disabled: disabled.value,
      }),
    });

    app.mount(mountPoint);
    await nextTick();
    const rootBeforeSettle = mountPoint.querySelector('.conversation-answer-actions');
    expect(rootBeforeSettle?.classList.contains('is-disabled')).toBe(true);
    expect(Array.from(mountPoint.querySelectorAll('button')).every(button => button.disabled)).toBe(true);

    disabled.value = false;
    await nextTick();

    expect(mountPoint.querySelector('.conversation-answer-actions')).toBe(rootBeforeSettle);
    expect(rootBeforeSettle?.classList.contains('is-disabled')).toBe(false);
    expect(Array.from(mountPoint.querySelectorAll('button')).every(button => !button.disabled)).toBe(true);
  });

  it('复制与保存反馈只切换稳定原生节点，不替换图标 DOM', async () => {
    const showCopiedText = ref(false);
    const showSavedText = ref(false);
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp({
      render: () => h(ConversationAnswerActions, {
        variant: 'turn',
        copyTitle: 'copy',
        saveTitle: 'save',
        copiedText: 'copied',
        savedStatusText: 'saved',
        showCopiedText: showCopiedText.value,
        showSavedText: showSavedText.value,
        isSaving: false,
      }),
    });

    app.mount(mountPoint);
    await nextTick();
    const saveIcon = mountPoint.querySelector<HTMLElement>('.save-action-icon');
    const copyIcon = mountPoint.querySelector<HTMLElement>('.copy-action-icon');
    const saveText = saveIcon?.parentElement?.querySelector<HTMLElement>('.action-text');
    const copyText = copyIcon?.parentElement?.querySelector<HTMLElement>('.action-text');
    const saveSvg = saveIcon?.querySelector('svg');
    const copySvg = copyIcon?.querySelector('svg');
    expect(saveIcon?.hidden).toBe(false);
    expect(copyIcon?.hidden).toBe(false);
    expect(saveText?.hidden).toBe(true);
    expect(copyText?.hidden).toBe(true);

    showCopiedText.value = true;
    await nextTick();
    expect(copyIcon?.hidden).toBe(true);
    expect(copyText?.hidden).toBe(false);
    expect(copyIcon?.querySelector('svg')).toBe(copySvg);

    showCopiedText.value = false;
    showSavedText.value = true;
    await nextTick();
    expect(copyIcon?.hidden).toBe(false);
    expect(copyText?.hidden).toBe(true);
    expect(saveIcon?.hidden).toBe(true);
    expect(saveText?.hidden).toBe(false);
    expect(saveIcon?.querySelector('svg')).toBe(saveSvg);
  });
});
