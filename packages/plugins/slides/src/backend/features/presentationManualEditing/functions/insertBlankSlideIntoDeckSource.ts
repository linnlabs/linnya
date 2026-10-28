import type ts from 'typescript';
import {
  getSlidesTypeScriptRuntime,
  type SlidesTypeScriptRuntime,
} from '../../../capabilities/typescriptRuntime/index.js';
import { SLIDES_MANUAL_EDIT_SOURCE_MAX_BYTES } from '../definitions/manualEditSourceLimits.js';

export type SlidesSlideInsertionSourceErrorCode =
  | 'compose_not_found'
  | 'compose_ambiguous'
  | 'slides_not_static'
  | 'slide_declaration_invalid'
  | 'insert_index_invalid'
  | 'source_too_large'
  | 'slide_structure_invalid';

export class SlidesSlideInsertionSourceError extends Error {
  constructor(
    readonly code: SlidesSlideInsertionSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SlidesSlideInsertionSourceError';
  }
}

export interface InsertBlankSlideIntoDeckSourceInput {
  /** 新页在当前精确修订中的 0-based 位置。 */
  readonly index: number;
  /** 当前修订 DeckSpec 的页数；静态页面列表必须与它一致。 */
  readonly slideCount: number;
  /** 规范 #RRGGBB 背景色。 */
  readonly backgroundColor: string;
  readonly maxSourceBytes?: number;
}

export interface InsertBlankSlideIntoDeckSourceResult {
  readonly source: string;
  readonly slideKey: string;
  readonly variableName: string;
  /** 内联页数组不会被其他作者语句读取；只有这种结构可以投影已有编译结果。 */
  readonly canProject: boolean;
  readonly lineShifts: readonly { readonly fromLine: number; readonly count: number }[];
}

interface SourceInsertion {
  readonly offset: number;
  readonly text: string;
}

/**
 * 在 deck.js 中新增一个顶层 createSlide 声明，并把它放进唯一 compose 的静态 slides 数组。
 * 只接受“标识符数组 + 顶层 createSlide 声明”这一可证明的页面结构；其余写法交给 AI 修改源码，
 * 不按显示顺序、行号或文字猜测页面。
 */
export function insertBlankSlideIntoDeckSource(
  source: string,
  input: InsertBlankSlideIntoDeckSourceInput,
): InsertBlankSlideIntoDeckSourceResult {
  const typescript = getSlidesTypeScriptRuntime();
  const sourceFile = typescript.createSourceFile(
    'deck.js',
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS,
  );
  const compose = readComposeStatement(typescript, sourceFile);
  const slideList = readStaticSlideList(typescript, sourceFile, compose);
  if (slideList.elements.length !== input.slideCount) {
    throw notStaticError(`compose.slides 列出 ${slideList.elements.length} 页，但当前文稿有 ${input.slideCount} 页。`);
  }
  if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index > slideList.elements.length) {
    throw new SlidesSlideInsertionSourceError(
      'insert_index_invalid',
      `插入位置 ${input.index} 超出当前 ${slideList.elements.length} 页的范围。`,
    );
  }

  const followingSlide = slideList.elements[input.index];
  // 新声明必须早于求值 slides 数组的语句，否则 const 会落入暂时性死区。
  const anchor = followingSlide
    ? findSlideDeclarationStatement(typescript, sourceFile, followingSlide.text)
    : slideList.evaluatingStatement;
  const { variableName, slideKey } = pickUnusedSlideNames(source);
  const declaration = `const ${variableName} = createSlide({ slideKey: ${JSON.stringify(slideKey)}, `
    + `background: { color: ${JSON.stringify(input.backgroundColor)} } });`;

  const insertions = [
    createArrayInsertion(sourceFile, slideList.array, input.index, variableName),
    createDeclarationInsertion(sourceFile, anchor, declaration),
  ].sort((left, right) => right.offset - left.offset);
  const nextSource = insertions.reduce(
    (text, insertion) => text.slice(0, insertion.offset) + insertion.text + text.slice(insertion.offset),
    source,
  );

  const maxSourceBytes = input.maxSourceBytes ?? SLIDES_MANUAL_EDIT_SOURCE_MAX_BYTES;
  if (Buffer.byteLength(nextSource, 'utf8') > maxSourceBytes) {
    throw new SlidesSlideInsertionSourceError(
      'source_too_large',
      `插入页面后的 deck.js 超过 ${maxSourceBytes} bytes 源码上限。`,
    );
  }
  const lineShifts = insertions.map(insertion => {
    const location = sourceFile.getLineAndCharacterOfPosition(insertion.offset);
    const lineStart = sourceFile.getPositionOfLineAndCharacter(location.line, 0);
    const atLineStart = source.slice(lineStart, insertion.offset).trim().length === 0;
    return { fromLine: location.line + (atLineStart ? 1 : 2), count: insertion.text.split('\n').length - 1 };
  });
  // 同一行中间插入声明无法只用行号无损重映射 sourceSpan，交回正式编译器。
  const declarationOffset = createDeclarationInsertion(sourceFile, anchor, declaration).offset;
  const line = sourceFile.getLineAndCharacterOfPosition(declarationOffset).line;
  const prefix = source.slice(sourceFile.getPositionOfLineAndCharacter(line, 0), declarationOffset);
  const canProject = slideList.evaluatingStatement === compose.statement
    && compose.input.properties.every(property => !typescript.isSpreadAssignment(property)
      && property.name !== undefined && !typescript.isComputedPropertyName(property.name))
    && (source[declarationOffset] === '\n' || prefix.trim().length === 0);
  return { source: nextSource, slideKey, variableName, canProject, lineShifts };
}

