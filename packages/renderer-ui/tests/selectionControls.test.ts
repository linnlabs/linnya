// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { CustomCheckbox, CustomRadio, Switch, TagChip } from '@linnya/renderer-ui';

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

describe('selection classNames', () => {
  it('把业务 class 投影到 TagChip 的明确节点', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({
      render: () => h(TagChip, {
        label: '标签',
        closable: true,
        classNames: {
          root: 'consumer-chip',
          label: 'consumer-chip-label',
          closeButton: 'consumer-chip-close',
        },
      }),
    });
    app.mount(host);

    expect(host.querySelector('.consumer-chip')).not.toBeNull();
    expect(host.querySelector('.consumer-chip-label')?.textContent).toBe('标签');
    expect(host.querySelector('.consumer-chip-close')).toBeInstanceOf(HTMLButtonElement);

    app.unmount();
    host.remove();
  });

  it('把业务 class 投影到复选与单选控件的明确节点', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({
      render: () => h('div', [
        h(CustomCheckbox, {
          modelValue: false,
          classNames: {
            item: 'consumer-checkbox-item',
            indicator: 'consumer-checkbox-indicator',
          },
        }),
        h(CustomRadio, {
          modelValue: 'a',
          value: 'a',
          name: 'selection-test',
          classNames: {
            root: 'consumer-radio',
            indicator: 'consumer-radio-indicator',
          },
        }),
      ]),
    });
    app.mount(host);

    expect(host.querySelector('.consumer-checkbox-item')).not.toBeNull();
    expect(host.querySelector('.consumer-checkbox-indicator')).not.toBeNull();
    expect(host.querySelector('.consumer-radio')).not.toBeNull();
    expect(host.querySelector('.consumer-radio-indicator')).not.toBeNull();

    app.unmount();
    host.remove();
  });
});
