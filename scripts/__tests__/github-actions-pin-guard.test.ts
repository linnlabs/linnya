import { describe, expect, it } from 'vitest';

import {
  analyzeGitHubWorkflowActionPins,
  runGitHubActionsPinGuard,
} from '../guards/github-actions-pin-guard';

describe('GitHub Actions pin guard', () => {
  it('当前仓库的外部 Action 全部固定到不可变摘要', () => {
    expect(runGitHubActionsPinGuard()).toEqual([]);
  });

  it.each([
    ['major tag', 'actions/checkout@v4'],
    ['branch', 'owner/action@main'],
    ['short SHA', 'owner/action@11d5960'],
    ['动态表达式', 'owner/action@${{ inputs.ref }}'],
  ])('拒绝%s', (_name, reference) => {
    const source = `steps:\n  - uses: ${reference}\n`;
    expect(analyzeGitHubWorkflowActionPins('.github/workflows/test.yml', source)).toEqual([
      expect.objectContaining({
        line: 2,
        reference,
        reason: 'external-action-not-pinned',
      }),
    ]);
  });

  it('允许完整 Action SHA、可复用 workflow SHA 与仓库内相对 Action', () => {
    const sha = '11d5960a326750d5838078e36cf38b85af677262';
    const source = [
      `- uses: actions/checkout@${sha}`,
      `- uses: linnlabs/build/.github/workflows/release.yml@${sha}`,
      '- uses: ./.github/actions/setup',
    ].join('\n');
    expect(analyzeGitHubWorkflowActionPins('.github/workflows/test.yml', source)).toEqual([]);
  });

  it('Docker Action 必须固定到 sha256 digest', () => {
    const digest = 'a'.repeat(64);
    const source = [
      `- uses: docker://alpine:3.22`,
      `- uses: docker://alpine@sha256:${digest}`,
    ].join('\n');
    expect(analyzeGitHubWorkflowActionPins('.github/workflows/test.yml', source)).toEqual([
      expect.objectContaining({
        line: 1,
        reference: 'docker://alpine:3.22',
        reason: 'docker-image-not-pinned',
      }),
    ]);
  });
});