interface ComposeStatement {
  readonly statement: ts.Statement;
  readonly input: ts.ObjectLiteralExpression;
}

interface StaticSlideList {
  readonly array: ts.ArrayLiteralExpression;
  readonly elements: readonly ts.Identifier[];
  /** 求值该数组的顶层语句：compose 本身，或被 compose 引用的 slides 常量声明。 */
  readonly evaluatingStatement: ts.Statement;
}

function readComposeStatement(
  typescript: SlidesTypeScriptRuntime,
  sourceFile: ts.SourceFile,
): ComposeStatement {
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (
      typescript.isCallExpression(node)
      && typescript.isIdentifier(node.expression)
      && node.expression.text === 'compose'
    ) {
      calls.push(node);
    }
    typescript.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (calls.length === 0) {
    throw new SlidesSlideInsertionSourceError('compose_not_found', 'deck.js 中没有 compose({...})。');
  }
  if (calls.length !== 1) {
    throw new SlidesSlideInsertionSourceError('compose_ambiguous', 'deck.js 必须只包含一个 compose({...})。');
  }
  const call = calls[0];
  const input = call.arguments[0];
  const statement = call.parent;
  if (
    !input
    || !typescript.isObjectLiteralExpression(input)
    || !typescript.isExpressionStatement(statement)
    || statement.parent !== sourceFile
  ) {
    throw notStaticError('compose({...}) 必须在模块顶层直接传入对象字面量。');
  }
  return { statement, input };
}

function readStaticSlideList(
  typescript: SlidesTypeScriptRuntime,
  sourceFile: ts.SourceFile,
  compose: ComposeStatement,
): StaticSlideList {
  const properties = compose.input.properties.filter(
    (property): property is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (typescript.isPropertyAssignment(property) || typescript.isShorthandPropertyAssignment(property))
      && readPropertyName(typescript, property.name) === 'slides',
  );
  const property = properties[0];
  if (properties.length !== 1 || !property) {
    throw notStaticError('compose 必须只声明一次 slides。');
  }

  let array: ts.ArrayLiteralExpression;
  let evaluatingStatement: ts.Statement = compose.statement;
  const value = typescript.isPropertyAssignment(property) ? property.initializer : property.name;
  if (typescript.isArrayLiteralExpression(value)) {
    array = value;
  } else if (typescript.isIdentifier(value)) {
    const declared = findTopLevelConstInitializer(typescript, sourceFile, value.text);
    if (!declared || !typescript.isArrayLiteralExpression(declared.initializer)) {
      throw notStaticError(`slides 引用的 ${value.text} 必须是顶层 const 数组字面量。`);
    }
    array = declared.initializer;
    evaluatingStatement = declared.statement;
  } else {
    throw notStaticError('compose.slides 必须是页面变量组成的数组字面量。');
  }

  const elements = array.elements.map((element) => {
    if (!typescript.isIdentifier(element)) {
      throw notStaticError('compose.slides 只能直接列出页面变量，不能使用展开、调用或表达式。');
    }
    return element;
  });
  return { array, elements, evaluatingStatement };
}

function findSlideDeclarationStatement(
  typescript: SlidesTypeScriptRuntime,
  sourceFile: ts.SourceFile,
  name: string,
): ts.Statement {
  const matches = sourceFile.statements.filter(statement =>
    typescript.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration =>
      typescript.isIdentifier(declaration.name)
      && declaration.name.text === name
      && declaration.initializer !== undefined
      && isCreateSlideCall(typescript, declaration.initializer)));
  const statement = matches[0];
  if (matches.length !== 1 || !statement) {
    throw new SlidesSlideInsertionSourceError(
      'slide_declaration_invalid',
      `页面变量 ${name} 必须由唯一的顶层 createSlide(...) 声明。`,
    );
  }
  return statement;
}

