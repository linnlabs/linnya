import type ts from 'typescript';

import {
  getSlidesTypeScriptRuntime,
  type SlidesTypeScriptRuntime,
} from '../capabilities/typescriptRuntime/index.js';

interface SourceReplacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * 收窄兼容 AI 常见且无歧义的源码笔误。
 *
 * 公开合同仍只接受正式写法：这里仅在代码准入边界生成规范源码，避免把
 * 模型的高频笔误升级为长期公开语法。
 */
export function normalizeCodegenSourceCompatibility(source: string): string {
  const typescript = getSlidesTypeScriptRuntime();
  const sourceFile = typescript.createSourceFile(
    'deck.js',
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS
  );
  const replacements: SourceReplacement[] = [];

  function visit(node: ts.Node): void {
    if (typescript.isObjectLiteralExpression(node) && isPathGeometry(typescript, node)) {
      const viewBox = findPropertyAssignment(typescript, node, 'viewBox');
      if (
        viewBox
        && typescript.isObjectLiteralExpression(viewBox.initializer)
        && isZeroOriginViewBox(typescript, viewBox.initializer)
      ) {
        const width = findPropertyAssignment(typescript, viewBox.initializer, 'width');
        const height = findPropertyAssignment(typescript, viewBox.initializer, 'height');
        if (width && height) {
          replacements.push({
            start: viewBox.initializer.getStart(sourceFile),
            end: viewBox.initializer.getEnd(),
            text: `{ width: ${width.initializer.getText(sourceFile)}, height: ${height.initializer.getText(sourceFile)} }`,
          });
        }
      }
    }
    if (typescript.isObjectLiteralExpression(node) && isRadialGradient(typescript, node)) {
      const radius = findPropertyAssignment(typescript, node, 'radius');
      if (radius && typescript.isNumericLiteral(radius.initializer)) {
        const literal = radius.initializer.getText(sourceFile);
        replacements.push({
          start: radius.initializer.getStart(sourceFile),
          end: radius.initializer.getEnd(),
          text: `{ x: ${literal}, y: ${literal} }`,
        });
      }
    }
    if (
      typescript.isCallExpression(node)
      && typescript.isIdentifier(node.expression)
      && node.expression.text === 'compose'
    ) {
      const options = node.arguments[0];
      if (options && typescript.isObjectLiteralExpression(options)) {
        const layout = findPropertyAssignment(typescript, options, 'layout');
        if (
          layout
          && (typescript.isStringLiteral(layout.initializer)
            || typescript.isNoSubstitutionTemplateLiteral(layout.initializer))
          && layout.initializer.text === '16:9'
        ) {
          replacements.push({
            start: layout.initializer.getStart(sourceFile),
            end: layout.initializer.getEnd(),
            text: '"16x9"',
          });
        }
      }
    }
    typescript.forEachChild(node, visit);
  }

  visit(sourceFile);
  return applyReplacements(source, replacements);
}

function isPathGeometry(
  typescript: SlidesTypeScriptRuntime,
  node: ts.ObjectLiteralExpression
): boolean {
  const type = findPropertyAssignment(typescript, node, 'type');
  return Boolean(
    type
    && (typescript.isStringLiteral(type.initializer)
      || typescript.isNoSubstitutionTemplateLiteral(type.initializer))
    && type.initializer.text === 'path'
  );
}

function isZeroOriginViewBox(
  typescript: SlidesTypeScriptRuntime,
  node: ts.ObjectLiteralExpression
): boolean {
  if (node.properties.length !== 4) return false;
  const names = node.properties.map(property => (
    typescript.isPropertyAssignment(property)
      ? readPropertyName(typescript, property.name)
      : undefined
  ));
  if (new Set(names).size !== 4 || !['x', 'y', 'width', 'height'].every(name => names.includes(name))) {
    return false;
  }
  const x = findPropertyAssignment(typescript, node, 'x');
  const y = findPropertyAssignment(typescript, node, 'y');
  return Boolean(
    x
    && y
    && typescript.isNumericLiteral(x.initializer)
    && typescript.isNumericLiteral(y.initializer)
    && Number(x.initializer.text) === 0
    && Number(y.initializer.text) === 0
  );
}

function isRadialGradient(
  typescript: SlidesTypeScriptRuntime,
  node: ts.ObjectLiteralExpression
): boolean {
  const type = findPropertyAssignment(typescript, node, 'type');
  return Boolean(
    type &&
    (typescript.isStringLiteral(type.initializer) ||
      typescript.isNoSubstitutionTemplateLiteral(type.initializer)) &&
    type.initializer.text === 'radial'
  );
}

function findPropertyAssignment(
  typescript: SlidesTypeScriptRuntime,
  node: ts.ObjectLiteralExpression,
  propertyName: string
): ts.PropertyAssignment | undefined {
  return node.properties.find(
    (property): property is ts.PropertyAssignment =>
      typescript.isPropertyAssignment(property) &&
      readPropertyName(typescript, property.name) === propertyName
  );
}

function readPropertyName(
  typescript: SlidesTypeScriptRuntime,
  name: ts.PropertyName
): string | undefined {
  if (
    typescript.isIdentifier(name) ||
    typescript.isStringLiteral(name) ||
    typescript.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

function applyReplacements(source: string, replacements: readonly SourceReplacement[]): string {
  let result = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
  }
  return result;
}
