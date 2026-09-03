import { parse } from 'acorn';

export interface SlideSourceRange {
  slideNumber: number;
  startLine: number;
  endLine: number;
  contentStartLine: number;
  contentEndLine: number;
}

export type SlideMarkerIndexErrorCode = 'line_range_invalid';

export class SlideMarkerIndexError extends Error {
  readonly code: SlideMarkerIndexErrorCode;

  constructor(code: SlideMarkerIndexErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SlideMarkerIndexError';
    this.code = code;
  }
}

/**
 * deck.js 的分页规则是 Slides 格式契约的一部分：每个模块作用域 createSlide() 即一页起点。
 * 放在 shared 是为了 backend VFS、codegen service、renderer/source 工具共用同一套页码语义。
 */
export class SlideMarkerIndex {
  private constructor(
    private readonly normalizedSource: string,
    private readonly lines: string[],
    private readonly ranges: SlideSourceRange[],
  ) {}

  static build(source: string): SlideMarkerIndex {
    const normalizedSource = normalizeLineEndings(source);
    const lines = splitLines(normalizedSource);
    const ranges = buildRangesFromCreateSlideAst(normalizedSource, lines);
    return new SlideMarkerIndex(normalizedSource, lines, ranges);
  }

  listSlides(): SlideSourceRange[] {
    return this.ranges.map(cloneRange);
  }

  getSlideRange(slideNumber: number): SlideSourceRange | null {
    const range = this.ranges.find(entry => entry.slideNumber === slideNumber);
    return range ? cloneRange(range) : null;
  }

  sliceSlide(slideNumber: number): string {
    const range = this.getSlideRange(slideNumber);
    if (!range) {
      throw new SlideMarkerIndexError(
        'line_range_invalid',
        `slide ${slideNumber} does not exist`,
      );
    }
    return this.sliceRange(range.startLine, range.endLine);
  }

  sliceRange(startLine: number, endLine: number): string {
    this.validateLineRange(startLine, endLine);
    return this.lines.slice(startLine - 1, endLine).join('\n');
  }

  getSource(): string {
    return this.normalizedSource;
  }

  private validateLineRange(startLine: number, endLine: number): void {
    const isValidInteger = Number.isInteger(startLine) && Number.isInteger(endLine);
    if (!isValidInteger || startLine < 1 || endLine < startLine || endLine > this.lines.length) {
      throw new SlideMarkerIndexError(
        'line_range_invalid',
        `invalid 1-based line range ${startLine}-${endLine} for ${this.lines.length} lines`,
      );
    }
  }
}

function buildRangesFromCreateSlideAst(source: string, lines: string[]): SlideSourceRange[] {
  const sourceFile = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    locations: true,
  });
  const startLines: number[] = [];

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) {
      return;
    }

    if (isCreateSlideCall(value)) {
      const location = readStartLine(value);
      if (location !== null) {
        startLines.push(location);
      }
    }

    Object.values(value).forEach(visit);
  }

  visit(sourceFile);

  const uniqueStartLines = [...new Set(startLines)].sort((left, right) => left - right);
  return uniqueStartLines.map((startLine, index): SlideSourceRange => {
    const nextStartLine = uniqueStartLines[index + 1];
    const endLine = nextStartLine ? nextStartLine - 1 : lines.length;
    return {
      slideNumber: index + 1,
      startLine,
      endLine,
      contentStartLine: startLine,
      contentEndLine: endLine,
    };
  });
}

function isCreateSlideCall(node: Record<string, unknown>): boolean {
  if (node.type !== 'CallExpression' || !isRecord(node.callee)) {
    return false;
  }
  return node.callee.type === 'Identifier' && node.callee.name === 'createSlide';
}

function readStartLine(node: Record<string, unknown>): number | null {
  if (!isRecord(node.loc) || !isRecord(node.loc.start)) {
    return null;
  }
  return typeof node.loc.start.line === 'number' ? node.loc.start.line : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitLines(source: string): string[] {
  return source.length === 0 ? [''] : source.split('\n');
}

function cloneRange(range: SlideSourceRange): SlideSourceRange {
  return { ...range };
}