function findTopLevelConstInitializer(
  typescript: SlidesTypeScriptRuntime,
  sourceFile: ts.SourceFile,
  name: string,
): { readonly statement: ts.Statement; readonly initializer: ts.Expression } | null {
  const matches = sourceFile.statements.flatMap((statement) => {
    if (
      !typescript.isVariableStatement(statement)
      || (statement.declarationList.flags & typescript.NodeFlags.Const) === 0
    ) {
      return [];
    }
    return statement.declarationList.declarations.flatMap(declaration =>
      typescript.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer
        ? [{ statement, initializer: declaration.initializer }]
        : []);
  });
  return matches.length === 1 ? matches[0] ?? null : null;
}

function isCreateSlideCall(typescript: SlidesTypeScriptRuntime, expression: ts.Expression): boolean {
  return typescript.isCallExpression(expression)
    && typescript.isIdentifier(expression.expression)
    && expression.expression.text === 'createSlide';
}

/** 名称一旦写入源码就是稳定身份；按源码文本整体避让，避免与任何标识符、字符串或注释同名。 */
function pickUnusedSlideNames(source: string): { readonly variableName: string; readonly slideKey: string } {
  for (let sequence = 1; ; sequence += 1) {
    const variableName = `blankSlide${sequence}`;
    const slideKey = `blank-slide-${sequence}`;
    if (!source.includes(variableName) && !source.includes(slideKey)) {
      return { variableName, slideKey };
    }
  }
}

function createDeclarationInsertion(
  sourceFile: ts.SourceFile,
  anchor: ts.Statement,
  declaration: string,
): SourceInsertion {
  const anchorIndex = sourceFile.statements.indexOf(anchor);
  const previous = anchorIndex > 0 ? sourceFile.statements[anchorIndex - 1] : undefined;
  const anchorStart = anchor.getStart(sourceFile);
  if (!previous) {
    return { offset: anchorStart, text: `${declaration}\n\n` };
  }
  // 保留上一条语句的行尾注释，以及属于下一页的前置注释和空行。
  const lineBreak = sourceFile.text.indexOf('\n', previous.end);
  return lineBreak !== -1 && lineBreak < anchorStart
    ? { offset: lineBreak, text: `\n\n${declaration}` }
    : { offset: anchorStart, text: `${declaration}\n` };
}

function createArrayInsertion(
  sourceFile: ts.SourceFile,
  array: ts.ArrayLiteralExpression,
  index: number,
  variableName: string,
): SourceInsertion {
  const elements = array.elements;
  const first = elements[0];
  if (!first) {
    return { offset: array.elements.pos, text: variableName };
  }
  const firstStart = first.getStart(sourceFile);
  const multiline = lineOf(sourceFile, array.getStart(sourceFile)) !== lineOf(sourceFile, firstStart);
  const indent = multiline ? readLineIndent(sourceFile, firstStart) : '';
  const following = elements[index];
  if (following) {
    return {
      offset: following.getStart(sourceFile),
      text: multiline ? `${variableName},\n${indent}` : `${variableName}, `,
    };
  }
  const last = elements[elements.length - 1];
  return {
    offset: last ? last.end : firstStart,
    text: multiline ? `,\n${indent}${variableName}` : `, ${variableName}`,
  };
}

function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line;
}

function readLineIndent(sourceFile: ts.SourceFile, position: number): string {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
  const prefix = sourceFile.text.slice(lineStart, lineStart + character);
  return /^[\t ]*$/u.test(prefix) ? prefix : '';
}

function readPropertyName(
  typescript: SlidesTypeScriptRuntime,
  name: ts.PropertyName,
): string | undefined {
  if (typescript.isIdentifier(name) || typescript.isStringLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function notStaticError(detail: string): SlidesSlideInsertionSourceError {
  return new SlidesSlideInsertionSourceError(
    'slides_not_static',
    `${detail}当前页面结构无法从界面直接插入空白页，请让 AI 修改源码。`,
  );
}

/** 页面增删复制共用同一静态源码合同，避免各写入口重新猜测页面边界。 */
export function readSlideSourceStructure(source: string, slideCount: number) {
  const typescript = getSlidesTypeScriptRuntime();
  const sourceFile = typescript.createSourceFile('deck.js', source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
  const compose = readComposeStatement(typescript, sourceFile);
  const list = readStaticSlideList(typescript, sourceFile, compose);
  if (list.elements.length !== slideCount) throw notStaticError('页面列表与当前修订不一致。');
  const declarations = list.elements.map(element => findSlideDeclarationStatement(typescript, sourceFile, element.text));
  return { typescript, sourceFile, compose, list, declarations };
}
