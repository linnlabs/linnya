export function createDesktopScheduledTaskClock(input: {
  readonly readSystemTimezone?: () => Promise<string>;
  readonly development?: { clockOffsetMs?: number; timezone?: string };
}) {
  let offset = input.development?.clockOffsetMs ?? 0;
  let timezoneOverride = input.development?.timezone;
  let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function applyTimezone(name: string): void {
    if (timezone === name) return;
    // 只接纳 Host 或显式开发注入；赋值会刷新常驻 Node 的默认时区缓存。
    new Intl.DateTimeFormat('en', { timeZone: name });
    process.env.TZ = name;
    timezone = name;
  }
  if (timezoneOverride) applyTimezone(timezoneOverride);
  return {
    now: () => Date.now() + offset,
    timezone: () => timezone,
    async refreshTimezone() {
      const name = timezoneOverride ?? await input.readSystemTimezone?.();
      if (name) applyTimezone(name);
    },
    configure(overrides: { clockOffsetMs?: number | null; timezone?: string | null }) {
      if (overrides.clockOffsetMs !== undefined) offset = overrides.clockOffsetMs ?? 0;
      if (overrides.timezone !== undefined) timezoneOverride = overrides.timezone ?? undefined;
    },
  };
}
