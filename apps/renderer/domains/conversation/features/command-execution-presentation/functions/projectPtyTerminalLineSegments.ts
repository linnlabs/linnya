import type {
  PtyTerminalCellStyle,
  PtyTerminalColor,
  PtyTerminalScreenLine,
} from '@app/schemas/commands';

export interface PtyTerminalLineSegment {
  readonly text: string;
  readonly style: Readonly<Record<string, string>>;
  readonly cursor: boolean;
}

const ANSI_BASE_COLORS = [
  '#1f2328', '#d1242f', '#1a7f37', '#9a6700',
  '#0969da', '#8250df', '#1b7c83', '#d0d7de',
  '#57606a', '#ff7b72', '#56d364', '#e3b341',
  '#79c0ff', '#d2a8ff', '#39c5cf', '#f0f6fc',
] as const;

function paletteColor(index: number): string {
  if (index < ANSI_BASE_COLORS.length) return ANSI_BASE_COLORS[index] ?? '#d0d7de';
  if (index >= 232) {
    const channel = Math.min(255, 8 + (index - 232) * 10);
    return `rgb(${channel}, ${channel}, ${channel})`;
  }
  const cube = [0, 95, 135, 175, 215, 255] as const;
  const offset = Math.max(0, index - 16);
  const red = cube[Math.floor(offset / 36)] ?? 0;
  const green = cube[Math.floor((offset % 36) / 6)] ?? 0;
  const blue = cube[offset % 6] ?? 0;
  return `rgb(${red}, ${green}, ${blue})`;
}

function colorValue(color: PtyTerminalColor): string {
  if (color.mode === 'palette') return paletteColor(color.index);
  const value = color.value;
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

export function projectPtyCellStyle(
  style: PtyTerminalCellStyle | undefined,
): Readonly<Record<string, string>> {
  if (!style) return {};
  const decoration = [
    ...(style.underline ? ['underline'] : []),
    ...(style.strikethrough ? ['line-through'] : []),
    ...(style.overline ? ['overline'] : []),
  ].join(' ');
  const foreground = style.foreground ? colorValue(style.foreground) : undefined;
  const background = style.background ? colorValue(style.background) : undefined;
  return {
    ...(foreground ? { color: foreground } : {}),
    ...(background ? { backgroundColor: background } : {}),
    ...(style.bold ? { fontWeight: '700' } : {}),
    ...(style.dim ? { opacity: '0.65' } : {}),
    ...(style.italic ? { fontStyle: 'italic' } : {}),
    ...(decoration ? { textDecoration: decoration } : {}),
    ...(style.invisible ? { visibility: 'hidden' } : {}),
  };
}

function styleAtColumn(line: PtyTerminalScreenLine, column: number): PtyTerminalCellStyle | undefined {
  return line.style_runs.find(run => column >= run.start_column && column < run.end_column)?.style;
}

function sameStyle(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value]) => right[key] === value);
}

/**
 * host 已经给出 UTF-16 offset、显示列和宽字符宽度；renderer 只按这些事实分段，
 * 不重新猜测 Unicode 宽度，也不解释任何控制序列。
 */
export function projectPtyTerminalLineSegments(input: {
  readonly line: PtyTerminalScreenLine;
  readonly cursorColumn?: number;
}): readonly PtyTerminalLineSegment[] {
  const metrics = input.line.cell_metrics;
  const segments: PtyTerminalLineSegment[] = [];
  let textOffset = 0;
  let column = 0;
  let metricIndex = 0;

  function appendSegment(text: string, cellColumn: number, displayWidth: number): void {
    const style = projectPtyCellStyle(styleAtColumn(input.line, cellColumn));
    const cursor = input.cursorColumn !== undefined
      && input.cursorColumn >= cellColumn
      && input.cursorColumn < cellColumn + Math.max(1, displayWidth);
    const previous = segments[segments.length - 1];
    if (previous && previous.cursor === cursor && sameStyle(previous.style, style)) {
      segments[segments.length - 1] = { ...previous, text: `${previous.text}${text}` };
      return;
    }
    segments.push({ text, style, cursor });
  }

  while (textOffset < input.line.text.length) {
    const metric = metrics[metricIndex]?.text_offset === textOffset
      ? metrics[metricIndex]
      : undefined;
    if (metric?.text_length === 0) {
      // 光标移动会产生没有字符、但占显示列的内部空白。它与后一个字符共享
      // text_offset，必须单独消费 metric，否则循环永远停在同一 offset。
      appendSegment(' '.repeat(metric.display_width), metric.column, metric.display_width);
      column = metric.column + metric.display_width;
      metricIndex += 1;
      continue;
    }
    const textLength = metric?.text_length ?? 1;
    const displayWidth = metric?.display_width ?? 1;
    const cellColumn = metric?.column ?? column;
    const text = input.line.text.slice(textOffset, textOffset + textLength);
    appendSegment(text, cellColumn, displayWidth);
    textOffset += textLength;
    column = cellColumn + displayWidth;
    if (metric) metricIndex += 1;
  }

  while (metrics[metricIndex]?.text_offset === textOffset) {
    const metric = metrics[metricIndex];
    if (!metric || metric.text_length !== 0) break;
    appendSegment(' '.repeat(metric.display_width), metric.column, metric.display_width);
    column = metric.column + metric.display_width;
    metricIndex += 1;
  }

  if (input.cursorColumn !== undefined && input.cursorColumn >= column) {
    // 终端光标最常见的位置就是提示符末尾的空 cell。尾部默认空格不会进入
    // screen.text，因此这里仅补到光标所在列，不能让光标从界面消失。
    const precedingBlankWidth = input.cursorColumn - column;
    if (precedingBlankWidth > 0) {
      appendSegment(' '.repeat(precedingBlankWidth), column, precedingBlankWidth);
    }
    appendSegment(' ', input.cursorColumn, 1);
  }
  return segments;
}
