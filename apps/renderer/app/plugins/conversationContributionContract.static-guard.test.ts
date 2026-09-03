import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readInterfaceKeys(filePath: string, interfaceName: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = sourceFile.statements.find((statement): statement is ts.InterfaceDeclaration => (
    ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
  ));
  if (!declaration) throw new Error(`未找到公共接口 ${interfaceName}`);

  return declaration.members.map((member) => {
    const name = member.name;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) return name.text;
    throw new Error(`${interfaceName} 含有无法静态识别的成员`);
  }).sort();
}

function expectExactInterfaceKeys(
  filePath: string,
  interfaceName: string,
  expectedKeys: readonly string[],
): void {
  expect(readInterfaceKeys(filePath, interfaceName)).toEqual([...expectedKeys].sort());
}

function findForbiddenIdentifiersInDeclarations(
  filePath: string,
  declarationNamePattern: RegExp,
  forbiddenIdentifierPattern: RegExp,
): readonly string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const offenders: string[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !(ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement))
      || !declarationNamePattern.test(statement.name.text)
    ) {
      continue;
    }
    const declarationName = statement.name.text;
    function visit(node: ts.Node): void {
      if (ts.isIdentifier(node) && forbiddenIdentifierPattern.test(node.text)) {
        offenders.push(`${declarationName}.${node.text}`);
      }
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(statement, visit);
  }
  return offenders;
}

describe('conversation plugin contribution public contract', () => {
  const composerContract = join(
    repoRoot,
    'packages/plugin-host-contract/renderer/composerCommandPort.ts',
  );
  const inputContract = join(
    repoRoot,
    'packages/plugin-host-contract/renderer/conversationInputContribution.ts',
  );
  const subrunContract = join(
    repoRoot,
    'packages/plugin-host-contract/renderer/conversationSubrunInvocationPort.ts',
  );

  it('ComposerCommandPort 只允许精确增删引用', () => {
    expectExactInterfaceKeys(
      composerContract,
      'RendererComposerCommandPort',
      ['addReference', 'removeReference'],
    );
  });

  it('Accessory 只暴露运行期展示与 owner-bound composer 命令', () => {
    expectExactInterfaceKeys(
      inputContract,
      'ConversationInputAccessoryComposerCommands',
      ['addReference', 'removeReference'],
    );
    expectExactInterfaceKeys(
      inputContract,
      'ConversationInputAccessoryProps',
      ['composer', 'disabled'],
    );
    expectExactInterfaceKeys(
      inputContract,
      'ConversationInputAccessoryContribution',
      ['pluginId', 'id', 'component', 'isVisible'],
    );
    expect(findForbiddenIdentifiersInDeclarations(
      inputContract,
      /^ConversationInputAccessory/,
      /submit|dismiss|payload|editor/i,
    )).toEqual([]);
  });

  it('Subrun 声明与调用面不得扩散 forced-tool 或系统 promptKey', () => {
    expectExactInterfaceKeys(
      subrunContract,
      'ConversationSubrunWorkerContribution',
      ['id', 'promptKey'],
    );
    expectExactInterfaceKeys(
      subrunContract,
      'ConversationSubrunInvocationItem',
      ['description', 'prompt'],
    );
    expectExactInterfaceKeys(
      subrunContract,
      'StartConversationSubrunsRequest',
      ['pluginId', 'workerId', 'prompt', 'activityFeature', 'subruns', 'messageExtension'],
    );
    expectExactInterfaceKeys(
      subrunContract,
      'ConversationSubrunRunHandle',
      ['runId', 'completion', 'cancel'],
    );
    expectExactInterfaceKeys(
      subrunContract,
      'RendererConversationSubrunInvocationPort',
      ['start'],
    );
  });
});
