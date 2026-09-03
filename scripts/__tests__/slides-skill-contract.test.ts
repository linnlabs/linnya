import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  estimateSkillInstructionTokens,
  renderChartPresetsReference,
  runSlidesSkillCheck,
} from '../codegen/slidesSkillContract.js';

describe('Slides Skill guard', () => {
  it('接受仓库中的正式 Skill、可执行示例和 CLI 样例', () => {
    const result = runSlidesSkillCheck();

    if (!result.ok) {
      throw new Error(result.problems
        .map((problem) => `[${problem.kind}] ${problem.path}: ${problem.message}`)
        .join('\n'));
    }

    expect(result.resourceCount).toBeLessThanOrEqual(20);
    expect(result.estimatedInstructionTokens).toBeLessThanOrEqual(5_000);
    expect(result.validatedExamples).toEqual([
      'brush-artwork.js',
      'card-grid.js',
      'chart-analysis.js',
      'complete-deck.js',
      'cover-variants.js',
      'media-and-paint.js',
      'native-formula.js',
      'table.js',
      'timeline.js',
    ]);
    expect(result.validatedCliExamples).toHaveLength(6);
  });

  it('Chart preset reference 由运行时注册表稳定生成并包含 filled radar', () => {
    const reference = renderChartPresetsReference();

    expect(reference).toContain('`radar-filled`');
    expect(reference.match(/^\| `[^`]+` \|/gmu)).toHaveLength(12);
  });

  it('能拦截 live Skill 中重新出现的错误码、不可用入口和模糊资产落盘合同', () => {
    const skillRoot = createMinimalFixture();
    fs.appendFileSync(
      path.join(skillRoot, 'SKILL.md'),
      [
        '',
        '失败时按 errorCode=10 修复，再调用 ppt_export。',
        '网络图片可以下载到任意本地目录。',
        '',
      ].join('\n'),
      'utf-8',
    );

    const result = runSlidesSkillCheck({ skillRoot, skipTypecheck: true });
    const messages = result.problems
      .filter((problem) => problem.kind === 'banned-contract')
      .map((problem) => problem.message);

    expect(messages).toEqual(expect.arrayContaining([
      '模型不可观测的数字 errorCode',
      '未向 Agent 暴露的 ppt_export 工具',
      '会误导 Agent 在 conversation 外落盘的任意本地目录',
    ]));
  });

  it('token 估算同时覆盖中文字符与长英文词', () => {
    expect(estimateSkillInstructionTokens('演示文稿 slides workflow')).toBeGreaterThan(4);
  });
});

function createMinimalFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-skill-'));
  fs.mkdirSync(path.join(root, 'references/examples'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SKILL.md'), [
    '---',
    'name: slides-design',
    'description: Create Slides. Use for slide tasks.',
    '---',
    '',
    '# Fixture',
  ].join('\n'), 'utf-8');
  return root;
}
