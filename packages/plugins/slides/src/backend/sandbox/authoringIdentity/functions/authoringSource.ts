import { createHash } from 'node:crypto';
import type ts from 'typescript';
import { getSlidesTypeScriptRuntime } from '../../../capabilities/typescriptRuntime/index.js';
import { hashAuthoringPath } from './authoringPathKey.js';

const FACTORIES = new Set(['createSlide', 'createFrame', 'createText', 'createShape', 'createChart',
  'createTable', 'createImage', 'createSvgGraphic', 'createFormula', 'createBrushArtwork', 'createSpacer']);
interface CallSite { readonly start: number; readonly end: number; readonly anchor: string; readonly factory: boolean; readonly marked: boolean; readonly unstable: boolean; readonly owner?: string; readonly name: string }
interface SourcePlan { readonly digest: string; readonly calls: readonly CallSite[] }
const GENERATION_MARKER = /\/\*@slides-generation:([a-f0-9]{24}):([a-f0-9]{24})\*\//;

/** 只有已验证的系统编辑可延续实例世代；AI 改码后摘要不符，旧世代立即失效。 */
export function preserveAuthoringGeneration(before: string, after: string): string {
  const base = planAuthoringSource(before);
  if (!base.calls.some(call => call.marked)) return after;
  const withoutMarker = after.replace(GENERATION_MARKER, '');
  const currentDigest = planAuthoringSource(withoutMarker).digest;
  return `/*@slides-generation:${base.digest}:${currentDigest}*/` + withoutMarker;
}

/** 身份标记是注释，不改参数求值、简写转换或用户函数签名。 */
export function anchorAuthoringSource(source: string): string {
  const plan = planAuthoringSource(source);
  let result = source;
  for (const call of [...plan.calls].sort((a, b) => b.start - a.start)) {
    if (!call.marked) result = result.slice(0, call.start) + `/*@slides-id:${call.anchor}*/` + result.slice(call.start);
  }
  return result;
}

/** 仅从已固定的页面调用点恢复系统身份；不向用户配置对象插入字段。 */
export function readSystemSlideKey(source: string, callStart: number): string | undefined {
  const marker = source.slice(Math.max(0, callStart - 80), callStart).match(/\/\*@slides-id:(a[a-f0-9]{16})\*\/\s*$/);
  return marker ? 'sysp_' + hashAuthoringPath(marker[1]) : undefined;
}

export function instrumentAuthoringSource(source: string): string {
  const plan = planAuthoringSource(source);
  const edits: { position: number; text: string }[] = [];
  for (const call of plan.calls) {
    edits.push({ position: call.start, text: `__withAuthoringScope(${JSON.stringify((call.unstable ? 'r:' : '') + call.anchor)},()=>${call.factory ? '__trackAuthoringNode(' : ''}` });
    edits.push({ position: call.end, text: call.factory ? `,${JSON.stringify(call.owner ?? '')}),"")` : `,${JSON.stringify(call.name)})` });
  }
  let result = source;
  for (const edit of edits.sort((a, b) => b.position - a.position)) {
    result = result.slice(0, edit.position) + edit.text + result.slice(edit.position);
  }
  return `var __authoringGeneration=${JSON.stringify(plan.digest)};` + result;
}

/** 页面投影只允许复用已经固定的调用点；新插入的空白页具有显式 key。 */
export function hasUnanchoredObjectCalls(source: string): boolean {
  return planAuthoringSource(source).calls.some(call => !call.marked && call.name !== 'createSlide');
}

