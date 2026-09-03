export function formatStorageBytes(byteSize: number, locale: string): string {
  if (byteSize < 1024) return `${byteSize} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = byteSize / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`;
}
