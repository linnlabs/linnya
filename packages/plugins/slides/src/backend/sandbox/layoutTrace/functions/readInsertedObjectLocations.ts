import type ts from 'typescript';
import type { SlidesTypeScriptRuntime } from '../../../capabilities/typescriptRuntime';

/** 只读取新增 literal 的位置，不执行或重新序列化用户源码。 */
export function readInsertedObjectLocations(ts: SlidesTypeScriptRuntime, file: ts.SourceFile, input: ts.Expression): Record<string, Record<string, { startLine: number; endLine: number }>> {
  const result: Record<string, Record<string, { startLine: number; endLine: number }>> = {};
  function property(node: ts.Expression | undefined, key: string): ts.Expression | undefined {
    if (!node || !ts.isObjectLiteralExpression(node)) return;
    const item = node.properties.find(entry => ts.isPropertyAssignment(entry) && (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) && entry.name.text === key);
    return item && ts.isPropertyAssignment(item) ? item.initializer : undefined;
  }
  const slides = property(property(input, 'manualEdits'), 'slides');
  if (!slides || !ts.isArrayLiteralExpression(slides)) return result;
  for (const slide of slides.elements) {
    const slideKey = property(slide, 'slideKey');
    const additions = property(slide, 'additions');
    if (!slideKey || !ts.isStringLiteralLike(slideKey) || !additions || !ts.isArrayLiteralExpression(additions)) continue;
    const locations: Record<string, { startLine: number; endLine: number }> = {};
    for (const object of additions.elements) {
      const key = property(object, 'editKey');
      if (!key || !ts.isStringLiteralLike(key)) continue;
      Object.defineProperty(locations, key.text, { enumerable: true, value: {
        startLine: file.getLineAndCharacterOfPosition(object.getStart(file)).line + 1,
        endLine: file.getLineAndCharacterOfPosition(object.end).line + 1,
      } });
    }
    Object.defineProperty(result, slideKey.text, { enumerable: true, value: locations });
  }
  return result;
}
