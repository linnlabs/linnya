import { afterEach, describe, expect, it } from 'vitest';
import { computed, defineComponent } from 'vue';
import { clearAppearanceSectionsForTest, listAppearanceSections, registerAppearanceSection, unregisterAppearanceSection } from './settingsRegistry';

const component = defineComponent({ render: () => null });
afterEach(clearAppearanceSectionsForTest);

describe('appearance sections lifecycle', () => {
  it('插件后注册、隐藏和卸载立即反映到已打开外观页的读取', () => {
    const sections = computed(listAppearanceSections);
    expect(sections.value).toEqual([]);
    registerAppearanceSection({ pluginId: 'one', id: 'material', title: '材质', order: 20, component });
    registerAppearanceSection({ pluginId: 'two', id: 'material', title: '其他', order: 10, component });
    expect(sections.value.map(section => section.pluginId)).toEqual(['two', 'one']);
    unregisterAppearanceSection('one', 'material');
    expect(sections.value.map(section => section.pluginId)).toEqual(['two']);
    registerAppearanceSection({ pluginId: 'off', id: 'hidden', title: '隐藏', order: 0, component, isAvailable: () => false });
    expect(sections.value.map(section => section.pluginId)).toEqual(['two']);
  });

  it('同 owner 同分节不允许覆盖已有组件', () => {
    const section = { pluginId: 'one', id: 'material', title: '材质', order: 0, component };
    registerAppearanceSection(section);
    expect(() => registerAppearanceSection(section)).toThrow('重复注册');
    expect(listAppearanceSections()).toHaveLength(1);
  });
});
