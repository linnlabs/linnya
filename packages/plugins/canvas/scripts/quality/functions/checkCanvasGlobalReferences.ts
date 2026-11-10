import path from 'node:path';
import ts from 'typescript';
import type { CanvasQualityIssue } from '../definitions/canvasQuality';

const dom = new Set(['window', 'document', 'HTMLElement', 'Element', 'Node', 'Document', 'Image', 'ImageBitmap', 'HTMLCanvasElement', 'CanvasRenderingContext2D']);
const effects = new Set(['window', 'document', 'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'WebSocket', 'ipcRenderer', 'console']);

/** 用声明来源区分全局DOM与同名业务参数，不能把名为document的数据对象误当浏览器Document。 */
export function checkCanvasGlobalReferences(program: ts.Program, pluginRoot: string): readonly CanvasQualityIssue[] {
  const issues: CanvasQualityIssue[] = [], checker = program.getTypeChecker();
  for (const source of program.getSourceFiles()) {
    const relative = path.relative(pluginRoot, source.fileName).replaceAll('\\', '/');
    const forbidden = relative.startsWith('src/shared/') ? dom : relative.startsWith('src/') && relative.includes('/store/') ? effects : undefined;
    if (!forbidden || source.isDeclarationFile) continue;
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && forbidden.has(node.text)) {
        const global = checker.getSymbolAtLocation(node)?.declarations?.some(declaration => {
          const file = declaration.getSourceFile(); return file.isDeclarationFile && /(?:\/typescript\/lib\/|\/@types\/node\/)/.test(file.fileName.replaceAll('\\', '/'));
        });
        if (global) issues.push({ rule: 'boundary', severity: 'error', file: relative, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          message: relative.includes('/store/') ? `store不得直接触发全局副作用：${node.text}` : `shared不得使用DOM全局：${node.text}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return issues;
}
