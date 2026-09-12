import type ts from 'typescript';
import {
  isSlidesAuthoringKey,
  parseSlidesManualEdits,
  type SlidesManualEditOperation,
  type SlidesManualEdits,
  type SlidesManualSlideEdits,
  type SlidesManualTargetEdit,
} from '@plugin/slides/shared';
import {
  getSlidesTypeScriptRuntime,
  type SlidesTypeScriptRuntime,
} from '../../../capabilities/typescriptRuntime/index.js';

const DEFAULT_SOURCE_MAX_BYTES = 128 * 1024;

export type SlidesManualEditSourceErrorCode =
  | 'compose_not_found'
  | 'compose_ambiguous'
  | 'manual_edits_not_literal'
  | 'manual_edits_invalid'
  | 'operation_invalid'
  | 'source_too_large';

export class SlidesManualEditSourceError extends Error {
  constructor(
    readonly code: SlidesManualEditSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SlidesManualEditSourceError';
  }
}

export interface WriteManualEditsToDeckSourceResult {
  readonly source: string;
  readonly manualEdits: SlidesManualEdits;
}

export function writeManualEditsToDeckSource(
  source: string,
  operation: SlidesManualEditOperation,
  options: { readonly maxSourceBytes?: number } = {},
): WriteManualEditsToDeckSourceResult {
  validateOperation(operation);
  const typescript = getSlidesTypeScriptRuntime();
  const sourceFile = typescript.createSourceFile(
    'deck.js',
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS,
  );
  const composeObjects = findComposeObjects(typescript, sourceFile);
  if (composeObjects.length === 0) {
    throw new SlidesManualEditSourceError('compose_not_found', 'deck.js 中没有可编辑的 compose({...})。');
  }
  if (composeObjects.length !== 1) {
    throw new SlidesManualEditSourceError('compose_ambiguous', 'deck.js 必须只包含一个 compose({...})。');
  }

  const composeObject = composeObjects[0];
  const manualProperties = composeObject.properties.filter(property =>
    typescript.isPropertyAssignment(property)
    && readPropertyName(typescript, property.name) === 'manualEdits'
  );
  if (manualProperties.length > 1) {
    throw new SlidesManualEditSourceError('manual_edits_invalid', 'compose.manualEdits 不能重复声明。');
  }

  let current: SlidesManualEdits = { version: 1, slides: [] };
  const manualProperty = manualProperties[0];
  if (manualProperty) {
    if (!typescript.isPropertyAssignment(manualProperty)) {
      throw new SlidesManualEditSourceError(
        'manual_edits_not_literal',
        'compose.manualEdits 必须直接写成 JSON 字面量对象。',
      );
    }
    const literal = readStaticJsonLiteral(typescript, manualProperty.initializer, sourceFile);
    const parsed = parseSlidesManualEdits(literal);
    if ('error' in parsed) {
      throw new SlidesManualEditSourceError('manual_edits_invalid', parsed.error);
    }
    current = parsed.value;
  }

  const next = applyOperation(current, operation);
  const nextSource = manualProperty && typescript.isPropertyAssignment(manualProperty)
    ? replaceManualEditsInitializer(source, sourceFile, manualProperty, next)
    : insertManualEditsProperty(source, sourceFile, composeObject, next);
  const maxSourceBytes = options.maxSourceBytes ?? DEFAULT_SOURCE_MAX_BYTES;
  if (Buffer.byteLength(nextSource, 'utf8') > maxSourceBytes) {
    throw new SlidesManualEditSourceError(
      'source_too_large',
      `人工编辑后的 deck.js 超过 ${maxSourceBytes} bytes 源码上限。`,
    );
  }
  return { source: nextSource, manualEdits: next };
}

