/**
 * 对话阅读文字（回答、用户消息、输入框）的排版常量，供高度估算使用。
 *
 * 数值必须与 renderer-ui 的 `--font-size-prose` / `--line-height-prose`（14px / 22px）、
 * `markstream-conversation-message.css` 里的 em 节奏保持一致；
 * `conversationReadingTypography.test.ts` 会读取这些 CSS 来防止漂移。
 */
export const READING_FONT_SIZE_PX = 14;
export const READING_LINE_HEIGHT_PX = 22;

/** 标题相对正文的字号倍数（h1/h2/h3），h4–h6 与正文同号加粗。 */
export const READING_HEADING_SCALE = { 1: 1.45, 2: 1.2, 3: 1.07 } as const;
/** 标题行高倍数，对应 `--line-height-normal`。 */
export const READING_HEADING_LINE_HEIGHT_RATIO = 1.5;

/** 以阅读字号为基准把 em 倍数换算成像素。 */
export function readingEm(multiplier: number, basePx: number = READING_FONT_SIZE_PX): number {
  return Math.round(multiplier * basePx);
}

export function readingHeadingFontSizePx(level: number): number {
  const scale = READING_HEADING_SCALE[level as 1 | 2 | 3] ?? 1;
  return Math.round(READING_FONT_SIZE_PX * scale);
}
