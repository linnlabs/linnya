import { SlideMarkerIndex } from '@plugin/slides/shared';
import { CodegenPresentationError } from './CodegenPresentationError.js';
import type { PptGrepInput, PptGrepOutput } from './CodegenPresentationTypes.js';
import { normalizeLineEndings, splitLines } from './sourceText.js';

const DEFAULT_GREP_HEAD_LIMIT = 250;

interface GrepMatch {
  lineNumber: number;
  line: string;
}

export function grepDeckSource(input: PptGrepInput, source: string): Pick<PptGrepOutput, 'mode' | 'content' | 'matchCount'> {
  const searchScope = input.slide ? readSlideScope(source, input.slide) : {
    source: normalizeLineEndings(source),
    startLine: 1,
  };
  const mode = input.output_mode ?? 'files_with_matches';
  const matches = input.multiline === true
    ? matchMultiline(searchScope.source, input.pattern, input['-i'] === true, searchScope.startLine)
    : matchByLine(searchScope.source, input.pattern, input['-i'] === true, searchScope.startLine);
  return {
    mode,
    content: formatGrepOutput(mode, input, matches, input.presentation_id, searchScope.source, searchScope.startLine),
    matchCount: matches.length,
  };
}

function readSlideScope(source: string, slide: number): { source: string; startLine: number } {
  const markerIndex = SlideMarkerIndex.build(source);
  const range = markerIndex.getSlideRange(slide);
  if (!range) {
    throw new CodegenPresentationError(`slide ${slide} does not exist`, 8);
  }
  return {
    source: markerIndex.sliceRange(range.startLine, range.endLine),
    startLine: range.startLine,
  };
}

function matchByLine(source: string, pattern: string, caseInsensitive: boolean, startLine: number): GrepMatch[] {
  const regex = compileRegex(pattern, `g${caseInsensitive ? 'i' : ''}`);
  return splitLines(source)
    .map((line, index) => ({ line, lineNumber: startLine + index }))
    .filter(({ line }) => {
      regex.lastIndex = 0;
      return regex.test(line);
    });
}

function matchMultiline(source: string, pattern: string, caseInsensitive: boolean, startLine: number): GrepMatch[] {
  const regex = compileRegex(pattern, `gms${caseInsensitive ? 'i' : ''}`);
  const matches: GrepMatch[] = [];
  for (const match of source.matchAll(regex)) {
    const prefix = source.slice(0, match.index);
    const lineNumber = startLine + prefix.split('\n').length - 1;
    const line = match[0].split('\n')[0] ?? '';
    matches.push({ lineNumber, line });
  }
  return matches;
}

function compileRegex(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CodegenPresentationError(`Invalid regex: ${detail}`, 1);
  }
}

const NO_MATCH_OBSERVATION =
  'No matches found. Tips: try { "-i": true } for case-insensitive, multiline:true for cross-line patterns, or relax the regex (escape literal {} () . with backslash).';

function formatGrepOutput(
  mode: PptGrepOutput['mode'],
  input: PptGrepInput,
  matches: GrepMatch[],
  presentationId: string,
  source: string,
  startLine: number,
): string {
  if (mode === 'files_with_matches') {
    return matches.length > 0 ? `Found 1 deck\n${presentationId}` : NO_MATCH_OBSERVATION;
  }
  if (mode === 'count') {
    return matches.length > 0
      ? `${presentationId}:${matches.length}\n\nFound ${matches.length} total occurrences across 1 files.`
      : NO_MATCH_OBSERVATION;
  }
  if (matches.length === 0) {
    return NO_MATCH_OBSERVATION;
  }

  const before = input.context ?? input['-C'] ?? input['-B'] ?? 0;
  const after = input.context ?? input['-C'] ?? input['-A'] ?? 0;
  const numbered = input['-n'] !== false;
  const expanded = expandContext(matches, source, startLine, before, after);
  const limited = applyPagination(expanded, input);
  const body = limited.map((match) => numbered ? `${match.lineNumber}:${match.line}` : match.line).join('\n');
  return shouldShowPaginationHint(expanded.length, limited.length, input)
    ? `${body}\n\n[Showing results with pagination = limit: ${input.head_limit ?? DEFAULT_GREP_HEAD_LIMIT}, offset: ${input.offset ?? 0}. To see more matches, increase head_limit or advance offset.]`
    : body;
}

function expandContext(
  matches: GrepMatch[],
  source: string,
  startLine: number,
  before: number,
  after: number,
): GrepMatch[] {
  if (before === 0 && after === 0) {
    return matches;
  }

  const allLines = splitLines(source);
  const selectedLineNumbers = new Set<number>();
  for (const match of matches) {
    const localIndex = match.lineNumber - startLine;
    const first = Math.max(0, localIndex - before);
    const last = Math.min(allLines.length - 1, localIndex + after);
    for (let index = first; index <= last; index++) {
      selectedLineNumbers.add(startLine + index);
    }
  }

  return [...selectedLineNumbers]
    .sort((left, right) => left - right)
    .map((lineNumber) => ({
      lineNumber,
      line: allLines[lineNumber - startLine] ?? '',
    }));
}

function applyPagination(matches: GrepMatch[], input: PptGrepInput): GrepMatch[] {
  const offset = input.offset ?? 0;
  const headLimit = input.head_limit ?? DEFAULT_GREP_HEAD_LIMIT;
  const tail = matches.slice(offset);
  return headLimit === 0 ? tail : tail.slice(0, headLimit);
}

function shouldShowPaginationHint(total: number, shown: number, input: PptGrepInput): boolean {
  const offset = input.offset ?? 0;
  const headLimit = input.head_limit ?? DEFAULT_GREP_HEAD_LIMIT;
  return offset > 0 || (headLimit > 0 && offset + shown < total);
}
