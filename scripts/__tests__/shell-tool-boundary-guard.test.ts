import { describe, expect, it } from 'vitest';

import { analyzeShellToolBoundarySource } from '../guards/shell-tool-boundary-guard';

function ruleIds(file: string, source: string): readonly string[] {
  return analyzeShellToolBoundarySource(file, source).map(violation => violation.ruleId);
}

describe('shell tool high-value boundary guard', () => {
  it.each([
    ['apps/renderer/app/runtime.ts', "import { spawn } from 'node:child_process';"],
    ['src/tools/commands/shell/ShellTool.ts', "const child = require('child_process');"],
    ['src/tools/commands/process/ProcessTool.ts', "const child = await import('node:child_process');"],
  ])('阻止 renderer 与公开 tool 直接创建进程：%s', (file, source) => {
    expect(ruleIds(file, source)).toContain('SHELL-BOUNDARY-01-no-process-spawn-in-ui-or-tool');
  });

  it.each([
    ['electron', "import { app } from 'electron';"],
    [
      'workspace sqlite',
      "export { db } from '../../../features/workspace/infrastructure/sqlite/workspace-schema.provider';",
    ],
  ])('阻止 Commands domain 依赖 %s', (_name, source) => {
    expect(ruleIds('src/domains/commands/features/example/orchestration/run.ts', source))
      .toContain('SHELL-BOUNDARY-02-commands-domain-is-technology-neutral');
  });

  it('阻止 Vue renderer 导入平台 adapter', () => {
    const source = `<script setup lang="ts">
      import { launch } from 'src/infra/adapters/command-runtime/windows';
    </script>`;
    expect(ruleIds('apps/renderer/domains/conversation/CommandCard.vue', source))
      .toContain('SHELL-BOUNDARY-03-no-platform-adapter-in-renderer');
  });

  it.each([
    ['src/tools/commands/legacy.ts', "readonly name = 'plugin_command';"],
    ['src/domains/commands/legacy.ts', 'owner.reserveHosted({ identity });'],
    ['packages/plugin-host-contract/backend/legacy.ts', 'BackendPluginCommandContribution'],
  ])('阻止旧 Plugin Command 生产合同复活：%s', (file, source) => {
    expect(ruleIds(file, source))
      .toContain('SHELL-BOUNDARY-04-no-retired-plugin-command-surface');
  });

  it('允许 tool 依赖公开 runtime contract，允许平台 child adapter 自己使用 child_process', () => {
    expect(ruleIds(
      'src/tools/commands/shell/ShellTool.ts',
      "import type { ShellToolRuntimePort } from 'src/domains/commands';",
    )).toEqual([]);
    expect(ruleIds(
      'src/infra/adapters/command-runtime/macos/launch.ts',
      "import { spawn } from 'node:child_process';",
    )).toEqual([]);
  });

  it('测试和 fixture 不参与生产扫描规则判断，但分析器仍能准确报告传入源码', () => {
    expect(ruleIds(
      'src/tools/commands/shell/__tests__/ShellTool.test.ts',
      "import { spawn } from 'node:child_process';",
    )).toContain('SHELL-BOUNDARY-01-no-process-spawn-in-ui-or-tool');
  });
});
