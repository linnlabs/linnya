import { createHash } from 'node:crypto';
import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';
import type { AuditFunction, AuditSignal, SourceAudit } from '../definitions/sourceAudit';

function isAsync(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false)
  );
}

/** 保留标识符、字面量和运算符；相同 body 只是复核线索，参数、闭包与调用上下文仍可能不同。 */
function bodyTokens(node: ts.Node, source: ts.SourceFile): string[] {
  const children = node.getChildren(source);
  return children.length === 0
    ? [node.getText(source)]
    : children.flatMap(child => bodyTokens(child, source));
}

function functionName(node: ts.Node, source: ts.SourceFile): string {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node)) &&
    node.name
  ) {
    return node.name.getText(source);
  }
  if (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) {
    return node.parent.name.getText(source);
  }
  return '<callback>';
}

export function analyzeSource(file: string, content: string): SourceAudit {
  const functions: AuditFunction[] = [];
  const signals: AuditSignal[] = [];
  const parseErrors: string[] = [];
  // 用正式 SFC parser 取得两个 script 的原始偏移，避免 template/style 和字符串里的 script 误报。
  const slices = file.endsWith('.vue')
    ? (() => {
        const { descriptor, errors } = parse(content, { filename: file });
        parseErrors.push(...errors.map(error => `${file}: ${String(error)}`));
        return [descriptor.script, descriptor.scriptSetup].flatMap(block =>
          block
            ? [
                {
                  content: block.content,
                  offset: block.loc.start.line - 1,
                  kind: block.lang === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
                },
              ]
            : []
        );
      })()
    : [
        {
          content,
          offset: 0,
          kind: file.endsWith('.tsx')
            ? ts.ScriptKind.TSX
            : file.endsWith('.jsx')
              ? ts.ScriptKind.JSX
              : /\.[cm]?js$/u.test(file)
                ? ts.ScriptKind.JS
                : ts.ScriptKind.TS,
        },
      ];

  for (const slice of slices) {
    const source = ts.createSourceFile(
      file,
      slice.content,
      ts.ScriptTarget.Latest,
      true,
      slice.kind
    );
    const lineAt = (position: number): number =>
      source.getLineAndCharacterOfPosition(position).line + slice.offset + 1;
    const record = (rule: string, node: ts.Node): void => {
      signals.push({ rule, file, line: lineAt(node.getStart(source)) });
    };

    const visit = (node: ts.Node): void => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node)) &&
        node.body
      ) {
        const tokens = bodyTokens(node.body, source);
        functions.push({
          file,
          name: functionName(node, source),
          line: lineAt(node.getStart(source)),
          end: lineAt(node.end),
          tokens: tokens.length,
          bodyHash: createHash('sha256').update(JSON.stringify(tokens)).digest('hex'),
          async: isAsync(node),
        });
        if (isAsync(node) && /\/(?:store|stores)\//u.test(file)) record('async-in-store', node);
      }
      if (node.kind === ts.SyntaxKind.AnyKeyword) record('explicit-any', node);
      if (
        ts.isConditionalExpression(node) &&
        ts.isBinaryExpression(node.condition) &&
        node.condition.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
        node.condition.right.getText(source) === 'Error' &&
        ts.isPropertyAccessExpression(node.whenTrue) &&
        node.whenTrue.name.text === 'message' &&
        node.whenTrue.expression.getText(source) === node.condition.left.getText(source) &&
        ts.isCallExpression(node.whenFalse) &&
        node.whenFalse.expression.getText(source) === 'String' &&
        node.whenFalse.arguments.length === 1 &&
        node.whenFalse.arguments[0]?.getText(source) === node.condition.left.getText(source)
      ) {
        record('raw-error-to-text', node);
      }
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        (ts.isAsExpression(node.expression) || ts.isTypeAssertionExpression(node.expression))
      ) {
        record('double-assertion', node);
      }
      if (ts.isCatchClause(node) && node.block.statements.length === 0)
        record('empty-catch-including-commented', node);
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(source) === 'Promise' &&
        node.arguments?.some(isAsync)
      ) {
        record('async-promise-executor', node);
      }
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const callee = expression.getText(source);
        const member = ts.isPropertyAccessExpression(expression) ? expression.name.text : callee;
        if (member === 'forEach' && node.arguments.some(isAsync)) record('async-for-each', node);
        if (
          /^(?:readFile|writeFile|readdir|stat|lstat|mkdir|rm|rename|unlink|copyFile|execFile|exec|spawn)Sync$/u.test(
            member
          )
        )
          record('blocking-io', node);
        if (member === 'createHash') record('hash-call', node);
        if (
          /^toLocale(?:Date|Time)?String$/u.test(member) ||
          /^Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)$/u.test(callee)
        )
          record('locale-format', node);
        if (
          (callee === 'document.addEventListener' || callee === 'window.addEventListener') &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0]) &&
          /^(?:click|mousedown|pointerdown)$/u.test(node.arguments[0].text)
        )
          record('global-pointer-listener', node);
      }
      if (
        ts.isNewExpression(node) &&
        /^Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat)$/u.test(
          node.expression.getText(source)
        )
      )
        record('locale-format', node);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { functions, signals, parseErrors };
}
