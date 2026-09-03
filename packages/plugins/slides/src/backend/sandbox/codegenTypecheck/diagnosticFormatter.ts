import type ts from 'typescript';

import {
  getSlidesTypeScriptRuntime,
  type SlidesTypeScriptRuntime,
} from '../../capabilities/typescriptRuntime/index.js';

/**
 * Structured form of a TS diagnostic, stripped of `ts.SourceFile` references
 * and ready to be JSON-serialized (e.g. for tool telemetry).
 */
export interface FormattedDiagnostic {
  /** 1-based line number in the user source. */
  line: number;
  /** 1-based column. */
  column: number;
  /** TypeScript error code (e.g. 8010 for "Type annotations can only be used in TypeScript files"). */
  code: number;
  category: 'error' | 'warning' | 'message' | 'suggestion';
  /** Single-line, whitespace-collapsed message text. */
  message: string;
  /** Source line at `line`, optionally truncated. */
  snippet?: string;
}

export interface FormattedDiagnosticsBundle {
  /** AI-readable text suitable for `CodegenPresentationError.message`. */
  message: string;
  /** Structured records for tests and structured logging. */
  records: FormattedDiagnostic[];
}

export interface FormatDiagnosticsOptions {
  /** Original user source text. Required to render snippets. */
  sourceText?: string;
  /** Max snippet length per line; longer ones are truncated with `…`. Default 200. */
  maxSnippetLength?: number;
  /** Max diagnostics to include in the message; the rest are summarized. Default 10. */
  maxDiagnostics?: number;
}

const DEFAULT_MAX_SNIPPET_LENGTH = 200;
const DEFAULT_MAX_DIAGNOSTICS = 10;

/**
 * TS error codes for "TypeScript-only syntax used in a JavaScript file"
 * (TS8000-series). When any of these appear we append the deck.js / TS hint
 * to the AI message so the model knows to strip TS annotations.
 */
const TS_SYNTAX_IN_JS_CODES = new Set([
  8001, 8002, 8003, 8004, 8005, 8006, 8007, 8008, 8009, 8010, 8011, 8012, 8013,
]);

const TS_HINT_SENTENCE =
  'deck.js must be plain JavaScript. TypeScript syntax (`: type`, `as Type`, `interface`, `enum`, generic `<T>`) is rejected by the codegen-source typecheck.';

const BORDER_RADIUS_HINT_SENTENCE =
  'For rounded borders, do not put radius inside border. Use node.border = { color, width, dash? } and set node.borderRadius separately.';

/**
 * Convert a list of `ts.Diagnostic`s into:
 *   1. an AI-readable single string for `CodegenPresentationError.message`
 *   2. a parallel array of structured `FormattedDiagnostic` records
 *
 * Diagnostics are sorted by source position (then by code) for determinism.
 * If any TS-syntax-in-JS code is present, a recovery hint is appended.
 *
 * Empty input returns `{ message: '', records: [] }` so callers can branch on
 * `records.length === 0`.
 */
export function formatDiagnosticsForAi(
  diagnostics: readonly ts.Diagnostic[],
  options: FormatDiagnosticsOptions = {}
): FormattedDiagnosticsBundle {
  const typescript = getSlidesTypeScriptRuntime();
  const maxSnippetLength = options.maxSnippetLength ?? DEFAULT_MAX_SNIPPET_LENGTH;
  const maxDiagnostics = options.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS;
  const sourceText = options.sourceText;

  const records = sortDiagnostics(diagnostics).map(d =>
    toRecord(typescript, d, { sourceText, maxSnippetLength })
  );
  if (records.length === 0) {
    return { message: '', records: [] };
  }

  const head = records[0];
  const lines: string[] = [
    `Sandbox compile error: ${head.message} (line ${head.line}, col ${head.column}, TS${head.code})`,
  ];

  const additional = records.slice(1, maxDiagnostics);
  if (additional.length > 0) {
    lines.push('', 'Additional diagnostics:');
    for (const r of additional) {
      lines.push(`  - line ${r.line}, col ${r.column}: ${r.message} (TS${r.code})`);
    }
  }
  if (records.length > maxDiagnostics) {
    const omitted = records.length - maxDiagnostics;
    lines.push(`  ... and ${omitted} more diagnostic(s) omitted`);
  }
  if (records.some(r => TS_SYNTAX_IN_JS_CODES.has(r.code))) {
    lines.push('', TS_HINT_SENTENCE);
  }
  if (records.some(isBorderRadiusDiagnostic)) {
    lines.push('', BORDER_RADIUS_HINT_SENTENCE);
  }

  return { message: lines.join('\n'), records };
}

function isBorderRadiusDiagnostic(record: FormattedDiagnostic): boolean {
  return (
    record.code === 2353 &&
    record.message.includes("'radius'") &&
    record.message.includes('does not exist') &&
    record.message.includes('color') &&
    record.message.includes('width')
  );
}

interface ToRecordContext {
  sourceText?: string;
  maxSnippetLength: number;
}

function toRecord(
  typescript: SlidesTypeScriptRuntime,
  d: ts.Diagnostic,
  ctx: ToRecordContext
): FormattedDiagnostic {
  const message = typescript
    .flattenDiagnosticMessageText(d.messageText, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const category = categoryName(typescript, d.category);
  let line = 1;
  let column = 1;
  if (d.file && d.start != null) {
    const lc = d.file.getLineAndCharacterOfPosition(d.start);
    line = lc.line + 1;
    column = lc.character + 1;
  }
  const record: FormattedDiagnostic = { line, column, code: d.code, category, message };
  if (ctx.sourceText) {
    const snippet = extractSnippet(ctx.sourceText, line, ctx.maxSnippetLength);
    if (snippet !== undefined) record.snippet = snippet;
  }
  return record;
}

function categoryName(
  typescript: SlidesTypeScriptRuntime,
  c: ts.DiagnosticCategory
): FormattedDiagnostic['category'] {
  switch (c) {
    case typescript.DiagnosticCategory.Error:
      return 'error';
    case typescript.DiagnosticCategory.Warning:
      return 'warning';
    case typescript.DiagnosticCategory.Message:
      return 'message';
    case typescript.DiagnosticCategory.Suggestion:
      return 'suggestion';
    default:
      return 'message';
  }
}

function extractSnippet(sourceText: string, line: number, maxLen: number): string | undefined {
  const lines = sourceText.split(/\r?\n/);
  const raw = lines[line - 1];
  if (raw == null) return undefined;
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, Math.max(0, maxLen - 1))}…`;
}

function sortDiagnostics(diags: readonly ts.Diagnostic[]): ts.Diagnostic[] {
  return [...diags].sort((a, b) => {
    const aPos = a.start ?? 0;
    const bPos = b.start ?? 0;
    if (aPos !== bPos) return aPos - bPos;
    return a.code - b.code;
  });
}
