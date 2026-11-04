import path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';
import type { CanvasQualityIssue, CanvasQualitySource } from '../definitions/canvasQuality';

const normalize = (value: string) => value.replaceAll('\\', '/');
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
// queries只公开正式只读合同，独立CLI不必经写入组合入口加载审批和历史运行态。
const publicEntries = new Set(['index.ts', 'content.ts', 'worker.ts', 'queries.ts']);
const publicResources = new Set(['renderer/features/cardRendering/styles/canvasCardInk.css', 'renderer/features/cardRendering/styles/canvasMediaContent.css', 'renderer/features/agentReview/styles/agentReview.css']);
function moduleName(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier.text;
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) return node.arguments[0].text;
  return undefined;
}
function checkImport(source: CanvasQualitySource, specifier: string, target: string, report: (message: string) => void): void {
  const current = source.relative.replace(/^src\//, '');
  if (current.startsWith('renderer/kernel/') && (/^(vue|pinia)(\/|$)/.test(specifier) || specifier.startsWith('@plugin/') || /(?:^|\/)cardTypes\//.test(target))) report('kernel只消费shared与引擎适配，不依赖Host/Vue/Pinia/cardTypes');
  if (current.startsWith('shared/') && (/^(vue|pinia)(\/|$)/.test(specifier) || builtins.has(specifier) || /(?:^|\/)(?:renderer|backend)\//.test(target) || specifier.startsWith('@plugin/'))) report('shared必须保持Node/DOM/Host无关');
  if (specifier === 'pixi.js' || specifier.startsWith('pixi.js/')) if (!current.startsWith('renderer/kernel/render/pixi/')) report('Pixi只能从kernel/render/pixi引入');
  if (specifier === 'elkjs' || specifier.startsWith('elkjs/')) if (!current.startsWith('backend/features/canvasLayoutRun/adapters/elk/')) report('ELK只能从layout adapter引入');
  if ((current.startsWith('renderer/') && target.startsWith('backend/')) || (current.startsWith('backend/') && target.startsWith('renderer/'))) report('前后台构建面只经shared或注入port协作');
  if (current.startsWith('renderer/') && builtins.has(specifier)) report('Renderer不得引入Node内建模块');
  const feature = target.match(/^(renderer|backend)\/features\/([^/]+)\/(.+)$/);
  const testBridge = current === 'backend/test-support.ts' && target.startsWith('backend/features/canvasCommit/');
  if (feature && !testBridge && !current.startsWith(`${feature[1]}/features/${feature[2]}/`) && !publicEntries.has(feature[3]) && !publicResources.has(target)) report(`跨feature只能消费公开入口：${target}`);
  if (current.includes('/features/') && /^(renderer|backend)\/orchestration\//.test(target)) report('feature不得反向依赖组合层');
  if (current.includes('/store/') && /(?:^|\/)orchestration\//.test(target)) report('store不得调用编排');
}

/** 模块引用使用TS AST和正式解析选项，注释/字符串内容不冒充导入。 */
export function checkCanvasSourceBoundaries(sources: readonly CanvasQualitySource[], options: { readonly pluginRoot: string; readonly compilerOptions: ts.CompilerOptions }): readonly CanvasQualityIssue[] {
  const issues: CanvasQualityIssue[] = [];
  for (const item of sources) {
    const issue = (node: ts.Node, message: string) => issues.push({ rule: 'boundary', severity: 'error', file: item.relative, line: item.source.getLineAndCharacterOfPosition(node.getStart(item.source)).line + item.lineOffset + 1, message });
    const visit = (node: ts.Node) => {
      const name = moduleName(node);
      if (name) {
        const resolved = ts.resolveModuleName(name, item.path, options.compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
        const fallback = name.startsWith('.') ? path.resolve(path.dirname(item.path), name.split('?')[0]) : name;
        const target = normalize(path.relative(path.join(options.pluginRoot, 'src'), resolved ?? fallback));
        checkImport(item, name, target, message => issue(node, message));
        const packagePath = path.relative(options.pluginRoot, resolved ?? fallback);
        if (name.startsWith('.') && (packagePath.startsWith('..') || path.isAbsolute(packagePath))) issue(node, '相对路径不能进入Canvas包外的Host内部实现');
      }
      if (node.kind === ts.SyntaxKind.AnyKeyword) issue(node, '禁止显式any');
      if (ts.isAsExpression(node) && !(ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === 'const')) issue(node, '类型收窄通过schema/类型守卫完成，禁止绕过断言');
      if (item.relative.includes('/store/') && (ts.isAwaitExpression(node) || (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)))) issue(node, 'store只承载同步状态更新');
      ts.forEachChild(node, visit);
    };
    visit(item.source);
  }
  return issues;
}
