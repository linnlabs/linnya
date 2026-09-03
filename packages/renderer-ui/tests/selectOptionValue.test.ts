import { describe, expect, it } from 'vitest';
import {
  adjustInlineNumberValue,
  findSelectedOption,
  normalizeInlineNumberValue,
} from '../src/features/select-menu';
import type { CustomSelectOption } from '../src';

describe('选择菜单纯函数', () => {
  it('能够在嵌套选项中定位当前值', () => {
    const selected = { value: 'nested', text: '嵌套项' };
    const options: CustomSelectOption[] = [
      { value: 'root', text: '根项', children: [selected] },
    ];
    expect(findSelectedOption(options, 'nested')).toBe(selected);
  });

  it('提交行内数字时向下取整并钳制边界', () => {
    expect(normalizeInlineNumberValue({ enabled: true, value: '4.9', min: 1, max: 8 })).toBe(4);
    expect(normalizeInlineNumberValue({ enabled: true, value: '99', min: 1, max: 8 })).toBe(8);
    expect(normalizeInlineNumberValue({ enabled: true, value: 'invalid', min: 1, max: 8 })).toBe(1);
  });

  it('步进时使用合法当前值并保持边界', () => {
    expect(adjustInlineNumberValue({ enabled: true, value: 8, min: 1, max: 8 }, 1)).toBe(8);
    expect(adjustInlineNumberValue({ enabled: true, value: 'invalid', min: 2, max: 8 }, 1)).toBe(3);
  });
});
