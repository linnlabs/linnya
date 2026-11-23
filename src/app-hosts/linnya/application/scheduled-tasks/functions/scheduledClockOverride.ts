const UNIT_MS: Readonly<Record<string, number>> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** ISO 锚点只在配置时换算成偏移，之后仍随真实时间前进。 */
export function parseScheduledClockOffset(value: string, now: number): number | null {
  const relative = /^offset:([+-]?\d+)([smhdwy])$/u.exec(value);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const date = new Date(now);
    const target = unit === 'y' ? date.setUTCFullYear(date.getUTCFullYear() + amount) : now + amount * UNIT_MS[unit];
    return Number.isFinite(new Date(target).getTime()) ? target - now : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const target = Date.parse(value);
  return Number.isFinite(target) ? target - now : null;
}
