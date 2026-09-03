import type ts from 'typescript';

import {
  getSlidesTypeScriptRuntime,
  type SlidesTypeScriptRuntime,
} from '../../../capabilities/typescriptRuntime/index.js';

const SOURCE_TRACKED_FACTORIES = new Set([
  'createSlide',
  'createFrame',
  'createText',
  'createShape',
  'createChart',
  'createTable',
  'createImage',
  'createSvgGraphic',
  'createFormula',
  'createSpacer',
]);

interface SourceEdit {
  readonly position: number;
  readonly text: string;
}

/**
 * 只在 sandbox 执行前插入 source span 与 compose 根节点追踪。
 *
 * 不使用 TypeScript printer 重打源码，确保记录的行号始终来自用户可见的原始 deck.js。
 */
export function instrumentDeckSourceForLayoutTrace(source: string): string {
  const normalizedSource = normalizeLineEndings(source);
  const typescript = getSlidesTypeScriptRuntime();
  if (hasSyntaxDiagnostics(typescript, normalizedSource)) return normalizedSource;

  const sourceFile = typescript.createSourceFile(
    'deck.js',
    normalizedSource,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS
  );
  const edits: SourceEdit[] = [];

  function visit(node: ts.Node): void {
    if (typescript.isCallExpression(node) && typescript.isIdentifier(node.expression)) {
      const functionName = node.expression.text;
      if (SOURCE_TRACKED_FACTORIES.has(functionName)) {
        const start = node.getStart(sourceFile);
        const end = node.getEnd();
        const startLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const endLine = sourceFile.getLineAndCharacterOfPosition(end).line + 1;
        edits.push(
          { position: start, text: '__withLoc(' },
          { position: end, text: `, { startLine: ${startLine}, endLine: ${endLine} })` }
        );
      } else if (functionName === 'compose' && node.arguments.length === 1) {
        edits.push(
          { position: node.getStart(sourceFile), text: '__withComposeTrace(' },
          { position: node.expression.getEnd(), text: ',' },
          { position: node.getEnd(), text: ')' }
        );
      }
    }
    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);
  return edits.length > 0 ? applyEdits(normalizedSource, edits) : normalizedSource;
}

function applyEdits(source: string, edits: SourceEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.position - left.position);
  let result = source;
  for (const edit of ordered) {
    result = result.slice(0, edit.position) + edit.text + result.slice(edit.position);
  }
  return result;
}

function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function hasSyntaxDiagnostics(typescript: SlidesTypeScriptRuntime, source: string): boolean {
  const result = typescript.transpileModule(source, {
    compilerOptions: { allowJs: true, checkJs: false },
    reportDiagnostics: true,
  });
  return (result.diagnostics ?? []).some(
    diagnostic => diagnostic.category === typescript.DiagnosticCategory.Error
  );
}
