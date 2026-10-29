import type { SlidesInsertedObject } from '@plugin/slides/shared/authoringEditing';
import { isSlidesAuthoringKey } from '@plugin/slides/shared/authoringEditing';
import { readSlideSourceStructure, SlidesSlideInsertionSourceError } from './insertBlankSlideIntoDeckSource';
import { insertObjectsInDeckSource } from './writeManualEditsToDeckSource';

/** 页码只解释当前 CAS 快照；持久化仍使用页面的显式作者身份。 */
export function insertObjectsAtSlide(source: string, slideCount: number, index: number, objects: readonly SlidesInsertedObject[]): string {
  const { typescript: ts, sourceFile, list, declarations } = readSlideSourceStructure(source, slideCount);
  const statement = declarations[index];
  const identifier = list.elements[index];
  if (!statement || !identifier || !ts.isVariableStatement(statement)) throw invalid();
  const declaration = statement.declarationList.declarations.find(entry => ts.isIdentifier(entry.name) && entry.name.text === identifier.text);
  const call = declaration?.initializer;
  if (!call || !ts.isCallExpression(call)) throw invalid();
  const config = call.arguments[0];
  if (!config || !ts.isObjectLiteralExpression(config)) throw invalid();
  let key: string | undefined;
  for (const property of config.properties) {
    if (ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name))) throw invalid();
    if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'slideKey') {
      if (!ts.isStringLiteralLike(property.initializer)) throw invalid();
      key = property.initializer.text;
    }
  }
  // 后续显式赋值属于合法 DSL；动态 key 不能猜测。
  for (const entry of sourceFile.statements) {
    if (!ts.isExpressionStatement(entry) || !ts.isBinaryExpression(entry.expression)) continue;
    const assignment = entry.expression;
    if (assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(assignment.left)
      && ts.isIdentifier(assignment.left.expression) && assignment.left.expression.text === identifier.text && assignment.left.name.text === 'slideKey') {
      if (!ts.isStringLiteralLike(assignment.right)) throw invalid();
      key = assignment.right.text;
    }
  }
  if (!isSlidesAuthoringKey(key)) throw invalid();
  return insertObjectsInDeckSource(source, key, objects);
}
function invalid(): SlidesSlideInsertionSourceError {
  return new SlidesSlideInsertionSourceError('slide_structure_invalid', '当前页需要静态页面列表和明确的 slideKey 才能插入对象，请让 AI 整理源码。');
}
