import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@vue/compiler-sfc';
import ts from 'typescript';

type AuditKind = 'static-text' | 'static-attribute' | 'runtime-call' | 'config-property';
type AuditLanguage = 'cjk' | 'latin';

interface AuditFinding {
  readonly file: string;
  readonly line: number;
  readonly kind: AuditKind;
  readonly language: AuditLanguage;
  readonly name: string;
  readonly value: string;
}

interface TemplateNode {
  readonly type: number;
  readonly content?: string;
  readonly loc?: {
    readonly start: {
      readonly line: number;
    };
  };
  readonly props?: readonly TemplateProp[];
  readonly children?: readonly TemplateNode[];
}

interface TemplateProp {
  readonly type: number;
  readonly name?: string;
  readonly value?: {
    readonly content: string;
  };
  readonly loc?: {
    readonly start: {
      readonly line: number;
    };
  };
}

const RENDERER_ROOTS = [
  'apps/renderer/app',
  'apps/renderer/domains',
  'apps/renderer/shared',
] as const;

const SKIP_PATH_PARTS = [
  '/engine/',
  '/react-ref/',
  '/docs/',
  '/__tests__/',
  '/__test__/',
] as const;

const SKIP_FILE_PARTS = [
  '.test.',
  '.spec.',
  '.stories.',
  'MessageCatalog.',
  'Messages.',
] as const;

const USER_VISIBLE_STATIC_ATTRS = new Set([
  'aria-label',
  'alt',
  'label',
  'message',
  'placeholder',
  'primary-action-text',
  'secondary-action-text',
  'title',
  'trigger-title',
]);

const USER_VISIBLE_CONFIG_PROPS = new Set([
  'ariaLabel',
  'description',
  'emptyText',
  'label',
  'message',
  'placeholder',
  'subtitle',
  'title',
  'tooltip',
]);

const STATIC_ATTR_ALLOWLIST: ReadonlyArray<RegExp> = [
  /^apps\/renderer\/shared\/components\/icons\/.*\.vue:\d+:static-attribute:data-name:/,
];

const STATIC_LATIN_ALLOWLIST: ReadonlyArray<RegExp> = [
  /:static-text::A$/,
  /:static-text::AI$/,
  /:static-text::Ctrl$/,
  /:static-text::ESC$/,
  /:static-text::Enter$/,
  /:static-text::H$/,
  /:static-text::LLM$/,
  /:static-text::URL$/,
  /:static-text::fx$/,
  /:static-text::ms$/,
  /:static-text::v$/,
  /:static-text::feedback@linnyai\.com$/,
  /:static-text::linnyai\.com$/,
  /:static-text::linnyai\.com\/blog$/,
  /:static-attribute:label:AI$/,
  /:static-attribute:placeholder:https:\/\/\.\.\.$/,
  /:static-attribute:placeholder:https:\/\/example\.com\/article$/,
  /:static-attribute:placeholder:http:\/\/localhost:11434$/,
  /^apps\/renderer\/app\/plugins\/builtin\/platform\.renderer\.ts:\d+:config-property:ariaLabel:Enabled: Deep research$/,
  /^apps\/renderer\/app\/plugins\/builtin\/platform\.renderer\.ts:\d+:config-property:description:Built-in Linnya renderer capabilities$/,
  /^apps\/renderer\/app\/plugins\/builtin\/platform\.renderer\.ts:\d+:config-property:description:Markdown document entity, used as the root entity for cross-plugin references\.$/,
  /^apps\/renderer\/app\/plugins\/builtin\/platform\.renderer\.ts:\d+:config-property:description:Markdown document block entity for references, evidence, and future plugin content targeting\.$/,
  /^apps\/renderer\/app\/plugins\/builtin\/platform\.renderer\.ts:\d+:config-property:description:Sheet workbook entity, used as the root entity for cross-plugin references\.$/,
  /^apps\/renderer\/app\/plugins\/builtin\/platform\.renderer\.ts:\d+:config-property:description:Sheet cell range entity for analysis, references, and cross-plugin data workflows\.$/,
  /^apps\/renderer\/app\/plugins\/builtin\/platform\.renderer\.ts:\d+:config-property:label:Document$/,
  /^apps\/renderer\/app\/plugins\/builtin\/platform\.renderer\.ts:\d+:config-property:label:Spreadsheet$/,
  /^apps\/renderer\/domains\/editor\/blocks\/CodeBlock\/functions\/codeBlockPresentation\.ts:\d+:config-property:label:[A-Za-z+#]+$/,
  /^apps\/renderer\/domains\/editor\/features\/DocumentSettings\/registry\/registerEditorDocumentSettingsContribution\.ts:\d+:config-property:title:Text document$/,
  /^apps\/renderer\/domains\/editor\/ui\/runtime\/setupEditorVirtualizationRuntime\.ts:\d+:config-property:label:(editor-ready|scroll-root-ready)$/,
  /^apps\/renderer\/domains\/editor\/features\/RenderVirtualization\/controller\/refreshReason\.ts:\d+:config-property:label:(manual|scheduled)$/,
  /^apps\/renderer\/domains\/editor\/features\/RenderVirtualization\/controller\/renderVirtualizationEngine\.ts:\d+:config-property:label:scheduled$/,
  /^apps\/renderer\/domains\/editor\/services\/useStreamingHandlers\.ts:\d+:config-property:message:WASM Streaming Parser failed to initialize$/,
  /^apps\/renderer\/domains\/editor\/shared\/rootBlockDomContract\.ts:\d+:config-property:placeholder:(is-placeholder|data-placeholder|placeholder)$/,
  /^apps\/renderer\/domains\/editor\/ui\/services\/editorPerfBenchmark\.ts:\d+:config-property:label:manual-benchmark$/,
  /^apps\/renderer\/domains\/plugin-store\/ui\/PluginStoreView\.vue:\d+:config-property:label:PluginCapabilityList$/,
];

const CONFIG_CJK_ALLOWLIST: ReadonlyArray<RegExp> = [
  /^apps\/renderer\/domains\/settings\/definitions\/currentRelease\.generated\.ts:\d+:config-property:title:/,
  /^apps\/renderer\/domains\/sheet\/services\/persistence\/.*:\d+:config-property:message:/,
  /^apps\/renderer\/domains\/editor\/extensions\/interaction\/drag\/dragUtils\.js:\d+:config-property:message:/,
  /^apps\/renderer\/domains\/knowledgebase\/stores\/knowledgeBase\/actions\/polling\.js:\d+:config-property:description:/,
];

function shouldSkipPath(filePath: string): boolean {
  return SKIP_PATH_PARTS.some((part) => filePath.includes(part))
    || SKIP_FILE_PARTS.some((part) => filePath.includes(part));
}

function collectSourceFiles(root: string): readonly string[] {
  const files: string[] = [];

  function walk(directory: string): void {
    for (const entry of readdirSync(directory)) {
      const filePath = join(directory, entry);
      if (shouldSkipPath(filePath)) continue;

      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        walk(filePath);
      } else if (isSupportedSourceFile(filePath)) {
        files.push(filePath);
      }
    }
  }

  walk(root);
  return files;
}

