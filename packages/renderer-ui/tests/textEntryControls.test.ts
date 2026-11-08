// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, type App, type VNode } from 'vue';
import {
  applyTextareaAutoResize,
  CustomTextarea,
  CustomTextInput,
  InlineTextInput,
  SecretInput,
} from '@linnya/renderer-ui';

interface MountedSecretInput {
  readonly host: HTMLDivElement;
  readonly input: HTMLInputElement;
  readonly toggle: HTMLButtonElement;
  readonly emitted: string[];
  unmount(): void;
}

function mountSecretInput(options: {
  readonly modelValue?: string;
  readonly disabled?: boolean;
  readonly ephemeral?: boolean;
} = {}): MountedSecretInput {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const emitted: string[] = [];
  const app = createApp({
    render: () => h(SecretInput, {
      modelValue: options.modelValue ?? 'stored-secret',
      disabled: options.disabled,
      ephemeral: options.ephemeral,
      'onUpdate:modelValue': (value: string) => emitted.push(value),
    }),
  });
  app.mount(host);

  const input = host.querySelector('.secret-input__control');
  const toggle = host.querySelector('.secret-input__toggle');
  if (!(input instanceof HTMLInputElement) || !(toggle instanceof HTMLButtonElement)) {
    throw new Error('SecretInput controls not found');
  }

  return {
    host,
    input,
    toggle,
    emitted,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

const mountedInputs: MountedSecretInput[] = [];
const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mountControl(render: () => VNode): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render });
  app.mount(host);
  mountedApps.push({ app, host });
  return host;
}

afterEach(() => {
  while (mountedInputs.length > 0) mountedInputs.pop()?.unmount();
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('SecretInput', () => {
  it('defaults to a masked input and toggles visibility with shared labels', async () => {
    const mounted = mountSecretInput();
    mountedInputs.push(mounted);

    expect(mounted.input.type).toBe('password');
    expect(mounted.toggle.getAttribute('aria-label')).toBe('显示敏感内容');

    mounted.toggle.click();
    await nextTick();

    expect(mounted.input.type).toBe('text');
    expect(mounted.toggle.getAttribute('aria-label')).toBe('隐藏敏感内容');
  });

  it('emits edited values and routes focus to the native input', () => {
    const mounted = mountSecretInput();
    mountedInputs.push(mounted);

    mounted.input.value = 'new-secret';
    mounted.input.dispatchEvent(new Event('input', { bubbles: true }));
    mounted.input.focus();

    expect(mounted.emitted).toEqual(['new-secret']);
    expect(document.activeElement).toBe(mounted.input);
  });

  it('disables both editing and visibility controls', () => {
    const mounted = mountSecretInput({ disabled: true });
    mountedInputs.push(mounted);

    expect(mounted.input.disabled).toBe(true);
    expect(mounted.toggle.disabled).toBe(true);
  });

  it('临时模式只让原生输入短暂持有明文，不向 Vue 响应式边界发送内容', () => {
    const mounted = mountSecretInput({ ephemeral: true });
    mountedInputs.push(mounted);

    expect(mounted.input.value).toBe('');
    mounted.input.value = 'ephemeral-secret';
    mounted.input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(mounted.input.value).toBe('ephemeral-secret');
    expect(mounted.emitted).toEqual([]);
  });
});

describe('text entry controls', () => {
  it('CustomTextInput keeps input/change timing and exposes an owner-scoped native control class', async () => {
    const updates: string[] = [];
    const changes: string[] = [];
    const host = mountControl(() => h(CustomTextInput, {
      modelValue: 'before',
      clearable: true,
      class: 'consumer-root',
      controlClass: 'consumer-control',
      inputmode: 'search',
      'onUpdate:modelValue': (value: string) => updates.push(value),
      onChangeValue: (value: string) => changes.push(value),
    }));

    const root = host.querySelector('.tt-text-field');
    const input = host.querySelector('input');
    if (!(root instanceof HTMLSpanElement) || !(input instanceof HTMLInputElement)) {
      throw new Error('CustomTextInput controls not found');
    }

    expect(root.classList.contains('consumer-root')).toBe(true);
    expect(input.classList.contains('consumer-control')).toBe(true);
    expect(input.getAttribute('inputmode')).toBe('search');

    input.value = 'after';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();

    expect(updates).toEqual(['after']);
    expect(changes).toEqual(['after']);

    const clear = host.querySelector('.tt-text-field__clear');
    if (!(clear instanceof HTMLButtonElement)) throw new Error('CustomTextInput clear button not found');
    clear.click();
    await nextTick();

    expect(updates).toEqual(['after', '']);
    expect(changes).toEqual(['after', '']);
    expect(document.activeElement).toBe(input);
  });

  it('CustomTextarea preserves native attributes, change timing and auto-grow bounds', async () => {
    const updates: string[] = [];
    const changes: string[] = [];
    const host = mountControl(() => h(CustomTextarea, {
      modelValue: 'before',
      autoGrow: true,
      autoGrowMinHeight: 40,
      autoGrowMaxHeight: 100,
      controlClass: 'consumer-textarea',
      maxlength: 20,
      'onUpdate:modelValue': (value: string) => updates.push(value),
      onChangeValue: (value: string) => changes.push(value),
    }));

    const textarea = host.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('CustomTextarea control not found');
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 180 });

    textarea.value = 'after';
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();

    expect(textarea.classList.contains('consumer-textarea')).toBe(true);
    expect(textarea.maxLength).toBe(20);
    expect(updates).toEqual(['after']);
    expect(changes).toEqual(['after']);
    expect(textarea.style.height).toBe('100px');
    expect(textarea.style.overflowY).toBe('auto');
    expect(textarea.scrollTop).toBe(180);
  });

  it('applyTextareaAutoResize clamps height and follows scrolling only when the cursor is at the end', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'content';
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 220 });
    document.body.appendChild(textarea);

    textarea.setSelectionRange(2, 2);
    textarea.scrollTop = 7;
    expect(applyTextareaAutoResize(textarea, {
      minHeight: 40,
      maxHeight: 120,
      scrollToBottomWhenCursorAtEnd: true,
    })).toBe(120);
    expect(textarea.scrollTop).toBe(7);

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    applyTextareaAutoResize(textarea, {
      minHeight: 40,
      maxHeight: 120,
      scrollToBottomWhenCursorAtEnd: true,
    });
    expect(textarea.scrollTop).toBe(220);
    textarea.remove();
  });
});

