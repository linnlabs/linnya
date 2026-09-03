import type ts from 'typescript';

import { SlideMarkerIndex } from '@plugin/slides/shared';
import {
  getSlidesTypeScriptRuntime,
  type SlidesTypeScriptRuntime,
} from '../capabilities/typescriptRuntime/index.js';
import { CodegenPresentationError } from './CodegenPresentationError.js';
import type { PptReadInput } from './CodegenPresentationTypes.js';
import type { SlideSourceSpan } from '@plugin/slides/shared';

type SourceSpan = SlideSourceSpan;

const DEFAULT_READ_LIMIT = 2000;

export interface DeckSourceSlice {
  content: string;
  startLine: number;
  numLines: number;
  registrySnapshot: string;
  isPartialView: boolean;
}

export interface DeckSourceSpanSlice {
  content: string;
  startLine: number;
  endLine: number;
  numLines: number;
}

export function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function splitLines(source: string): string[] {
  return source.length === 0 ? [''] : source.split('\n');
}

export function readDeckSourceSlice(source: string, input: PptReadInput): DeckSourceSlice {
  if (input.slide !== undefined) {
    const index = SlideMarkerIndex.build(source);
    const range = index.getSlideRange(input.slide);
    if (!range) {
      throw new CodegenPresentationError(`slide ${input.slide} does not exist`, 8);
    }
    const content = index.sliceRange(range.startLine, range.endLine);
    return {
      content,
      startLine: range.startLine,
      numLines: splitLines(content).length,
      registrySnapshot: content,
      isPartialView: false,
    };
  }

  const lines = splitLines(source);
  const startLine = input.offset === undefined || input.offset === 0 ? 1 : input.offset;
  if (startLine > lines.length) {
    return {
      content: '',
      startLine,
      numLines: 0,
      registrySnapshot: '',
      isPartialView: true,
    };
  }
  const limit = input.limit ?? DEFAULT_READ_LIMIT;
  const selected = lines.slice(startLine - 1, startLine - 1 + limit);
  const hasExplicitRange = input.offset !== undefined || input.limit !== undefined;
  const isTruncated = startLine > 1 || selected.length < lines.length;
  return {
    content: selected.join('\n'),
    startLine,
    numLines: selected.length,
    registrySnapshot: hasExplicitRange ? selected.join('\n') : source,
    isPartialView: hasExplicitRange || isTruncated,
  };
}

export function readDeckSourceSpanSlice(source: string, span: SourceSpan): DeckSourceSpanSlice {
  const lines = splitLines(source);
  assertValidSourceSpan(span, lines.length);
  const selected = lines.slice(span.startLine - 1, span.endLine);
  return {
    content: selected.join('\n'),
    startLine: span.startLine,
    endLine: span.endLine,
    numLines: selected.length,
  };
}

export function expandDeckSourceSpanForElementEdit(source: string, span: SourceSpan): SourceSpan {
  const lines = splitLines(source);
  assertValidSourceSpan(span, lines.length);

  const typescript = getSlidesTypeScriptRuntime();
  const sourceFile = typescript.createSourceFile(
    'deck.js',
    source,
    typescript.ScriptTarget.Latest,
    /* setParentNodes */ true,
    typescript.ScriptKind.JS
  );
  const statement = findSmallestContainingStatement(typescript, sourceFile, span);
  const variableName = statement
    ? readElementVariableName(typescript, statement, span, sourceFile)
    : undefined;
  const parentStatements = statement ? readSiblingStatements(typescript, statement) : undefined;
  if (!statement || !variableName || !parentStatements) {
    return { ...span };
  }

  const statementIndex = parentStatements.indexOf(statement);
  if (statementIndex === -1) {
    return { ...span };
  }

  let endLine = toSourceSpan(statement, sourceFile).endLine;
  for (let index = statementIndex + 1; index < parentStatements.length; index += 1) {
    const next = parentStatements[index];
    if (!isPropertyAssignmentStatementForVariable(typescript, next, variableName)) {
      break;
    }
    endLine = toSourceSpan(next, sourceFile).endLine;
  }

  return {
    startLine: Math.min(span.startLine, toSourceSpan(statement, sourceFile).startLine),
    endLine: Math.max(span.endLine, endLine),
  };
}

