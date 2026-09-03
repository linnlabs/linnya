import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const rendererRoot = join(repoRoot, 'apps/renderer');
const conversationRoot = join(rendererRoot, 'domains/conversation');
const productionExtensions = new Set(['.ts', '.tsx', '.vue']);
const businessIdentityPattern = /\b(?:pluginId|documentType|activeDocumentType|nodeType)\b/;

const inputHostRoots = [
  join(conversationRoot, 'ui/AiAssistantInput.vue'),
  join(conversationRoot, 'ui/AiAssistantInput/AiAssistantQuotePreview.vue'),
  join(conversationRoot, 'features/input-extensions'),
  join(conversationRoot, 'features/input-accessories/functions'),
  join(conversationRoot, 'features/input-accessories/orchestration'),
  join(conversationRoot, 'features/input-accessories/ui'),
  join(conversationRoot, 'features/reference-mention'),
] as const;

function isTestFile(filePath: string): boolean {
  return /\.(?:test|spec)\.(?:ts|tsx)$/.test(filePath) || filePath.includes('/__tests__/');
}

function readProductionFiles(path: string): string[] {
  if (productionExtensions.has(extname(path))) {
    return isTestFile(path) ? [] : [path];
  }
  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const childPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...readProductionFiles(childPath));
    } else if (productionExtensions.has(extname(entry.name)) && !isTestFile(childPath)) {
      files.push(childPath);
    }
  }
  return files;
}

function extractSourceChunks(filePath: string, source: string): readonly string[] {
  if (extname(filePath) !== '.vue') return [source];
  return Array.from(source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)).map(
    match => match[1] ?? ''
  );
}

function readDecisionExpressions(sourceFile: ts.SourceFile): readonly ts.Expression[] {
  const expressions: ts.Expression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      expressions.push(node.expression);
    } else if (ts.isConditionalExpression(node)) {
      expressions.push(node.condition);
    } else if (ts.isSwitchStatement(node)) {
      expressions.push(node.expression);
    } else if (ts.isForStatement(node) && node.condition) {
      expressions.push(node.condition);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return expressions;
}

function findBusinessIdentityBranches(filePath: string): readonly string[] {
  const source = readFileSync(filePath, 'utf8');
  return extractSourceChunks(filePath, source).flatMap((chunk, index) => {
    const sourceFile = ts.createSourceFile(
      `${filePath}#${index}`,
      chunk,
      ts.ScriptTarget.Latest,
      true,
      extname(filePath) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    return readDecisionExpressions(sourceFile)
      .filter(expression => businessIdentityPattern.test(expression.getText(sourceFile)))
      .map(
        expression =>
          `${relative(rendererRoot, filePath).replace(/\\/g, '/')}: ${expression.getText(sourceFile)}`
      );
  });
}

describe('plugin conversation input boundary', () => {
  it('输入宿主不得按插件或文档业务身份编写条件分支', () => {
    const offenders = inputHostRoots
      .flatMap(readProductionFiles)
      .flatMap(findBusinessIdentityBranches);

    expect(offenders).toEqual([]);
  });

  it('插件公开输入契约不得重新暴露 editorExtensions 或完整 Input Extension', () => {
    const contractFiles = [
      join(repoRoot, 'packages/plugin-host-contract/renderer/conversationInputContribution.ts'),
      join(repoRoot, 'src/plugin-sdk/renderer/conversationInputContribution.ts'),
    ];
    const offenders: string[] = [];

    for (const filePath of contractFiles) {
      const source = readFileSync(filePath, 'utf8');
      const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      function visit(node: ts.Node): void {
        if (
          ts.isIdentifier(node) &&
          (node.text === 'editorExtensions' ||
            /^ConversationInput(?:EditorExtension|Extension)/.test(node.text))
        ) {
          offenders.push(`${relative(repoRoot, filePath)}: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
    }

    expect(offenders).toEqual([]);
  });
});