function planAuthoringSource(source: string): SourcePlan {
  const t = getSlidesTypeScriptRuntime();
  const sf = t.createSourceFile('deck.js', source, t.ScriptTarget.Latest, true, t.ScriptKind.JS);
  const helpers = new Set<string>();
  const omitted: { start: number; end: number }[] = [];
  function omitProperty(properties: ts.NodeArray<ts.ObjectLiteralElementLike>, index: number): void {
    const property = properties[index], next = properties[index + 1], previous = properties[index - 1];
    omitted.push(next ? { start: property.getFullStart(), end: next.getFullStart() }
      : previous ? { start: previous.end, end: property.end }
        : { start: property.getFullStart(), end: property.end });
  }
  function collect(node: ts.Node): void {
    if (t.isFunctionDeclaration(node) && node.name) helpers.add(node.name.text);
    if (t.isVariableDeclaration(node) && t.isIdentifier(node.name) && node.initializer
      && (t.isArrowFunction(node.initializer) || t.isFunctionExpression(node.initializer))) helpers.add(node.name.text);
    if (t.isCallExpression(node) && t.isIdentifier(node.expression) && node.expression.text === 'compose') {
      const input = node.arguments[0];
      if (input && t.isObjectLiteralExpression(input)) {
        const properties = input.properties;
        for (const [index, property] of properties.entries()) {
          if (!t.isPropertyAssignment(property) || property.name.getText(sf).replace(/["']/g, '') !== 'manualEdits') continue;
          omitProperty(properties, index);
        }
      }
    }
    if (t.isCallExpression(node) && t.isIdentifier(node.expression) && node.expression.text === 'createSlide') {
      const config = node.arguments[0];
      if (config && t.isObjectLiteralExpression(config)) {
        if (config.properties.length === 0) omitted.push({ start: config.getStart(sf), end: config.end });
        config.properties.forEach((property, index) => {
          if (t.isPropertyAssignment(property) && property.name.getText(sf).replace(/["']/g, '') === 'slideKey'
            && t.isStringLiteralLike(property.initializer) && /^sysp_[a-f0-9]{16}$/.test(property.initializer.text)) {
            if (config.properties.length === 1) omitted.push({ start: config.getStart(sf), end: config.end });
            else omitProperty(config.properties, index);
          }
        });
      }
    }
    t.forEachChild(node, collect);
  }
  collect(sf);
  let generatingSource = source;
  for (const range of omitted.sort((a, b) => b.start - a.start)) generatingSource = generatingSource.slice(0, range.start) + generatingSource.slice(range.end);
  const scanner = t.createScanner(t.ScriptTarget.Latest, true, t.LanguageVariant.Standard, generatingSource);
  const tokens: string[] = [];
  while (scanner.scan() !== t.SyntaxKind.EndOfFileToken) tokens.push(scanner.getTokenText());
  const canonical = tokens.filter((token, index) => token !== ',' || !['}', ']', ')'].includes(tokens[index + 1]));
  const programDigest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24);
  const generation = source.match(GENERATION_MARKER);
  const digest = generation?.[2] === programDigest ? generation[1] : programDigest;
  const calls: CallSite[] = [];
  function visit(node: ts.Node): void {
    if (t.isCallExpression(node) && t.isIdentifier(node.expression)
      && (FACTORIES.has(node.expression.text) || helpers.has(node.expression.text))) {
      const start = node.getStart(sf);
      const marker = source.slice(Math.max(0, start - 80), start).match(/\/\*@slides-id:(a[a-f0-9]{16})\*\/\s*$/);
      const anchor = marker?.[1] ?? 'a' + createHash('sha256').update(`${digest}:${calls.length}`).digest('hex').slice(0, 16);
      let parent: ts.Node | undefined = node.parent;
      let unstable = false;
      let owner: string | undefined;
      while (parent) {
        if (t.isForStatement(parent) || t.isForOfStatement(parent) || t.isForInStatement(parent)
          || t.isWhileStatement(parent) || t.isDoStatement(parent)) unstable = true;
        if (t.isArrowFunction(parent) || t.isFunctionExpression(parent) || t.isFunctionDeclaration(parent)) {
          if (!owner) {
            if (parent.name && t.isIdentifier(parent.name)) owner = parent.name.text;
            else if (t.isVariableDeclaration(parent.parent) && t.isIdentifier(parent.parent.name)) owner = parent.parent.name.text;
            else unstable = true; // 内联回调即使只执行一次，也不能把序号提升为长期身份。
          }
        }
        parent = parent.parent;
      }
      calls.push({ start, end: node.end, anchor, factory: FACTORIES.has(node.expression.text), marked: !!marker, unstable, owner, name: node.expression.text });
    }
    t.forEachChild(node, visit);
  }
  visit(sf);
  return { digest, calls };
}
