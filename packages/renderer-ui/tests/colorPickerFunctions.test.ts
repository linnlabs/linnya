import { describe, expect, it } from 'vitest';
import {
  createColorPickerOptions,
  isColorPickerOptionCurrent,
  resolveColorPickerOptionHex,
  type ColorPickerOptionDefinition,
} from '@linnya/renderer-ui';

type TestColorKey = 'color.red';

const DEFINITIONS: readonly ColorPickerOptionDefinition<TestColorKey>[] = [{
  value: 'red_text',
  labelKey: 'color.red',
  fallbackLabel: 'Red',
  cssVar: '--test-red',
  fallbackHex: '#d44c47',
}];

describe('color picker functions', () => {
  it('在没有业务文案解析器时保留语言中立的回退文案', () => {
    const options = createColorPickerOptions(DEFINITIONS);

    expect(options).toEqual([{
      value: 'red_text',
      labelKey: 'color.red',
      label: 'Red',
      cssVar: '--test-red',
      fallbackHex: '#d44c47',
    }]);
    expect(DEFINITIONS[0]).not.toHaveProperty('label');
  });

  it('由业务侧解析可见文案，但不改变文案键和颜色契约', () => {
    const options = createColorPickerOptions(DEFINITIONS, key => `resolved:${key}`);

    expect(options[0]).toMatchObject({
      labelKey: 'color.red',
      label: 'resolved:color.red',
      cssVar: '--test-red',
    });
  });

  it('按业务值匹配时忽略首尾空白和大小写', () => {
    const option = createColorPickerOptions(DEFINITIONS)[0];
    expect(option).toBeDefined();
    if (!option) return;

    expect(isColorPickerOptionCurrent(' RED_TEXT ', option, 'by-value', () => '')).toBe(true);
    expect(isColorPickerOptionCurrent('', option, 'by-value', () => '')).toBe(false);
  });

  it('按解析色值匹配，并在主题变量为空时使用显式回退色', () => {
    const option = createColorPickerOptions(DEFINITIONS)[0];
    expect(option).toBeDefined();
    if (!option) return;

    expect(resolveColorPickerOptionHex(option, () => ' #AABBCC ')).toBe('#AABBCC');
    expect(isColorPickerOptionCurrent('#aabbcc', option, 'by-resolved-hex', () => '#AABBCC')).toBe(true);
    expect(isColorPickerOptionCurrent('#D44C47', option, 'by-resolved-hex', () => '')).toBe(true);
  });
});
