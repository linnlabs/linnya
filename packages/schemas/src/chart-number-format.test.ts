import { describe, expect, it } from 'vitest';
import { formatChartValue, isSupportedChartNumberFormat } from './chart-number-format';

describe('chart number format', () => {
  it.each([
    ['General', 1234.5678, '1234.5678'],
    ['0', 1234.5678, '1235'],
    ['0.0', 1234.5678, '1234.6'],
    ['0.00', -3.5, '-3.50'],
    ['#,##0', 1234.5678, '1,235'],
    ['#,##0.00', 1234.5678, '1,234.57'],
    ['#,##0.0#', -3.5, '-3.5'],
    ['0.0##', 1234.5678, '1234.568'],
    ['0.0%', 0.256, '25.6%'],
    ['0%', 0.256, '26%'],
    ['0.0"亿元"', 1234.5678, '1234.6亿元'],
    ['"¥"#,##0', 1234.5678, '¥1,235'],
    ['$#,##0.00', 0.256, '$0.26'],
  ])('格式 %s 把 %s 输出为 %s', (format, value, expected) => {
    expect(isSupportedChartNumberFormat(format)).toBe(true);
    expect(formatChartValue(value, format)).toBe(expected);
  });

  it.each(['', ' ', 'yyyy', '0.0E+00', '[Red]0', '0.0000000000000000000000'])(
    '拒绝不在子集内的格式 %j，且格式化时失败而不是猜测',
    format => {
      expect(isSupportedChartNumberFormat(format)).toBe(false);
      expect(() => formatChartValue(1, format)).toThrow('Unsupported chart number format');
    },
  );

  it('百分号格式把输入当作比例，并保留原始数值精度不被舍入后再次格式化', () => {
    expect(formatChartValue(1.234, '0.0%')).toBe('123.4%');
    expect(formatChartValue(0, '0.0%')).toBe('0.0%');
  });
});
