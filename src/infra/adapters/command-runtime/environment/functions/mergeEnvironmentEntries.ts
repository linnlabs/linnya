/** macOS 环境名大小写敏感；后出现的登录候选覆盖 Finder/launchd 的同名旧值。 */
export function mergeEnvironmentEntries(
  ...sources: readonly Readonly<Record<string, string>>[]
): Readonly<Record<string, string>> {
  const entries = new Map<string, string>();
  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) entries.set(name, value);
  }
  return Object.freeze(Object.fromEntries(entries));
}
