import path from 'node:path';
import ts from 'typescript';
import type { CanvasQualityIssue } from '../definitions/canvasQuality';

const layoutReads = new Set(['getBoundingClientRect', 'getClientRects', 'getComputedStyle', 'offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight']);
type BodyNode = ts.Node & { readonly body: ts.ConciseBody };
function withBody(node: ts.Node): node is BodyNode { return (ts.isFunctionLike(node) && 'body' in node && node.body !== undefined); }
function marked(node: ts.Node): boolean { return ts.getJSDocTags(node).some(tag => tag.tagName.text === 'canvasFrame'); }
function allowedExternal(call: ts.CallExpression, declaration: ts.Node | undefined): boolean {
  const expression = call.expression, file = declaration?.getSourceFile().fileName.replaceAll('\\', '/') ?? '';
  if (!ts.isPropertyAccessExpression(expression)) return false;
  const receiver = expression.expression;
  if (expression.name.text === 'render' && ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'app' && receiver.expression.kind === ts.SyntaxKind.ThisKeyword) return file.includes('/pixi.js/');
  return ts.isIdentifier(receiver) && /\/typescript\/lib\/lib\./.test(file) && (receiver.text === 'Math' || (receiver.text === 'performance' && expression.name.text === 'now'));
}
function implementation(expression: ts.Expression | undefined, checker: ts.TypeChecker): BodyNode | undefined {
  if (!expression) return undefined;
  if (withBody(expression)) return expression;
  const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
  const declaration = symbol?.valueDeclaration;
  if (declaration && withBody(declaration)) return declaration;
  if (declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) && declaration.initializer && withBody(declaration.initializer)) return declaration.initializer;
  return undefined;
}
function preparation(expression: ts.Expression | undefined, checker: ts.TypeChecker): boolean {
  if (!expression || (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression))) return false;
  const body = expression.body, statement = ts.isBlock(body) && body.statements.length === 1 ? body.statements[0] : undefined;
  const call = ts.isBlock(body) ? statement && ts.isExpressionStatement(statement) ? statement.expression : undefined : body;
  if (!call || !ts.isCallExpression(call) || call.arguments.length || !ts.isIdentifier(call.expression)) return false;
  const parameter = checker.getSymbolAtLocation(call.expression)?.valueDeclaration;
  if (!parameter || !ts.isParameter(parameter)) return false;
  const executor = parameter.parent;
  if ((!ts.isArrowFunction(executor) && !ts.isFunctionExpression(executor)) || executor.parameters[0] !== parameter) return false;
  const creation = executor.parent;
  if (!ts.isNewExpression(creation) || creation.arguments?.[0] !== executor || !ts.isIdentifier(creation.expression) || creation.expression.text !== 'Promise') return false;
  return checker.getSymbolAtLocation(creation.expression)?.declarations?.some(declaration => /\/typescript\/lib\/lib\./.test(declaration.getSourceFile().fileName.replaceAll('\\', '/'))) === true;
}
function raf(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const declaration = checker.getResolvedSignature(call)?.declaration;
  return declaration !== undefined && (ts.isFunctionDeclaration(declaration) || ts.isMethodSignature(declaration)) && declaration.name?.getText() === 'requestAnimationFrame'
    && /\/typescript\/lib\/lib\.(dom|webworker)/.test(declaration.getSourceFile().fileName.replaceAll('\\', '/'));
}

/** 从标记入口沿已解析项目调用闭包走图；外部Pixi draw边界单独报告，不声称覆盖第三方全部分配。 */
export function checkCanvasFrameClosure(program: ts.Program, pluginRoot: string) {
  const checker = program.getTypeChecker(), pending: BodyNode[] = [], visited = new Set<ts.Node>(), issues: CanvasQualityIssue[] = [], external = new Set<string>();
  const sourceRoot = path.join(pluginRoot, 'src');
  const projectFile = (file: string) => { const relative = path.relative(sourceRoot, file); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };
  for (const source of program.getSourceFiles()) if (projectFile(source.fileName)) {
    const visit = (node: ts.Node) => {
      if (marked(node)) {
        if (withBody(node)) pending.push(node);
        else if (ts.isPropertyDeclaration(node) && node.initializer && withBody(node.initializer)) pending.push(node.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const entries = new Set(pending).size;
  const roots = new Set(pending); let preparationFrames = 0;
  for (const source of program.getSourceFiles()) if (projectFile(source.fileName)) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && raf(node, checker)) {
        if (preparation(node.arguments[0], checker)) preparationFrames++;
        else {
          const target = implementation(node.arguments[0], checker);
          if (!target || !roots.has(target)) issues.push({ rule: 'frame', severity: 'error', file: path.relative(pluginRoot, source.fileName).replaceAll('\\', '/'), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message: 'RAF必须绑定已标记绘制入口；工作批次不得藏进逐帧回调' });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (let owner = pending.pop(); owner; owner = pending.pop()) {
    if (visited.has(owner)) continue; visited.add(owner);
    const source = owner.getSourceFile(), file = path.relative(pluginRoot, source.fileName).replaceAll('\\', '/');
    const report = (node: ts.Node, message: string) => issues.push({ rule: 'frame', severity: 'error', file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message });
    const visit = (node: ts.Node) => {
      if (ts.isAwaitExpression(node) || ts.isNewExpression(node) || ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) report(node, '绘制闭包禁止等待和对象/数组分配');
      if (ts.isIdentifier(node) && ['Promise', 'JSON', 'console'].includes(node.text)) report(node, '绘制闭包禁止Promise/JSON/console');
      if ((ts.isPropertyAccessExpression(node) && layoutReads.has(node.name.text)) || (ts.isIdentifier(node) && layoutReads.has(node.text))) report(node, '绘制闭包禁止读取DOM布局');
      if (ts.isCallExpression(node)) {
        const declaration = checker.getResolvedSignature(node)?.declaration;
        if (declaration && projectFile(declaration.getSourceFile().fileName)) {
          if (withBody(declaration)) pending.push(declaration); else report(node, '项目动态绘制端口必须给出可检查的实现');
        } else {
          const name = node.expression.getText(source); external.add(name);
          if (!allowedExternal(node, declaration)) report(node, `未审查的外部绘制调用：${name}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(owner.body);
  }
  if (!entries) issues.push({ rule: 'frame', severity: 'error', file: 'src/renderer/kernel', line: 1, message: '缺少可检查的@canvasFrame入口' });
  return { entries, preparationFrames, projectFunctions: visited.size, externalCalls: [...external], issues };
}
