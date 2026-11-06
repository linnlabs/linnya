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

/**
 * 生成稿按阅读方式定的字号下限，以 13.333 英寸宽为基准，按页宽等比折算
 * （10 英寸宽 × 0.75）。上面两个固定下限只用于导入稿和改稿。
 *
 * - body：正文和未标角色的文字；
 * - caption：图注、标签（`caption` / `label` / `annotation` / `axis-label`）；
 * - chrome：脚注、来源、页码（`footnote` / `source` / `page-number`）。
 */
const READING_MODE_FONT_FLOORS_PT = {
  present: { body: 18, caption: 12, chrome: 10 },
  mixed: { body: 14, caption: 10, chrome: 8 },
  read: { body: 12, caption: 9, chrome: 7 },
} as const;

/** 阅读方式字号下限的基准页宽（英寸）。 */
export const READING_MODE_FONT_FLOOR_REFERENCE_WIDTH_IN = 13.333;

const CAPTION_TEXT_ROLES = new Set(['annotation', 'axis-label', 'caption', 'label']);
const CHROME_TEXT_ROLES = new Set(['footnote', 'page-number', 'source']);

/** 质量检查和设计基准共用同一套角色分类与页宽换算。 */
export function resolveReadingModeFontFloor(
  semanticRole: string | undefined,
  readingMode: ReadingMode,
  slideWidthIn: number,
): number {
  const floors = READING_MODE_FONT_FLOORS_PT[readingMode];
  const role = semanticRole?.trim().toLowerCase() ?? '';
  const base = CHROME_TEXT_ROLES.has(role)
    ? floors.chrome
    : CAPTION_TEXT_ROLES.has(role) ? floors.caption : floors.body;
  const scale = slideWidthIn > 0 ? slideWidthIn / READING_MODE_FONT_FLOOR_REFERENCE_WIDTH_IN : 1;
  // 折算到 0.25pt，避免 13.33 与 13.333 这类页宽差异产生 13.99pt 之类的阈值。
  return Math.round(base * scale * 4) / 4;
}
