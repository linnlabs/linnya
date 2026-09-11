/** 支持业务图表常用的 Excel 数字格式；不宣称实现日期、条件分段或完整 Excel 格式语言。 */
const FORMAT = /^((?:"[^"]*"|[$¥￥€£ ])*)(#,##0|#*0{1,21})(?:\.(0{1,20}#{0,20}|#{1,20}))?((?:"[^"]*"|[$¥￥€£ ])*%?(?:"[^"]*"|[$¥￥€£ ])*)$/;

export function isSupportedChartNumberFormat(format: string): boolean {
  if (format === 'General') return true;
  const match = FORMAT.exec(format);
  return match != null && (match[3]?.length ?? 0) <= 20;
}

export function formatChartValue(value: number, format: string): string {
  if (format === 'General') return String(value);
  const match = FORMAT.exec(format);
  if (!match) throw new Error(`Unsupported chart number format: ${format}`);
  const fraction = match[3] ?? '';
  const percent = format.replace(/"[^"]*"/g, '').includes('%');
  const number = new Intl.NumberFormat('en-US', {
    useGrouping: match[2].includes(','),
    minimumIntegerDigits: match[2].replace(/[^0]/g, '').length,
    minimumFractionDigits: fraction.replace(/#/g, '').length,
    maximumFractionDigits: fraction.length,
  }).format(value * (percent ? 100 : 1));
  return `${(match[1] ?? '').replace(/"/g, '')}${number}${(match[4] ?? '').replace(/"/g, '')}`;
}