export function buildMergedSourceSpanSnapshot(
  source: string,
  spans: readonly SourceSpan[]
): string {
  if (spans.length === 0) {
    return '';
  }

  const lines = splitLines(source);
  const sorted = spans
    .map(span => {
      assertValidSourceSpan(span, lines.length);
      return { ...span };
    })
    .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);

  const merged: SourceSpan[] = [];
  for (const span of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && span.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, span.endLine);
      continue;
    }
    merged.push({ ...span });
  }

  return merged.map(span => lines.slice(span.startLine - 1, span.endLine).join('\n')).join('\n\n');
}

function findSmallestContainingStatement(
  typescript: SlidesTypeScriptRuntime,
  sourceFile: ts.SourceFile,
  span: SourceSpan
): ts.Statement | undefined {
  let best: ts.Statement | undefined;

  function visit(node: ts.Node): void {
    if (typescript.isStatement(node)) {
      const nodeSpan = toSourceSpan(node, sourceFile);
      if (containsSourceSpan(nodeSpan, span)) {
        if (!best || spanLineCount(nodeSpan) < spanLineCount(toSourceSpan(best, sourceFile))) {
          best = node;
        }
      }
    }
    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);
  return best;
}

function readElementVariableName(
  typescript: SlidesTypeScriptRuntime,
  statement: ts.Statement,
  targetSpan: SourceSpan,
  sourceFile: ts.SourceFile
): string | undefined {
  if (!typescript.isVariableStatement(statement)) {
    return undefined;
  }

  for (const declaration of statement.declarationList.declarations) {
    if (!typescript.isIdentifier(declaration.name) || !declaration.initializer) {
      continue;
    }
    const initializerSpan = toSourceSpan(declaration.initializer, sourceFile);
    if (containsSourceSpan(initializerSpan, targetSpan)) {
      return declaration.name.text;
    }
  }

  return undefined;
}

function readSiblingStatements(
  typescript: SlidesTypeScriptRuntime,
  statement: ts.Statement
): ts.NodeArray<ts.Statement> | undefined {
  const parent = statement.parent;
  if (typescript.isSourceFile(parent) || typescript.isBlock(parent)) {
    return parent.statements;
  }
  return undefined;
}

function isPropertyAssignmentStatementForVariable(
  typescript: SlidesTypeScriptRuntime,
  statement: ts.Statement,
  variableName: string
): boolean {
  if (!typescript.isExpressionStatement(statement)) {
    return false;
  }
  const expression = statement.expression;
  if (
    !typescript.isBinaryExpression(expression) ||
    expression.operatorToken.kind !== typescript.SyntaxKind.EqualsToken
  ) {
    return false;
  }
  const left = expression.left;
  return (
    typescript.isPropertyAccessExpression(left) &&
    typescript.isIdentifier(left.expression) &&
    left.expression.text === variableName
  );
}

function containsSourceSpan(container: SourceSpan, child: SourceSpan): boolean {
  return container.startLine <= child.startLine && container.endLine >= child.endLine;
}

function spanLineCount(span: SourceSpan): number {
  return span.endLine - span.startLine + 1;
}

function toSourceSpan(node: ts.Node, sourceFile: ts.SourceFile): SourceSpan {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return { startLine: start, endLine: end };
}

function assertValidSourceSpan(span: SourceSpan, totalLines: number): void {
  if (!Number.isInteger(span.startLine) || !Number.isInteger(span.endLine)) {
    throw new CodegenPresentationError('source span lines must be integers', 8);
  }
  if (span.startLine < 1 || span.endLine < span.startLine) {
    throw new CodegenPresentationError(`invalid source span: ${span.startLine}-${span.endLine}`, 8);
  }
  if (span.endLine > totalLines) {
    throw new CodegenPresentationError(
      `source span ${span.startLine}-${span.endLine} is out of range [1, ${totalLines}]`,
      8
    );
  }
}
