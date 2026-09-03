import type { IBufferCell, Terminal } from '@xterm/headless';

import type {
  PtyTerminalCellMetric,
  PtyTerminalCellStyle,
  PtyTerminalColor,
  PtyTerminalScreenLine,
  PtyTerminalScreenProjection,
  PtyTerminalStyleRun,
} from '../../../../../domains/commands';

export const MAX_PTY_LIVE_SCREEN_SERIALIZED_BYTES = 1_048_576;
export const MAX_PTY_FINAL_SCREEN_SERIALIZED_BYTES = 4_194_304;

export interface ProjectTerminalScreenInput {
  readonly terminal: Terminal;
  readonly revision: number;
  readonly scope: 'viewport' | 'terminal_window';
}

interface ProjectedLine {
  readonly line: PtyTerminalScreenLine;
  /** 不构造 JSON 字符串，按字段名、标点和转义后的 UTF-8 byte 给出保守上界。 */
  readonly conservativeSerializedBytes: number;
}

function projectColor(
  cell: IBufferCell,
  channel: 'foreground' | 'background',
): PtyTerminalColor | undefined {
  const isDefault = channel === 'foreground' ? cell.isFgDefault() : cell.isBgDefault();
  if (isDefault) return undefined;
  const isPalette = channel === 'foreground' ? cell.isFgPalette() : cell.isBgPalette();
  const color = channel === 'foreground' ? cell.getFgColor() : cell.getBgColor();
  return isPalette
    ? Object.freeze({ mode: 'palette', index: color })
    : Object.freeze({ mode: 'rgb', value: color });
}

function projectStyle(cell: IBufferCell): PtyTerminalCellStyle | undefined {
  if (cell.isAttributeDefault()) return undefined;
  const foreground = projectColor(cell, 'foreground');
  const background = projectColor(cell, 'background');
  return Object.freeze({
    ...(foreground ? { foreground } : {}),
    ...(background ? { background } : {}),
    ...(cell.isBold() !== 0 ? { bold: true as const } : {}),
    ...(cell.isDim() !== 0 ? { dim: true as const } : {}),
    ...(cell.isItalic() !== 0 ? { italic: true as const } : {}),
    ...(cell.isUnderline() !== 0 ? { underline: true as const } : {}),
    ...(cell.isBlink() !== 0 ? { blink: true as const } : {}),
    ...(cell.isInverse() !== 0 ? { inverse: true as const } : {}),
    ...(cell.isInvisible() !== 0 ? { invisible: true as const } : {}),
    ...(cell.isStrikethrough() !== 0 ? { strikethrough: true as const } : {}),
    ...(cell.isOverline() !== 0 ? { overline: true as const } : {}),
  });
}

function styleKey(cell: IBufferCell): string {
  if (cell.isAttributeDefault()) return '';
  return [
    cell.getFgColorMode(), cell.getFgColor(), cell.getBgColorMode(), cell.getBgColor(),
    cell.isBold(), cell.isDim(), cell.isItalic(), cell.isUnderline(), cell.isBlink(),
    cell.isInverse(), cell.isInvisible(), cell.isStrikethrough(), cell.isOverline(),
  ].join(':');
}

function escapedJsonStringUtf8Bytes(value: string): number {
  let bytes = 2;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint === 0x22 || codePoint === 0x5c) {
      bytes += 2;
    } else if (codePoint <= 0x1f) {
      bytes += 6;
    } else {
      bytes += Buffer.byteLength(character, 'utf8');
    }
  }
  return bytes;
}

