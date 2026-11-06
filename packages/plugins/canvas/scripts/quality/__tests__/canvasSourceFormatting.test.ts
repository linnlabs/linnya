import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { checkCanvasSourceFormatting } from '../functions/checkCanvasSourceFormatting';

it('拒绝多语句压行，接纳仓内标准排版且同一SFC不重复报告', async () => {
  const text = 'export function update(){const first=1;const second=2;return first+second;}';
  const source = {
    path: fileURLToPath(
      new URL('../../../src/shared/model/functions/formatting-fixture.ts', import.meta.url)
    ),
    relative: 'src/shared/model/functions/formatting-fixture.ts',
    text,
    fileLines: 1,
    lineOffset: 0,
    source: ts.createSourceFile('formatting-fixture.ts', text, ts.ScriptTarget.Latest, true),
  };
  const issues = await checkCanvasSourceFormatting([source, source]);
  expect(issues).toEqual([expect.objectContaining({ rule: 'format', severity: 'error' })]);
  const formatted =
    'export function update() {\n  const first = 1;\n  const second = 2;\n  return first + second;\n}\n';
  expect(await checkCanvasSourceFormatting([{ ...source, text: formatted }])).toEqual([]);
});
