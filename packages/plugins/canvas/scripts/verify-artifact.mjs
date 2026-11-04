import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import ts from 'typescript';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'plugin.json'), 'utf8'));
const zip = await JSZip.loadAsync(await readFile(path.join(packageRoot, 'dist/artifacts', `canvas-${manifest.version}.zip`)));
const required = ['dist/backend/index.cjs', 'dist/backend/canvas-computation-worker.cjs', 'dist/backend/render-worker-preload.cjs',
  'dist/cli/canvas-cli.cjs', 'dist/renderer/index.js', 'dist/renderer/renderer-stylesheets.json', 'dist/render-worker/worker.html', 'resources/skills/canvas/SKILL.md'];
const files = Object.keys(zip.files).filter(file => !zip.files[file].dir);
for (const file of required) assert(zip.file(file), `artifact missing ${file}`);
assert(files.some(file => file.startsWith('dist/render-worker/assets/') && /\.woff2?$/.test(file)), 'worker font closure missing');
assert(files.some(file => file.startsWith('dist/render-worker/assets/') && file.endsWith('.css')), 'worker stylesheet missing');
assert(!files.some(file => /(?:^|\/)(?:src|dev|scripts|node_modules|\.metadata|__tests__)(?:\/|$)|\.map$/.test(file)), 'artifact contains development/source output');

const normalize = value => value.replaceAll('\\', '/');
const isBuiltin = value => builtinModules.includes(value) || builtinModules.includes(value.replace(/^node:/, ''));
const forbiddenShared = input => /(?:^|\/)elkjs(?:@|\/)|(?:^|\/)pixi(?:\.js|@)|\/src\/renderer\/|\/apps\/renderer\/|\/src\/app-hosts\//.test(input);
const readonlyReceipt = input => /\/src\/backend\/features\/agentChanges\/(?:queries\.ts|persistence\/readCanvasAgentReceipts\.ts)$/.test(input);
const forbiddenCli = input => !readonlyReceipt(input) && /\/src\/backend\/(?:features\/(?:agentChanges|canvasWrite|canvasUndoHistory|canvasVersionHistory|canvasVersionRestore|canvasExport)\/|orchestration\/(?:createCanvasDocumentRuntime|executeCanvasCliWrite|history)\b)/.test(input);
const mutationOnly = input => /\/src\/backend\/features\/canvasCommit\/(?:orchestration\/commitCanvasOperations|functions\/(?:planCanvasCommit|createCanvasElements|mutateCanvasElement|canvasPlanChanges|findCanvasPlacement|clearCanvasLayoutObstacles))\.ts$/.test(input);
const bundleReports = [];
function declaredFunctions(source) {
  const names = new Set();
  const visit = node => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source); return names;
}
for (const [name, outputPath, budget] of [['backend', 'dist/backend/index.cjs', 3 * 1024 ** 2], ['cli', 'dist/cli/canvas-cli.cjs', 3.2 * 1024 ** 2], ['computation', 'dist/backend/canvas-computation-worker.cjs', 5 * 1024 ** 2]]) {
  const record = JSON.parse(await readFile(path.join(packageRoot, 'dist/.metadata', `${name}.json`), 'utf8'));
  const output = Object.entries(record.metafile.outputs).find(([file]) => path.resolve(record.workingDirectory, file) === path.join(packageRoot, outputPath));
  assert(output, `${name}: actual entry metadata missing`);
  const actualBytes = (await stat(path.join(packageRoot, outputPath))).size; assert(actualBytes <= budget, `${name}: ${actualBytes} > ${budget}`);
  const inputs = Object.entries(output[1].inputs).filter(([, data]) => data.bytesInOutput > 0).map(([file]) => normalize(path.resolve(record.workingDirectory, file)));
  assert(!inputs.some(input => /(?:__tests__|test-support|dev\/probes)/.test(input)), `${name}: test implementation bundled`);
  if (name !== 'computation') assert(!inputs.some(forbiddenShared), `${name}: ELK/Pixi/Renderer/Host implementation bundled`);
  if (name === 'cli') assert(!inputs.some(forbiddenCli), 'CLI mutation runtime bundled');
  if (name === 'computation') {
    assert(inputs.some(input => /\/elkjs(?:@|\/)/.test(input)), 'ELK did not enter its computation worker');
    assert(!inputs.some(input => /\/src\/renderer\/|\/pixi\.js(?:@|\/)/.test(input)), 'computation worker contains renderer engine');
  }
  for (const dependency of output[1].imports) {
    if (!dependency.external) continue;
    const permitted = isBuiltin(dependency.path) || name === 'backend' && /^(?:@app\/schemas(?:\/|$)|@plugin\/backend\/)/.test(dependency.path)
      || name === 'cli' && ['better-sqlite3', 'electron'].includes(dependency.path);
    assert(permitted, `${name}: unclosed runtime dependency ${dependency.path}`);
  }
  let mutationInitializers = 0;
  if (name === 'cli') {
    // 动态只读模块会保留公开barrel的空init闭包；以实际AST证明写函数体已消除，不能凭几百bytes猜测。
    const compiled = ts.createSourceFile(outputPath, await readFile(path.join(packageRoot, outputPath), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const compiledNames = declaredFunctions(compiled);
    for (const input of inputs.filter(mutationOnly)) {
      const source = ts.createSourceFile(input, await readFile(input, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const name of declaredFunctions(source)) assert(![...compiledNames].some(actual => actual === name || new RegExp(`^${name}_[0-9]+$`).test(actual)), `CLI retained executable mutation ${name}`);
      mutationInitializers++;
    }
  }
  bundleReports.push({ name, actualBytes, budget, liveInputs: inputs.length, mutationInitializers });
}

function artifactReference(file, reference) {
  if (!reference || reference.startsWith('#') || /^(?:data:|blob:)/.test(reference)) return;
  assert(!/^[a-z]+:|^\//i.test(reference), `${file}: external resource ${reference}`);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), reference.split(/[?#]/)[0]));
  assert(!resolved.startsWith('../') && zip.file(resolved), `${file}: missing closed resource ${resolved}`);
}
for (const file of files.filter(file => file.startsWith('dist/render-worker/') || file.startsWith('dist/renderer/'))) {
  const text = await zip.file(file).async('string');
  if (file.endsWith('.html')) for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) artifactReference(file, match[1]);
  if (file.endsWith('.css')) for (const match of text.matchAll(/url\(["']?([^\s)"']+)["']?\)/g)) artifactReference(file, match[1]);
  if (file.endsWith('.js')) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) { if (node.moduleSpecifier.text.startsWith('.')) artifactReference(file, node.moduleSpecifier.text); else assert(file.startsWith('dist/renderer/'), `${file}: unclosed worker import ${node.moduleSpecifier.text}`); }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) { if (node.arguments[0].text.startsWith('.')) artifactReference(file, node.arguments[0].text); else assert(file.startsWith('dist/renderer/'), `${file}: unclosed worker import ${node.arguments[0].text}`); }
      ts.forEachChild(node, visit);
    }; visit(source);
  }
}
console.log(JSON.stringify({ plugin: 'canvas', artifactFiles: files.length, requiredFiles: required.length, bundles: bundleReports, passed: true }, null, 2));