function projectLine(
  terminal: Terminal,
  lineIndex: number,
  lineByteBudget: number,
): ProjectedLine {
  const bufferLine = terminal.buffer.active.getLine(lineIndex);
  if (!bufferLine) throw new Error('headless terminal buffer line disappeared during projection');

  const textParts: string[] = [];
  const metrics: PtyTerminalCellMetric[] = [];
  const styleRuns: PtyTerminalStyleRun[] = [];
  let textOffset = 0;
  let pendingEmptyStart: number | undefined;
  let activeStyleStart: number | undefined;
  let activeStyleKey = '';
  let activeStyle: PtyTerminalCellStyle | undefined;
  let conservativeBytes = 256;

  function requireLineBudget(): void {
    if (conservativeBytes > lineByteBudget) {
      throw new Error('PTY screen line exceeds the serialized projection byte budget');
    }
  }

  function addMetric(metric: PtyTerminalCellMetric): void {
    metrics.push(Object.freeze(metric));
    // 四个安全整数与固定字段名的 JSON 小于 128 byte。
    conservativeBytes += 128;
    requireLineBudget();
  }

  function flushPendingEmpty(endColumn: number): void {
    if (pendingEmptyStart === undefined || endColumn <= pendingEmptyStart) return;
    addMetric({
      column: pendingEmptyStart,
      text_offset: textOffset,
      text_length: 0,
      display_width: endColumn - pendingEmptyStart,
    });
    pendingEmptyStart = undefined;
  }

  function closeStyleRun(endColumn: number): void {
    if (activeStyleStart === undefined || !activeStyle || endColumn <= activeStyleStart) return;
    styleRuns.push(Object.freeze({
      start_column: activeStyleStart,
      end_column: endColumn,
      style: activeStyle,
    }));
    // 包含前/背景色与全部布尔样式的最坏 JSON 小于 384 byte；这里仍明显
    // 高于常见单色 run，但不会误拒绝 80x24 的逐 cell 彩色终端。
    conservativeBytes += 384;
    requireLineBudget();
  }

  for (let column = 0; column < terminal.cols; column += 1) {
    const cell = bufferLine.getCell(column);
    if (!cell) throw new Error('headless terminal buffer did not expose a fixed screen cell');

    const nextStyleKey = styleKey(cell);
    if (nextStyleKey !== activeStyleKey) {
      closeStyleRun(column);
      activeStyleKey = nextStyleKey;
      activeStyle = nextStyleKey.length > 0 ? projectStyle(cell) : undefined;
      activeStyleStart = activeStyle ? column : undefined;
    }

    const text = cell.getChars();
    const width = cell.getWidth();
    if (width === 0) continue;
    if (text.length === 0) {
      pendingEmptyStart ??= column;
      continue;
    }

    flushPendingEmpty(column);
    const textLength = text.length;
    textParts.push(text);
    conservativeBytes += escapedJsonStringUtf8Bytes(text);
    if (textLength !== 1 || width !== 1) {
      addMetric({
        column,
        text_offset: textOffset,
        text_length: textLength,
        display_width: width,
      });
    }
    textOffset += textLength;
    requireLineBudget();
  }
  closeStyleRun(terminal.cols);

  // 尾部默认空 cell 由顶层 columns 补齐；若它们带样式，style run 已经保留该视觉事实。
  const text = textParts.join('');
  conservativeBytes += escapedJsonStringUtf8Bytes(text) + 128;
  requireLineBudget();
  return Object.freeze({
    line: Object.freeze({
      wrapped: bufferLine.isWrapped,
      text,
      cell_metrics: Object.freeze(metrics),
      style_runs: Object.freeze(styleRuns),
    }),
    conservativeSerializedBytes: conservativeBytes,
  });
}

function stableTextFromLines(lines: readonly PtyTerminalScreenLine[]): string {
  const logicalLines: string[] = [];
  let current = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (index === 0 || line.wrapped) {
      current += line.text;
      continue;
    }
    logicalLines.push(current);
    current = line.text;
  }
  logicalLines.push(current);
  while (logicalLines.length > 0 && logicalLines[logicalLines.length - 1] === '') {
    logicalLines.pop();
  }
  return logicalLines.join('\n');
}

/**
 * live 只读取当前 viewport；terminal_window 从尾部向前填充，在 4 MiB 门内尽可能保留
 * scrollback。计量在构造每条稀疏行时发生，不通过 JSON.stringify 制造第二份大字符串。
 */
export function projectTerminalScreen(input: ProjectTerminalScreenInput): {
  readonly screen: PtyTerminalScreenProjection;
  readonly stableText: string;
} {
  const { terminal, revision, scope } = input;
  const buffer = terminal.buffer.active;
  const maximumBytes = scope === 'viewport'
    ? MAX_PTY_LIVE_SCREEN_SERIALIZED_BYTES
    : MAX_PTY_FINAL_SCREEN_SERIALIZED_BYTES;
  const projectedReverse: PtyTerminalScreenLine[] = [];
  let conservativeBytes = 1_024;
  const firstCandidate = scope === 'viewport'
    ? buffer.viewportY
    : 0;
  const lastCandidate = scope === 'viewport'
    ? Math.min(buffer.length - 1, buffer.viewportY + terminal.rows - 1)
    : buffer.length - 1;

  for (let lineIndex = lastCandidate; lineIndex >= firstCandidate; lineIndex -= 1) {
    // 单行先按整个 DTO 的硬门构造。final 模式累计放不下时只舍弃更老的
    // scrollback；不能让一条仍可独立表达的老行使已经完成的尾部窗口整体失败。
    const projected = projectLine(terminal, lineIndex, maximumBytes - 1_024);
    if (conservativeBytes + projected.conservativeSerializedBytes > maximumBytes) {
      if (scope === 'viewport') {
        throw new Error('PTY live screen exceeds the serialized projection byte budget');
      }
      break;
    }
    projectedReverse.push(projected.line);
    conservativeBytes += projected.conservativeSerializedBytes;
  }
  if (projectedReverse.length === 0 && lastCandidate >= firstCandidate) {
    throw new Error('PTY screen projection byte budget cannot hold one terminal line');
  }
  const lines = Object.freeze(projectedReverse.reverse());
  const windowStartLine = lastCandidate - lines.length + 1;
  const screen = Object.freeze({
    mode: 'pty' as const,
    scope,
    revision,
    columns: terminal.cols,
    rows: terminal.rows,
    active_buffer: buffer.type,
    total_buffer_lines: buffer.length,
    window_start_line: windowStartLine,
    viewport_start_line: buffer.viewportY,
    scrollback_lines: buffer.baseY,
    omitted_before_lines: windowStartLine,
    cursor: Object.freeze({ column: buffer.cursorX, row: buffer.cursorY }),
    lines,
  });
  return Object.freeze({ screen, stableText: stableTextFromLines(lines) });
}