describe('InlineTextInput', () => {
  function mountInline(options: { readonly autofocus?: boolean } = {}) {
    const events: string[] = [];
    const values: string[] = [];
    let parentKeys = 0;
    const host = mountControl(() =>
      h('div', { onKeydown: () => (parentKeys += 1) }, [
        h(InlineTextInput, {
          modelValue: '旧名称',
          autofocus: options.autofocus,
          'aria-label': '重命名',
          'onUpdate:modelValue': (value: string) => values.push(value),
          onCommit: (value: string) => events.push(`commit:${value}`),
          onCancel: () => events.push('cancel'),
        }),
      ])
    );
    const input = host.querySelector('input');
    if (!(input instanceof HTMLInputElement)) throw new Error('InlineTextInput not found');
    const key = (init: KeyboardEventInit) =>
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    return { input, events, values, key, parentKeys: () => parentKeys };
  }

  it('挂载即聚焦全选，输入同步草稿，宿主收不到键盘事件', () => {
    const { input, values, key, parentKeys } = mountInline();
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
    expect(input.getAttribute('aria-label')).toBe('重命名');
    input.value = '新名称';
    input.dispatchEvent(new Event('input'));
    expect(values).toEqual(['新名称']);
    key({ key: 'a' });
    expect(parentKeys()).toBe(0);
  });

  it('回车提交一次，之后的失焦不再重复提交', () => {
    const { input, events, key } = mountInline();
    input.value = '新名称';
    expect(key({ key: 'Enter' })).toBe(false);
    input.blur();
    expect(events).toEqual(['commit:新名称']);
  });

  it('宿主保存失败保留编辑框时，改字后回车可以再次提交', () => {
    const { input, events, key } = mountInline();
    key({ key: 'Enter' });
    key({ key: 'Enter' });
    input.value = '再试一次';
    input.dispatchEvent(new Event('input'));
    key({ key: 'Enter' });
    expect(events).toEqual(['commit:旧名称', 'commit:再试一次']);
  });

  it('输入法组字中的回车与 Esc 不结束编辑', () => {
    const { events, key } = mountInline();
    key({ key: 'Enter', isComposing: true });
    key({ key: 'Enter', keyCode: 229 });
    key({ key: 'Escape', isComposing: true });
    expect(events).toEqual([]);
  });

  it('Esc 取消，取消后的失焦不提交；失焦本身算提交', () => {
    const first = mountInline();
    first.key({ key: 'Escape' });
    first.input.blur();
    expect(first.events).toEqual(['cancel']);
    const second = mountInline();
    second.input.blur();
    expect(second.events).toEqual(['commit:旧名称']);
  });

  it('关掉自动聚焦时由宿主调用 focus/select', () => {
    const { input } = mountInline({ autofocus: false });
    expect(document.activeElement).not.toBe(input);
  });
});