function isSupportedSourceFile(filePath: string): boolean {
  return filePath.endsWith('.vue')
    || filePath.endsWith('.ts')
    || filePath.endsWith('.tsx')
    || filePath.endsWith('.js')
    || filePath.endsWith('.jsx');
}

function normalizeTemplateText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function classifyLanguage(value: string): AuditLanguage | null {
  if (/[\u4e00-\u9fff]/.test(value)) return 'cjk';
  if (/[A-Za-z]/.test(value)) return 'latin';
  return null;
}

function findingKey(finding: AuditFinding): string {
  return [
    finding.file,
    finding.line,
    finding.kind,
    finding.name,
    finding.value,
  ].join(':');
}

function isAllowedFinding(finding: AuditFinding): boolean {
  const key = findingKey(finding);
  if (finding.language === 'latin') {
    return STATIC_LATIN_ALLOWLIST.some((pattern) => pattern.test(key));
  }
  if (finding.kind === 'static-attribute') {
    return STATIC_ATTR_ALLOWLIST.some((pattern) => pattern.test(key));
  }
  if (finding.kind === 'config-property' && finding.language === 'cjk') {
    return CONFIG_CJK_ALLOWLIST.some((pattern) => pattern.test(key));
  }
  return false;
}

function readLineOffset(source: string, startOffset: number): number {
  return source.slice(0, startOffset).split('\n').length - 1;
}

function visitTemplateNode(
  node: TemplateNode,
  file: string,
  findings: AuditFinding[],
): void {
  if (node.type === 2 && typeof node.content === 'string') {
    const value = normalizeTemplateText(node.content);
    const language = classifyLanguage(value);
    if (language && value.length > 0) {
      findings.push({
        file,
        line: node.loc?.start.line ?? 0,
        kind: 'static-text',
        language,
        name: '',
        value,
      });
    }
  }

  if (node.type === 1) {
    for (const prop of node.props ?? []) {
      if (prop.type !== 6) continue;
      if (!prop.name || !USER_VISIBLE_STATIC_ATTRS.has(prop.name)) continue;
      const value = prop.value?.content ? normalizeTemplateText(prop.value.content) : '';
      const language = classifyLanguage(value);
      if (!language || value.length === 0) continue;
      findings.push({
        file,
        line: prop.loc?.start.line ?? 0,
        kind: 'static-attribute',
        language,
        name: prop.name,
        value,
      });
    }
  }

  for (const child of node.children ?? []) {
    visitTemplateNode(child, file, findings);
  }
}

function auditFile(file: string): readonly AuditFinding[] {
  if (file.endsWith('.vue')) {
    return auditVueFile(file);
  }

  return auditRuntimeSource(file, readFileSync(file, 'utf8'), 0);
}

