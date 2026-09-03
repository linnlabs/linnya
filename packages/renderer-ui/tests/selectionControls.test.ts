// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { Switch } from '@linnya/renderer-ui';

interface MountedSwitch {
  input: HTMLInputElement;
  emitted: boolean[];
  unmount: () => void;
}

function mountSwitch(options: {
  modelValue: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}): MountedSwitch {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const emitted: boolean[] = [];
  const app = createApp({
    render() {
      return h(Switch, {
        modelValue: options.modelValue,
        disabled: options.disabled,
        ariaLabel: options.ariaLabel ?? '测试开关',
        'onUpdate:modelValue': (value: boolean) => {
          emitted.push(value);
        },
      });
    },
  });

  app.mount(host);

  const input = host.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Switch input not found');
  }

  return {
    input,
    emitted,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

const mountedSwitches: MountedSwitch[] = [];

afterEach(() => {
  while (mountedSwitches.length > 0) {
    mountedSwitches.pop()?.unmount();
  }
});

describe('Switch', () => {
  it('reflects the checked state and accessible label', () => {
    const mounted = mountSwitch({ modelValue: true, ariaLabel: '启用插件' });
    mountedSwitches.push(mounted);

    expect(mounted.input.checked).toBe(true);
    expect(mounted.input.getAttribute('aria-label')).toBe('启用插件');
  });

  it('emits the next checked value when toggled', async () => {
    const mounted = mountSwitch({ modelValue: false });
    mountedSwitches.push(mounted);

    mounted.input.click();
    await nextTick();

    expect(mounted.emitted).toEqual([true]);
  });

  it('does not emit when disabled', async () => {
    const mounted = mountSwitch({ modelValue: false, disabled: true });
    mountedSwitches.push(mounted);

    mounted.input.click();
    await nextTick();

    expect(mounted.input.disabled).toBe(true);
    expect(mounted.emitted).toEqual([]);
  });
});
