import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { uiProjectionFixtures } from 'src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/__fixtures__/uiProjectionFixtures';

const RUNTIME_EVENT_CONTRACT_PATH = 'packages/linnkit/src/contracts/events.ts';

/**
 * 这些 RuntimeEvent 有正式生命周期，但不生成 Conversation UI read model。
 * 新增条目必须写清 owner；不能用“暂时没做 fixture”作为理由。
 */
const NON_CONVERSATION_UI_EVENT_REASONS = {
  audit_envelope: 'dev-only 审计事实，不进入用户时间线、SSE 或 UI reload',
  control: '历史变更命令由 EventStore mutation 解释，不投影为 Conversation 消息',
} as const satisfies Partial<Record<RuntimeEvent['type'], string>>;

function readRuntimeEventVariants(): string[] {
  const absolutePath = path.join(process.cwd(), RUNTIME_EVENT_CONTRACT_PATH);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let variants: string[] = [];
  let foundShape = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'RuntimeEventShape'
      && node.initializer
      && ts.isCallExpression(node.initializer)
    ) {
      const members = node.initializer.arguments[1];
      if (!members || !ts.isArrayLiteralExpression(members)) return;
      foundShape = true;
      variants = members.elements.flatMap((member) => readVariantLiteral(member));
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  if (!foundShape || variants.length === 0) {
    throw new Error(`未能从 ${RUNTIME_EVENT_CONTRACT_PATH} 读取 RuntimeEventShape`);
  }
  return variants;
}

function readVariantLiteral(node: ts.Expression): string[] {
  if (!ts.isCallExpression(node)) return [];
  const shape = node.arguments[0];
  if (!shape || !ts.isObjectLiteralExpression(shape)) return [];

  for (const property of shape.properties) {
    if (
      !ts.isPropertyAssignment(property)
      || property.name.getText() !== 'type'
      || !ts.isCallExpression(property.initializer)
    ) {
      continue;
    }
    const value = property.initializer.arguments[0];
    return value && ts.isStringLiteralLike(value) ? [value.text] : [];
  }
  return [];
}

describe('RuntimeEvent → Conversation UI parity coverage', () => {
  it('每个正式 RuntimeEvent 必须进入 fixture 或显式登记为非 UI 事件', () => {
    const contractVariants = new Set(readRuntimeEventVariants());
    const fixtureVariants = new Set<string>(
      uiProjectionFixtures.flatMap(fixture => fixture.events.map(event => event.type)),
    );
    const excludedVariants = new Set<string>(Object.keys(NON_CONVERSATION_UI_EVENT_REASONS));

    const unclassified = [...contractVariants]
      .filter(type => !fixtureVariants.has(type) && !excludedVariants.has(type))
      .sort();
    const staleExclusions = [...excludedVariants]
      .filter(type => !contractVariants.has(type))
      .sort();

    expect(unclassified, '新增事件必须补 parity fixture 或登记非 UI owner 与理由').toEqual([]);
    expect(staleExclusions, '非 UI 清单不能保留已删除或改名的事件').toEqual([]);
  });
});
