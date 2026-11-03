import path from 'node:path';
import ts from 'typescript';
import type { CanvasQualityIssue } from '../definitions/canvasQuality';

/** 离散字符串联合按当前正式类型逐项核对；default不能悄悄吞掉新增业务命令。 */
export function checkCanvasUnionSwitches(program: ts.Program, pluginRoot: string): readonly CanvasQualityIssue[] {
  const issues: CanvasQualityIssue[] = [], checker = program.getTypeChecker();
  for (const source of program.getSourceFiles()) {
    const file = path.relative(pluginRoot, source.fileName).replaceAll('\\', '/');
    if (!file.startsWith('src/') || source.isDeclarationFile || file.includes('/__tests__/') || file.endsWith('.test.ts')) continue;
    const visit = (node: ts.Node) => {
      if (ts.isSwitchStatement(node)) {
        const type = checker.getTypeAtLocation(node.expression);
        if (type.isUnion() && type.types.every(member => member.isStringLiteral())) {
          const expected = type.types.flatMap(member => member.isStringLiteral() ? [member.value] : []), actual = new Set<string>();
          for (const clause of node.caseBlock.clauses) if (ts.isCaseClause(clause)) { const value = checker.getTypeAtLocation(clause.expression); if (value.isStringLiteral()) actual.add(value.value); }
          const missing = expected.filter(value => !actual.has(value));
          if (missing.length) issues.push({ rule: 'union-switch', severity: 'error', file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message: `联合分派未穷尽：${missing.join(', ')}` });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return issues;
}
