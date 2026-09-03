import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('conversation subrun invocation boundary', () => {
  it('公共契约不得泄漏 task/forced-tool 宿主协议', () => {
    const publicFiles = [
      join(repoRoot, 'packages/plugin-host-contract/renderer/conversationSubrunInvocationPort.ts'),
      join(repoRoot, 'src/plugin-sdk/renderer/conversationSubrunInvocationPort.ts'),
    ];
    const forbidden = /\btask(?:_batch|Batch|Feature|Run|s)?\b|hostToolCall|tool_name|SYSTEM_BATCH_SUMMARIZER/;
    const offenders = publicFiles.filter(filePath => forbidden.test(readFileSync(filePath, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('forced batch 翻译只存在于 app-level subrun workflow', () => {
    const source = readFileSync(
      join(repoRoot, 'apps/renderer/app/workflows/conversation-subruns/orchestration/createConversationSubrunInvocationPort.ts'),
      'utf8',
    );
    expect(source).toContain("tool_name: 'subrun_batch'");
    expect(source).toContain('PromptKeys.SYSTEM_BATCH_SUMMARIZER');
  });
});
