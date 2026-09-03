import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { formatDiagnosticsForAi, type FormattedDiagnostic } from '../diagnosticFormatter.js';

function makeDiag(opts: {
  fileText: string;
  fileName?: string;
  start: number;
  length?: number;
  code: number;
  messageText: string | ts.DiagnosticMessageChain;
  category?: ts.DiagnosticCategory;
}): ts.Diagnostic {
  const file = ts.createSourceFile(
    opts.fileName ?? '/virtual/deck.js',
    opts.fileText,
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.JS,
  );
  return {
    file,
    start: opts.start,
    length: opts.length ?? 1,
    messageText: opts.messageText,
    code: opts.code,
    category: opts.category ?? ts.DiagnosticCategory.Error,
  };
}

describe('formatDiagnosticsForAi', () => {
  it('returns empty bundle for empty input', () => {
    const out = formatDiagnosticsForAi([]);
    expect(out).toEqual({ message: '', records: [] });
  });

  it('formats a single diagnostic with the canonical "Sandbox compile error:" header (incl. TS code, line, col)', () => {
    const text = 'const x: number = 5;\n';
    const colonOffset = text.indexOf(':');
    const diag = makeDiag({
      fileText: text,
      start: colonOffset,
      code: 8010,
      messageText: 'Type annotations can only be used in TypeScript files.',
    });
    const { message, records } = formatDiagnosticsForAi([diag], { sourceText: text });
    expect(records).toHaveLength(1);
    const r = records[0] as FormattedDiagnostic;
    expect(r.line).toBe(1);
    expect(r.column).toBe(colonOffset + 1);
    expect(r.code).toBe(8010);
    expect(r.category).toBe('error');
    expect(r.snippet).toBe('const x: number = 5;');
    expect(message).toContain('Sandbox compile error: Type annotations can only be used in TypeScript files.');
    expect(message).toContain(`(line 1, col ${colonOffset + 1}, TS8010)`);
  });

  it('appends the deck.js TypeScript-syntax recovery hint for TS80xx diagnostics', () => {
    const text = 'interface Foo { x: number; }';
    const diag = makeDiag({
      fileText: text,
      start: 0,
      code: 8006,
      messageText: "'interface' declarations can only be used in TypeScript files.",
    });
    const { message } = formatDiagnosticsForAi([diag]);
    expect(message).toContain('deck.js must be plain JavaScript');
    expect(message).toContain('`: type`');
  });

  it('does NOT append the deck.js hint for non-TS-syntax diagnostics (e.g. TS2304 cannot find name)', () => {
    const diag = makeDiag({
      fileText: 'editPresentation();',
      start: 0,
      code: 2304,
      messageText: "Cannot find name 'editPresentation'.",
    });
    const { message } = formatDiagnosticsForAi([diag]);
    expect(message).not.toContain('deck.js must be plain JavaScript');
  });

  it('appends a borderRadius recovery hint for unsupported border.radius diagnostics', () => {
    const text = 'card.border = { color: "#E2E8F0", width: 0.01, radius: 0.08 };';
    const diag = makeDiag({
      fileText: text,
      start: text.indexOf('radius'),
      code: 2353,
      messageText: "Object literal may only specify known properties, and 'radius' does not exist in type '{ color: string; width: number; dash?: \"solid\" | \"dash\" | \"dot\" | undefined; }'.",
    });

    const { message } = formatDiagnosticsForAi([diag]);

    expect(message).toContain('Use node.border = { color, width, dash? }');
    expect(message).toContain('node.borderRadius');
  });

  it('renders multiple diagnostics with an "Additional diagnostics:" bullet list, sorted by source position', () => {
    const text = ['interface A { x: number; }', 'type B = string;'].join('\n');
    const diagB = makeDiag({
      fileText: text,
      start: text.indexOf('type B'),
      code: 8008,
      messageText: 'Type aliases can only be used in TypeScript files.',
    });
    const diagA = makeDiag({
      fileText: text,
      start: text.indexOf('interface A'),
      code: 8006,
      messageText: "'interface' declarations can only be used in TypeScript files.",
    });

    const { message, records } = formatDiagnosticsForAi([diagB, diagA]);
    expect(records.map((r) => r.code)).toEqual([8006, 8008]);
    expect(message.split('\n')[0]).toContain('TS8006');
    expect(message).toContain('Additional diagnostics:');
    expect(message).toContain("Type aliases can only be used in TypeScript files. (TS8008)");
  });

  it('truncates the bullet list at maxDiagnostics and reports the omitted count', () => {
    const fileText = Array.from({ length: 15 }, (_, i) => `line${i};`).join('\n');
    const diags = Array.from({ length: 15 }, (_, i) =>
      makeDiag({
        fileText,
        start: fileText.indexOf(`line${i}`),
        code: 2304 + i,
        messageText: `msg ${i}`,
      }),
    );
    const { message, records } = formatDiagnosticsForAi(diags, { maxDiagnostics: 5 });
    expect(records).toHaveLength(15);
    expect(message).toContain('and 10 more diagnostic(s) omitted');
    expect(message).not.toContain('msg 9');
  });

  it('flattens DiagnosticMessageChain into a single line and collapses runs of whitespace', () => {
    const chain: ts.DiagnosticMessageChain = {
      messageText: 'No overload matches this call.',
      category: ts.DiagnosticCategory.Error,
      code: 2769,
      next: [
        {
          messageText: "Argument of type 'number' is not assignable to parameter of type 'string'.",
          category: ts.DiagnosticCategory.Error,
          code: 2345,
        },
      ],
    };
    const diag = makeDiag({ fileText: 'createImage(123);', start: 12, code: 2769, messageText: chain });
    const { records } = formatDiagnosticsForAi([diag]);
    expect(records[0]?.message).not.toContain('\n');
    expect(records[0]?.message).toContain('No overload matches this call.');
    expect(records[0]?.message).toContain("Argument of type 'number' is not assignable");
    expect(records[0]?.message).not.toMatch(/  +/);
  });

  it('omits snippet when sourceText is not provided', () => {
    const diag = makeDiag({ fileText: 'x', start: 0, code: 2304, messageText: 'msg' });
    const { records } = formatDiagnosticsForAi([diag]);
    expect(records[0]?.snippet).toBeUndefined();
  });

  it('truncates long snippets at maxSnippetLength with an ellipsis', () => {
    const long = 'a'.repeat(500);
    const diag = makeDiag({ fileText: long, start: 0, code: 2304, messageText: 'msg' });
    const { records } = formatDiagnosticsForAi([diag], { sourceText: long, maxSnippetLength: 50 });
    expect(records[0]?.snippet).toHaveLength(50);
    expect(records[0]?.snippet?.endsWith('…')).toBe(true);
  });

  it('handles diagnostics without a file (e.g. global config errors) by defaulting to line 1, col 1', () => {
    const diag: ts.Diagnostic = {
      file: undefined,
      start: undefined,
      length: undefined,
      messageText: 'global problem',
      code: 5000,
      category: ts.DiagnosticCategory.Error,
    };
    const { records } = formatDiagnosticsForAi([diag]);
    expect(records[0]?.line).toBe(1);
    expect(records[0]?.column).toBe(1);
  });

  it('maps DiagnosticCategory values to lowercase string names', () => {
    const fileText = 'x;';
    const diags: ts.Diagnostic[] = [
      makeDiag({ fileText, start: 0, code: 1, messageText: 'a', category: ts.DiagnosticCategory.Warning }),
      makeDiag({ fileText, start: 0, code: 2, messageText: 'b', category: ts.DiagnosticCategory.Message }),
      makeDiag({ fileText, start: 0, code: 3, messageText: 'c', category: ts.DiagnosticCategory.Suggestion }),
    ];
    const { records } = formatDiagnosticsForAi(diags);
    expect(records.map((r) => r.category).sort()).toEqual(['message', 'suggestion', 'warning']);
  });
});