function auditVueFile(file: string): readonly AuditFinding[] {
  const source = readFileSync(file, 'utf8');
  const descriptor = parse(source, { filename: file }).descriptor;

  const findings: AuditFinding[] = [];
  const ast = descriptor.template?.ast as TemplateNode | undefined;
  if (ast) {
    visitTemplateNode(ast, file, findings);
  }

  if (descriptor.script) {
    findings.push(...auditRuntimeSource(
      file,
      descriptor.script.content,
      readLineOffset(source, descriptor.script.loc.start.offset),
    ));
  }

  if (descriptor.scriptSetup) {
    findings.push(...auditRuntimeSource(
      file,
      descriptor.scriptSetup.content,
      readLineOffset(source, descriptor.scriptSetup.loc.start.offset),
    ));
  }

  return findings.filter((finding) => !isAllowedFinding(finding));
}

function auditRuntimeSource(
  file: string,
  source: string,
  lineOffset: number,
): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(file),
  );

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      collectRuntimeCallFindings(file, sourceFile, node, lineOffset, findings);
    } else if (ts.isPropertyAssignment(node)) {
      collectConfigPropertyFinding(file, sourceFile, node, lineOffset, findings);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings.filter((finding) => !isAllowedFinding(finding));
}

function collectConfigPropertyFinding(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.PropertyAssignment,
  lineOffset: number,
  findings: AuditFinding[],
): void {
  const name = readPropertyName(node.name);
  if (!name || !USER_VISIBLE_CONFIG_PROPS.has(name)) return;
  const value = readStaticString(node.initializer);
  if (!value) return;
  const language = classifyLanguage(value);
  if (!language) return;
  const position = sourceFile.getLineAndCharacterOfPosition(node.initializer.getStart(sourceFile));
  findings.push({
    file,
    line: position.line + 1 + lineOffset,
    kind: 'config-property',
    language,
    name,
    value,
  });
}

function readScriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.js')) return ts.ScriptKind.JS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function collectRuntimeCallFindings(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  lineOffset: number,
  findings: AuditFinding[],
): void {
  const callKind = resolveUserVisibleCallKind(node.expression);
  if (!callKind) return;

  if (callKind === 'confirm') {
    collectConfirmObjectFindings(file, sourceFile, node, lineOffset, findings);
    return;
  }

  collectStringArgumentFinding(file, sourceFile, node, lineOffset, callKind, findings);
}

function resolveUserVisibleCallKind(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    if (expression.text === 'alert' || expression.text === 'confirm') return expression.text;
    return null;
  }

  if (!ts.isPropertyAccessExpression(expression)) return null;

  if (expression.name.text === 'confirm' && isWindowIdentifier(expression.expression)) {
    return 'window.confirm';
  }

  if (expression.name.text !== 'show') return null;
  if (ts.isIdentifier(expression.expression) && expression.expression.text === 'notificationStore') {
    return 'notificationStore.show';
  }
  if (
    ts.isCallExpression(expression.expression)
    && ts.isIdentifier(expression.expression.expression)
    && expression.expression.expression.text === 'useNotificationStore'
  ) {
    return 'useNotificationStore().show';
  }

  return null;
}

function isWindowIdentifier(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && expression.text === 'window';
}

function collectStringArgumentFinding(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  lineOffset: number,
  callKind: string,
  findings: AuditFinding[],
): void {
  const firstArg = node.arguments[0];
  const value = readStaticString(firstArg);
  if (!value) return;
  pushRuntimeFinding(file, sourceFile, firstArg, lineOffset, callKind, value, findings);
}

function collectConfirmObjectFindings(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.CallExpression,
  lineOffset: number,
  findings: AuditFinding[],
): void {
  const firstArg = node.arguments[0];
  if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) {
    collectStringArgumentFinding(file, sourceFile, node, lineOffset, 'confirm', findings);
    return;
  }

  for (const property of firstArg.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = readPropertyName(property.name);
    if (!name || !USER_VISIBLE_STATIC_ATTRS.has(name)) continue;
    const value = readStaticString(property.initializer);
    if (!value) continue;
    pushRuntimeFinding(file, sourceFile, property.initializer, lineOffset, `confirm.${name}`, value, findings);
  }
}

function readPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function readStaticString(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return normalizeTemplateText(node.text);
  }
  return null;
}

function pushRuntimeFinding(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  lineOffset: number,
  name: string,
  value: string,
  findings: AuditFinding[],
): void {
  const language = classifyLanguage(value);
  if (!language) return;
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  findings.push({
    file,
    line: position.line + 1 + lineOffset,
    kind: 'runtime-call',
    language,
    name,
    value,
  });
}

function runAudit(): readonly AuditFinding[] {
  return RENDERER_ROOTS
    .flatMap((root) => collectSourceFiles(root))
    .flatMap((file) => auditFile(file));
}

const findings = runAudit();

if (findings.length > 0) {
  console.error('User-visible static localization findings:');
  for (const finding of findings) {
    const prop = finding.name ? `${finding.name}:` : '';
    console.error(
      `${finding.file}:${finding.line} ${finding.language} ${finding.kind} ${prop}${finding.value}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log('User-visible static localization audit passed.');
}
