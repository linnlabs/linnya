/**
 * 文稿的阅读方式：决定生成稿的字号下限。
 *
 * - `present`：讲的稿，投影给远处的人看；
 * - `mixed`：边讲边发，缺省值；
 * - `read`：读的稿，发出去自己看（咨询报告、讲义）。
 */
export type ReadingMode = 'present' | 'mixed' | 'read';

export const READING_MODES: readonly ReadingMode[] = ['present', 'mixed', 'read'];

export const DEFAULT_READING_MODE: ReadingMode = 'mixed';

export function isReadingMode(value: unknown): value is ReadingMode {
  return typeof value === 'string' && (READING_MODES as readonly string[]).includes(value);
}

/**
 * 只有生成稿按阅读方式检查字号；导入稿和改稿保留作者原有字号，沿用固定下限。
 */
export function resolveDeckReadingMode(
  sourceKind: 'generated' | 'imported' | 'patched',
  theme: { readonly reading?: ReadingMode } | undefined,
): ReadingMode | undefined {
  return sourceKind === 'generated' ? theme?.reading ?? DEFAULT_READING_MODE : undefined;
}
