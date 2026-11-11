import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';

export interface SourceImport {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly line: number;
}

/** 门禁共用语法读取，区分值与类型；字符串、注释中的 import 不构成依赖边。 */
export function readSourceImports(file: string, content: string): SourceImport[] {
  const slices = file.endsWith('.vue')
    ? (() => {
        const { descriptor } = parse(content, { filename: file });
        return [descriptor.script, descriptor.scriptSetup].flatMap(block =>
          block ? [{ content: block.content, offset: block.loc.start.line - 1 }] : []
        );
      })()
    : [{ content, offset: 0 }];
  return slices.flatMap(slice => {
    const source = ts.createSourceFile(
      file,
      slice.content,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const imports: SourceImport[] = [];
    const record = (node: ts.Node, specifier: string, typeOnly: boolean): void => {
      imports.push({
        specifier,
        typeOnly,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + slice.offset + 1,
      });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const typeOnly =
          clause?.isTypeOnly === true ||
          (clause?.name === undefined &&
            bindings !== undefined &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every(element => element.isTypeOnly));
        record(node, node.moduleSpecifier.text, typeOnly);
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const bindings = node.exportClause;
        const typeOnly =
          node.isTypeOnly ||
          (bindings !== undefined &&
            ts.isNamedExports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every(element => element.isTypeOnly));
        record(node, node.moduleSpecifier.text, typeOnly);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        record(node, node.argument.literal.text, true);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const first = node.arguments[0];
        if (first && ts.isStringLiteral(first)) record(node, first.text, false);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return imports;
  });
}
