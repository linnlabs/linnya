import { readSystemSlideKey } from '../../../sandbox/authoringIdentity/index.js';
import type ts from 'typescript';
import { isSlidesAuthoringKey } from '@plugin/slides/shared';
import { readSlideSourceStructure, SlidesSlideInsertionSourceError } from './insertBlankSlideIntoDeckSource.js';
import { rewriteSlideManualEdits } from './writeManualEditsToDeckSource.js';
import { SLIDES_MANUAL_EDIT_SOURCE_MAX_BYTES } from '../definitions/manualEditSourceLimits.js';

/**
 * 页面块以顶层 createSlide 声明划界，与源码分页合同相同。复制将局部声明放入独立块作用域，
 * 不做字符串变量替换，也不共享原页对象。候选源码仍由完整编译器验证后原子提交。
 */
export function rewriteSlideStructureInDeckSource(
  source: string,
  input: { readonly op: 'duplicate_slide' | 'delete_slide'; readonly index: number; readonly slideCount: number },
): string {
  const { typescript: ts, sourceFile, list, declarations } = readSlideSourceStructure(source, input.slideCount);
  const statement = declarations[input.index];
  const identifier = list.elements[input.index];
  if (!Number.isSafeInteger(input.index) || input.index < 0 || !statement || !identifier) {
    throw invalid('页面位置已失效，请刷新后重试。');
  }
  if (input.op === 'delete_slide' && input.slideCount === 1) {
    throw invalid('演示文稿至少需要保留一张幻灯片。');
  }
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    throw invalid('页面必须使用独立的顶层 createSlide 声明。');
  }
  const declaration = statement.declarationList.declarations[0];
  if (!declaration?.initializer || !ts.isCallExpression(declaration.initializer)) throw invalid('页面声明无效。');
  const start = statement.getStart(sourceFile);
  const sourceOrder = [...declarations].sort((a, b) => a.pos - b.pos);
  const nextStatement = sourceOrder[sourceOrder.indexOf(statement) + 1] ?? list.evaluatingStatement;
  const nextStart = nextStatement.getStart(sourceFile);
  const previous = sourceFile.statements[sourceFile.statements.indexOf(nextStatement) - 1];
  if (!previous) throw invalid('页面边界无效。');
  const lineBreak = source.indexOf('\n', previous.end);
  const end = lineBreak !== -1 && lineBreak < nextStart ? lineBreak + 1 : previous.end;
  // 源码分页与显示页序必须一致；不跨过其他页面复制任意代码。
  if (end <= start || list.evaluatingStatement.getStart(sourceFile) < end) {
    throw invalid('源码页面声明顺序与页面列表不一致，请让 AI 整理源码后重试。');
  }

  let slideKey = readSystemSlideKey(source, declaration.initializer.getStart(sourceFile));
  const config = declaration.initializer.arguments[0];
  if (config && !ts.isObjectLiteralExpression(config)) throw invalid('页面配置必须是对象字面量，才能保留副本的人工修改。');
  if (config && ts.isObjectLiteralExpression(config)) {
    for (const property of config.properties) {
      if (ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name))) {
        throw invalid('页面配置包含动态字段，无法确定页面身份，请让 AI 修改源码。');
      }
      const name = property.name;
      if (!name || !(ts.isIdentifier(name) || ts.isStringLiteralLike(name)) || name.text !== 'slideKey') continue;
      if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.initializer)) {
        throw invalid('slideKey 必须是明确的字符串，才能保留副本的人工修改。');
      }
      slideKey = property.initializer.text;
    }
  }
  // slideKey 也可按 DSL 三阶段写法在创建后赋值。
  function readAssignment(node: ts.Node): void {
    // helper 内的同名形参不是当前页，不能据此改写页面人工值。
    if (ts.isFunctionLike(node)) return;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression)
      && node.left.expression.text === identifier.text && node.left.name.text === 'slideKey') {
      if (!ts.isStringLiteralLike(node.right)) throw invalid('slideKey 必须是明确的字符串。');
      slideKey = node.right.text;
    }
    ts.forEachChild(node, readAssignment);
  }
  sourceFile.statements.filter(entry => entry.getStart(sourceFile) >= start && entry.end <= end).forEach(readAssignment);
  if (slideKey !== undefined && !isSlidesAuthoringKey(slideKey)) throw invalid('页面作者身份无效。');

  let replacement: string;
  let names: string[] = list.elements.map(entry => entry.text);
  let copiedSlideKey: string | undefined;
  if (input.op === 'duplicate_slide') {
    let sequence = 1;
    while (source.includes(`copiedSlide${sequence}`) || source.includes(`copied-slide-${sequence}`)) sequence += 1;
    const variable = `copiedSlide${sequence}`;
    copiedSlideKey = `copied-slide-${sequence}`;
    const constructor = declaration.initializer.getText(sourceFile);
    const body = source.slice(statement.end, end);
    // 原页变量在副本块内绑定到新页，页内 const/let/helper 不会与原块重名。
    replacement = source.slice(start, end)
      + `\nconst ${variable} = ${constructor};\n{\nconst ${identifier.text} = ${variable};${body}\n`
      + `${variable}.slideKey = ${JSON.stringify(copiedSlideKey)};\n}\n\n`;
    names.splice(input.index + 1, 0, variable);
  } else {
    replacement = '';
    names = names.filter((_entry, index) => index !== input.index);
  }
  // 先替换靠后的数组，再替换页面块，原始 AST offset 始终有效。
  let result = source.slice(0, list.array.getStart(sourceFile)) + `[${names.join(', ')}]` + source.slice(list.array.end);
  result = result.slice(0, start) + replacement + result.slice(end);
  if (slideKey) result = rewriteSlideManualEdits(result, slideKey, copiedSlideKey);
  if (Buffer.byteLength(result, 'utf8') > SLIDES_MANUAL_EDIT_SOURCE_MAX_BYTES) throw invalid('编辑后的 deck.js 超过源码大小上限。');
  return result;
}

function invalid(message: string): SlidesSlideInsertionSourceError {
  return new SlidesSlideInsertionSourceError('slide_structure_invalid', message);
}