function findComposeObjects(
  typescript: SlidesTypeScriptRuntime,
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression[] {
  const objects: ts.ObjectLiteralExpression[] = [];
  function visit(node: ts.Node): void {
    if (
      typescript.isCallExpression(node)
      && typescript.isIdentifier(node.expression)
      && node.expression.text === 'compose'
    ) {
      const input = node.arguments[0];
      if (input && typescript.isObjectLiteralExpression(input)) objects.push(input);
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);
  return objects;
}

function applyOperation(
  current: SlidesManualEdits,
  operation: SlidesManualEditOperation,
): SlidesManualEdits {
  const slideIndex = current.slides.findIndex(slide => slide.slideKey === operation.target.slideKey);
  const slide = slideIndex === -1
    ? { slideKey: operation.target.slideKey, targets: [] }
    : current.slides[slideIndex];
  const targetIndex = slide.targets.findIndex(target => target.editKey === operation.target.editKey);
  const existing = targetIndex === -1 ? undefined : slide.targets[targetIndex];
  const target = applyTargetOperation(existing, operation);
  const targets = targetIndex === -1
    ? [...slide.targets, target]
    : slide.targets.map((entry, index) => index === targetIndex ? target : entry);
  const nextSlide: SlidesManualSlideEdits = { slideKey: slide.slideKey, targets };
  const slides = slideIndex === -1
    ? [...current.slides, nextSlide]
    : current.slides.map((entry, index) => index === slideIndex ? nextSlide : entry);
  return { version: 1, slides };
}

function applyTargetOperation(
  existing: SlidesManualTargetEdit | undefined,
  operation: SlidesManualEditOperation,
): SlidesManualTargetEdit {
  if (operation.op === 'set_text_content') {
    if (existing && existing.kind !== 'text') {
      throw new SlidesManualEditSourceError(
        'operation_invalid',
        `目标 ${operation.target.slideKey}/${operation.target.editKey} 已记录为 ${existing.kind}。`,
      );
    }
    return {
      kind: 'text',
      editKey: operation.target.editKey,
      content: operation.content,
      ...(existing?.translation ? { translation: existing.translation } : {}),
    };
  }

  if (existing && existing.kind !== operation.targetKind) {
    throw new SlidesManualEditSourceError(
      'operation_invalid',
      `目标 ${operation.target.slideKey}/${operation.target.editKey} 已记录为 ${existing.kind}。`,
    );
  }
  if (operation.targetKind === 'text') {
    return {
      kind: 'text',
      editKey: operation.target.editKey,
      ...(existing?.kind === 'text' && existing.content !== undefined
        ? { content: existing.content }
        : {}),
      translation: operation.translation,
    };
  }
  if (operation.targetKind === 'frame') {
    return { kind: 'frame', editKey: operation.target.editKey, translation: operation.translation };
  }
  return { kind: operation.targetKind, editKey: operation.target.editKey, translation: operation.translation };
}

function validateOperation(operation: SlidesManualEditOperation): void {
  if (
    !isSlidesAuthoringKey(operation.target.slideKey)
    || !isSlidesAuthoringKey(operation.target.editKey)
  ) {
    throw new SlidesManualEditSourceError('operation_invalid', '人工编辑目标包含无效的作者 key。');
  }
  if (operation.op === 'set_text_content') {
    if (typeof operation.content !== 'string') {
      throw new SlidesManualEditSourceError('operation_invalid', '文本人工值必须是字符串。');
    }
    return;
  }
  if (
    !Number.isFinite(operation.translation.dx)
    || !Number.isFinite(operation.translation.dy)
  ) {
    throw new SlidesManualEditSourceError('operation_invalid', '人工位移必须是有限数字。');
  }
}

function replaceManualEditsInitializer(
  source: string,
  sourceFile: ts.SourceFile,
  property: ts.PropertyAssignment,
  manualEdits: SlidesManualEdits,
): string {
  const initializer = property.initializer;
  const column = sourceFile.getLineAndCharacterOfPosition(initializer.getStart(sourceFile)).character;
  const serialized = indentContinuationLines(JSON.stringify(manualEdits, null, 2), column);
  return source.slice(0, initializer.getStart(sourceFile))
    + serialized
    + source.slice(initializer.getEnd());
}

function insertManualEditsProperty(
  source: string,
  sourceFile: ts.SourceFile,
  composeObject: ts.ObjectLiteralExpression,
  manualEdits: SlidesManualEdits,
): string {
  const closeBracePosition = composeObject.getEnd() - 1;
  const closeLocation = sourceFile.getLineAndCharacterOfPosition(closeBracePosition);
  const closeLineStart = closeBracePosition - closeLocation.character;
  const closeIndent = source.slice(closeLineStart, closeBracePosition);
  const multiline = closeIndent.trim().length === 0 && closeLineStart > composeObject.getStart(sourceFile);
  const propertyIndent = multiline ? `${closeIndent}  ` : '';
  const rendered = renderManualEditsProperty(manualEdits, propertyIndent);
  const lastProperty = composeObject.properties.length > 0
    ? composeObject.properties[composeObject.properties.length - 1]
    : undefined;
  const needsComma = lastProperty
    ? !source.slice(lastProperty.getEnd(), closeBracePosition).includes(',')
    : false;

  if (multiline) {
    const commaSource = needsComma
      ? source.slice(0, lastProperty?.getEnd() ?? closeLineStart) + ','
        + source.slice(lastProperty?.getEnd() ?? closeLineStart, closeLineStart)
      : source.slice(0, closeLineStart);
    return commaSource + rendered + '\n' + source.slice(closeLineStart);
  }

  const insertion = `${lastProperty ? `${needsComma ? ',' : ''} ` : ''}${rendered}`;
  return source.slice(0, closeBracePosition) + insertion + source.slice(closeBracePosition);
}

function renderManualEditsProperty(manualEdits: SlidesManualEdits, indent: string): string {
  const serialized = JSON.stringify(manualEdits, null, 2).split('\n');
  return serialized.map((line, index) => (
    index === 0 ? `${indent}manualEdits: ${line}` : `${indent}${line}`
  )).join('\n') + ',';
}

function indentContinuationLines(value: string, column: number): string {
  const indent = ' '.repeat(column);
  return value.split('\n').map((line, index) => index === 0 ? line : indent + line).join('\n');
}

function readStaticJsonLiteral(
  typescript: SlidesTypeScriptRuntime,
  node: ts.Expression,
  sourceFile: ts.SourceFile,
): unknown {
  if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (typescript.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === typescript.SyntaxKind.TrueKeyword) return true;
  if (node.kind === typescript.SyntaxKind.FalseKeyword) return false;
  if (node.kind === typescript.SyntaxKind.NullKeyword) return null;
  if (
    typescript.isPrefixUnaryExpression(node)
    && node.operator === typescript.SyntaxKind.MinusToken
    && typescript.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  if (typescript.isArrayLiteralExpression(node)) {
    return node.elements.map(element => {
      if (typescript.isSpreadElement(element)) throw notLiteralError();
      return readStaticJsonLiteral(typescript, element, sourceFile);
    });
  }
  if (typescript.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {};
    const names = new Set<string>();
    for (const property of node.properties) {
      if (!typescript.isPropertyAssignment(property)) throw notLiteralError();
      const name = readPropertyName(typescript, property.name);
      if (name == null || names.has(name)) throw notLiteralError();
      names.add(name);
      Object.defineProperty(result, name, {
        value: readStaticJsonLiteral(typescript, property.initializer, sourceFile),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  }
  throw new SlidesManualEditSourceError(
    'manual_edits_not_literal',
    `compose.manualEdits 必须是 JSON 字面量，不能包含表达式：${node.getText(sourceFile).slice(0, 40)}。`,
  );
}

function readPropertyName(
  typescript: SlidesTypeScriptRuntime,
  name: ts.PropertyName | undefined,
): string | undefined {
  if (!name) return undefined;
  if (
    typescript.isIdentifier(name)
    || typescript.isStringLiteral(name)
    || typescript.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function notLiteralError(): SlidesManualEditSourceError {
  return new SlidesManualEditSourceError(
    'manual_edits_not_literal',
    'compose.manualEdits 必须直接写成 JSON 字面量对象。',
  );
}
