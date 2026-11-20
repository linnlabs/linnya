import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const AMBIENT = readFileSync(path.join(__dirname, 'pptComposeProfile.ambient.d.ts'), 'utf8');
const SKILL_REFERENCES = path.join(__dirname, '../../../resources/skills/slides-design/references');

/** 取 `interface Name ... { ... }` 的整段声明文本。 */
function declaration(source: string, name: string): string {
  const start = source.search(new RegExp(`(^|\\n)(export )?interface ${name}\\b`));
  if (start < 0) throw new Error(`Expected interface ${name}`);
  const open = source.indexOf('{', start);
  const end = source.indexOf('\n}', open);
  return source.slice(start, end + 2);
}

describe('富文本 run 的作者接口不再有 lineSpacing', () => {
  it('run 样式接口不列出 lineSpacing，文本与公式 run 都使用它', () => {
    expect(declaration(AMBIENT, 'LayoutTextRunStyleInput')).not.toContain('lineSpacing');
    for (const run of ['LayoutPlainTextRun', 'LayoutFormulaTextRun']) {
      expect(declaration(AMBIENT, run)).toContain('style?: LayoutTextRunStyleInput;');
    }
  });

  it('整框与表格单元格的行距写法保持：LayoutTextStyleInput 仍有 lineSpacing，Text.lineHeight 不再指向 run', () => {
    expect(declaration(AMBIENT, 'LayoutTextStyleInput')).toContain('lineSpacing?: LayoutTextLineSpacingInput;');
    expect(declaration(AMBIENT, 'LayoutTextConfig')).toMatch(/\/\*\*[^*]*行高倍数[^*]*\*\/\s+lineHeight\?: number;/);
    expect(AMBIENT).not.toContain('富文本 run 的精确行距');
  });

  it('skill 文档不再教 run.style.lineSpacing，并说明行距是段落属性', () => {
    const syntax = readFileSync(path.join(SKILL_REFERENCES, 'syntax.md'), 'utf8');
    expect(syntax).not.toContain('run.style.lineSpacing');
    expect(syntax).toContain('行距是段落属性');
  });
});
