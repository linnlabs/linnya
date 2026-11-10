import ts from 'typescript';
import type { CanvasQualityException, CanvasQualityIssue, CanvasQualitySource } from '../definitions/canvasQuality';

type Executable = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
function executable(node: ts.Node): node is Executable {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}
const branches = new Set([ts.SyntaxKind.IfStatement, ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement, ts.SyntaxKind.CatchClause, ts.SyntaxKind.CaseClause]);
const logical = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken]);
function complexity(root: Executable): number {
  let count = 1;
  const visit = (node: ts.Node) => {
    if (node !== root && executable(node)) return;
    if (branches.has(node.kind) || (ts.isBinaryExpression(node) && logical.has(node.operatorToken.kind))) count++;
    ts.forEachChild(node, visit);
  };
  visit(root); return count;
}
function label(node: Executable, source: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (!ts.isArrowFunction(node) && node.name) return node.name.getText(source);
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) return parent.name.getText(source);
  return `<anonymous@${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}>`;
}

/** 经典McCabe含逻辑短路；内层函数独立计量，不把回调分支算到工厂函数。 */
export function readCanvasQualityMetrics(sources: readonly CanvasQualitySource[], exceptions: readonly CanvasQualityException[]) {
  const issues: CanvasQualityIssue[] = [], files = new Set<string>(), usedExceptions = new Set<string>();
  let functions = 0;
  for (const item of sources) {
    if (!files.has(item.relative)) {
      files.add(item.relative);
      if (item.fileLines > 600) issues.push({ rule: 'file-length', severity: item.fileLines > 800 ? 'error' : item.fileLines > 700 ? 'review' : 'warning', file: item.relative, line: 1,
        message: `${item.fileLines}行：600提醒，700职责审查，800失败` });
    }
    const visit = (node: ts.Node) => {
      if (executable(node) && node.body) {
        functions++;
        const name = label(node, item.source), start = item.source.getLineAndCharacterOfPosition(node.getStart(item.source)), end = item.source.getLineAndCharacterOfPosition(node.getEnd());
        const metrics = [{ rule: 'function-length' as const, value: end.line - start.line + 1, limit: 120, warning: 80 },
          { rule: 'complexity' as const, value: complexity(node), limit: 15, warning: 15 }, { rule: 'parameters' as const, value: node.parameters.length, limit: 4, warning: 4 }];
        for (const metric of metrics) if (metric.value > metric.warning) {
          const exception = exceptions.find(entry => entry.file === item.relative && entry.function === name && entry.rule === metric.rule);
          if (exception && metric.value <= exception.maximum && item.text.includes(`@canvas-quality-exception ${exception.id}`)) { usedExceptions.add(exception.id); continue; }
          issues.push({ rule: metric.rule, severity: metric.value > metric.limit ? 'error' : 'warning', file: item.relative, line: start.line + item.lineOffset + 1, function: name,
            message: `${metric.rule}=${metric.value}，上限${metric.limit}` });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(item.source);
  }
  for (const entry of exceptions) if (!usedExceptions.has(entry.id)) issues.push({ rule: 'exception', severity: 'error', file: entry.file, line: 1, function: entry.function, message: `例外${entry.id}未命中，删除过期或不精确的放行` });
  if (exceptions.length > 5) issues.push({ rule: 'exception', severity: 'error', file: 'scripts/quality/definitions/canvasQualityExceptions.ts', line: 1, message: '全插件例外不得超过五项' });
  return { files: files.size, functions, issues };
}
