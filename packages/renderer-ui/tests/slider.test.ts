// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import { CustomSlider } from '@linnya/renderer-ui';
import { sliderProgress } from '../src/features/number-entry/functions/sliderProgress';

let dispose = () => {};
afterEach(() => dispose());

describe('CustomSlider controlled number input', () => {
  it('emits numeric continuous updates once and follows external values without emitting again', async () => {
    const value = ref(25);
    const updates: number[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({ render: () => h(CustomSlider, {
      modelValue: value.value, min: 0, max: 100, step: 0.5,
      id: 'scale', 'aria-label': 'Scale', class: 'consumer-scale',
      'onUpdate:modelValue': (next: number) => { updates.push(next); value.value = next; },
    }) });
    app.mount(host);
    dispose = () => { app.unmount(); host.remove(); };
    const input = host.querySelector('input');
    if (!input) throw new Error('Slider input missing');
    expect(input.type).toBe('range');
    expect(input.getAttribute('aria-label')).toBe('Scale');
    expect(input.id).toBe('scale');
    expect(input.classList.contains('consumer-scale')).toBe(true);
    input.value = '37.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
    await nextTick();
    expect(updates).toEqual([37.5]);
    value.value = 75;
    await nextTick();
    expect(input.valueAsNumber).toBe(75);
    expect(updates).toEqual([37.5]);
  });

  it('retains native disabled semantics and represents bounded progress for nonzero and fractional ranges', () => {
    const host = document.createElement('div');
    const app = createApp(CustomSlider, { modelValue: 3, min: 1, max: 5, disabled: true });
    app.mount(host);
    dispose = () => app.unmount();
    expect(host.querySelector('input')?.matches(':disabled')).toBe(true);
    expect(sliderProgress(3, 1, 5)).toBe(50);
    expect(sliderProgress(0.25, 0, 1)).toBe(25);
    expect(sliderProgress(-1, 0, 1)).toBe(0);
    expect(sliderProgress(2, 0, 1)).toBe(100);
  });
});
