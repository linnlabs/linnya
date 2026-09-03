import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererRoot = join(process.cwd(), 'apps/renderer');
const conversationRoot = join(rendererRoot, 'domains/conversation');
const referenceMentionRoot = join(conversationRoot, 'features/reference-mention');
const productionExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue']);
const composerReferenceActionOwner =
  'domains/conversation/features/composer-references/orchestration/useComposerReferences.ts';

function isTestFile(filePath: string): boolean {
  return /\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/.test(filePath)
    || filePath.includes('/__tests__/');
}

function readProductionFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...readProductionFiles(path));
      continue;
    }
    if (productionExtensions.has(extname(entry.name)) && !isTestFile(path)) {
      files.push(path);
    }
  }
  return files;
}

describe('composer reference boundary', () => {
  it('禁止绕过 feature 动词直调 assistantStore 引用 action', () => {
    const directActionPattern =
      /\.(?:appendComposerReference|removeComposerReference|clearComposerReferences|removeComposerReferencesByPluginId)\s*\(/;
    const offenders = readProductionFiles(rendererRoot)
      .filter((filePath) => directActionPattern.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(rendererRoot, filePath).replace(/\\/g, '/'))
      .filter((filePath) => filePath !== composerReferenceActionOwner)
      .filter((filePath) => filePath !== 'domains/conversation/features/composer-references/store/composerReferenceStore.ts');

    expect(offenders).toEqual([]);
  });

  it('禁止 conversation 按具体引用 kind 编写展示分支', () => {
    const referenceKindBranchPattern =
      /(?:conversationReference|reference)\.kind\s*(?:===|!==)|switch\s*\([^)]*(?:conversationReference|reference)\.kind/;
    const offenders = readProductionFiles(conversationRoot)
      .filter((filePath) => referenceKindBranchPattern.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(conversationRoot, filePath).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });

  it('域外只能经 composer command port 操作引用草稿', () => {
    const directComposablePattern = /\buseComposerReferences\s*\(/;
    const allowedAppOrchestration = new Set([
      'app/plugins/builtin/installBuiltinRendererPluginPorts.ts',
      'app/plugins/orchestration/pluginConversationInputLifecycle.ts',
    ]);
    const offenders = readProductionFiles(rendererRoot)
      .filter((filePath) => !filePath.startsWith(conversationRoot))
      .filter((filePath) => directComposablePattern.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(rendererRoot, filePath).replace(/\\/g, '/'))
      .filter((filePath) => !allowedAppOrchestration.has(filePath));

    expect(offenders).toEqual([]);
  });

  it('ReferenceProvider 只能通过受控 registry 入口注册', () => {
    const directRegistrationPattern = /\bregisterConversationReferenceProvider\s*\(/;
    const allowedRegistrationOwners = new Set([
      'app/plugins/builtin/installBuiltinConversationInputContributions.ts',
      'app/plugins/orchestration/pluginConversationInputLifecycle.ts',
      'domains/conversation/features/composer-references/registry/conversationReferenceProviderRegistry.ts',
    ]);
    const directRegistrationOffenders = readProductionFiles(rendererRoot)
      .filter((filePath) => directRegistrationPattern.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(rendererRoot, filePath).replace(/\\/g, '/'))
      .filter((filePath) => !allowedRegistrationOwners.has(filePath));

    const internalRegistryImportPattern = /composer-references\/registry\/conversationReferenceProviderRegistry/;
    const internalImportOffenders = readProductionFiles(rendererRoot)
      .filter((filePath) => !filePath.startsWith(join(conversationRoot, 'features/composer-references')))
      .filter((filePath) => internalRegistryImportPattern.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(rendererRoot, filePath).replace(/\\/g, '/'));

    expect(directRegistrationOffenders).toEqual([]);
    expect(internalImportOffenders).toEqual([]);
  });

  it('@ 宿主扩展不认识具体 provider 业务', () => {
    const providerBusinessPattern =
      /domains\/(?:workspace|knowledgebase|editor)\/|workspace-document|workspace:\/\/|kb:\/\//;
    const offenders = readProductionFiles(referenceMentionRoot)
      .filter((filePath) => providerBusinessPattern.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(referenceMentionRoot, filePath).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });
});
