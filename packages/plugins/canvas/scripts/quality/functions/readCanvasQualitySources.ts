import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse as parseVue } from 'vue/compiler-sfc';
import type { CanvasQualitySource } from '../definitions/canvasQuality';

/** SFC只分析正式script，行号保留原文件位置，不能把模板中的条件误计为TS分支。 */
export function readCanvasQualitySources(pluginRoot: string): readonly CanvasQualitySource[] {
  const paths = ts.sys.readDirectory(path.join(pluginRoot, 'src'), ['.ts', '.tsx', '.vue'], ['**/__tests__/**', '**/*.test.*', '**/*.d.ts'], ['**/*']);
  return paths.flatMap(file => {
    const text = fs.readFileSync(file, 'utf8'), relative = path.relative(pluginRoot, file).replaceAll('\\', '/'), fileLines = text.split(/\r?\n/).length;
    if (!file.endsWith('.vue')) return [{ path: file, relative, text, fileLines, lineOffset: 0, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) }];
    const { descriptor } = parseVue(text, { filename: file });
    const blocks = [descriptor.script, descriptor.scriptSetup].filter(block => block !== null);
    if (!blocks.length) return [{ path: file, relative, text, fileLines, lineOffset: 0, source: ts.createSourceFile(`${file}.ts`, '', ts.ScriptTarget.Latest, true) }];
    return blocks.map(block => ({ path: file, relative, text, fileLines, lineOffset: block.loc.start.line - 1,
      source: ts.createSourceFile(`${file}.ts`, block.content, ts.ScriptTarget.Latest, true, block.lang === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS) }));
  });
}
