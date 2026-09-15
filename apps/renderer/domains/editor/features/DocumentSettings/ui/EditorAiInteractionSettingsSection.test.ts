// @vitest-environment jsdom
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import { useAiSettingsStore } from '@/shared/stores/aiSettings';
import EditorAiInteractionSettingsSection from './EditorAiInteractionSettingsSection.vue';

describe('Editor AI settings shared sliders', () => {
  it('keeps setting ranges, enablement and per-field persistence actions connected', async () => {
    setActivePinia(createPinia());
    const store = useAiSettingsStore();
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(EditorAiInteractionSettingsSection);
    app.mount(host);
    try {
      const inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="range"]')];
      expect(inputs).toHaveLength(3);
      expect(inputs.every(input => input.disabled)).toBe(true);
      store.updateAutocompleteEnabled(true);
      await nextTick();
      expect(inputs.every(input => !input.disabled)).toBe(true);
      for (const [index, input] of inputs.entries()) {
        input.value = ['5', '6', '3'][index] ?? '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await nextTick();
      expect([store.delayLevel, store.frequencyLevel, store.completionLengthLevel]).toEqual([5, 6, 3]);
      store.updateDelayLevel(2);
      await nextTick();
      expect(inputs[0]?.valueAsNumber).toBe(2);
    } finally { app.unmount(); host.remove(); }
  });
});
