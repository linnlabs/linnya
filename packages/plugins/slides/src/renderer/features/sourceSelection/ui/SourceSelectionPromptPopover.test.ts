// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import SourceSelectionPromptPopover from './SourceSelectionPromptPopover.vue';
import type {
  SourceSelectableElement,
  SourceSelectionPromptPosition,
} from '..';

vi.mock('@linnya/renderer-ui/icons', () => ({
  CloseIcon: { template: '<span class="mock-close-icon" />' },
  EnterLeftIcon: { template: '<span class="mock-enter-left-icon" />' },
  LinnyaIcon: { template: '<span class="mock-linnya-icon" />' },
}));

const TARGET: SourceSelectableElement = {
  elementId: 'shape-1',
  slideId: 's1',
  kind: 'shape',
  sourceSpan: { startLine: 10, endLine: 12 },
  polygon: [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
  ],
  summary: 'shape rect',
};

const POSITION: SourceSelectionPromptPosition = {
  leftPx: 120,
  topPx: 160,
  placement: 'below',
};

const mountedApps: Array<() => void> = [];

afterEach(() => {
  mountedApps.splice(0).forEach((unmount) => unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPrompt(handlers: {
  onSubmit?: (instruction: string) => void;
  onCancel?: () => void;
}): void {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(SourceSelectionPromptPopover, {
    targets: [TARGET],
    position: POSITION,
    disabled: false,
    onSubmit: handlers.onSubmit,
    onCancel: handlers.onCancel,
  });
  app.mount(host);
  mountedApps.push(() => {
    app.unmount();
    host.remove();
  });
}

function textarea(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>('.source-selection-prompt__textarea');
  if (!element) {
    throw new Error('Expected source selection prompt textarea to be mounted');
  }
  return element;
}

async function flushPromptVisibility(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

describe('SourceSelectionPromptPopover', () => {
  it('submits with Enter and keeps Shift+Enter for multiline input', async () => {
    const onSubmit = vi.fn();
    mountPrompt({ onSubmit });
    await flushPromptVisibility();
    const input = textarea();

    input.value = '把图片改成圆角矩形';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(onSubmit).not.toHaveBeenCalled();

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
    expect(onSubmit).toHaveBeenCalledWith('把图片改成圆角矩形');
  });

  it('cancels with Escape or outside pointer down', async () => {
    const onCancel = vi.fn();
    mountPrompt({ onCancel });
    await flushPromptVisibility();

    textarea().dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    document.body.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
