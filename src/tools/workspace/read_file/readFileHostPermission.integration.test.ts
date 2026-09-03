import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  formatHostFileLocator,
  WorkspaceReadFileResultSchema,
} from '@app/schemas';
import {
  CommandRunPermissionSnapshotV1Schema,
  type CommandPermissionLevel,
} from '@app/schemas/commands';
import { ToolCallIdSchema } from 'linnkit/contracts';
import { createToolContextFixture } from 'linnkit/testkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodePhysicalFileReader } from 'src/app-hosts/linnya/adapters/file-read/createNodePhysicalFileReader';
import { createToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { ReadFileTool } from './ReadFileTool';

describe('read_file host locator 与命令权限边界', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => (
      fsp.rm(root, { recursive: true, force: true })
    )));
  });

  it('三档命令权限读取同一个 conversation 外 UTF-8 文件时得到相同结果', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-read-file-host-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, '外部 报告.md');
    const content = '# 外部报告\n同一只读合同。\n';
    await fsp.writeFile(filePath, content, 'utf8');
    const locator = formatHostFileLocator(filePath);
    const permissionLevels: readonly CommandPermissionLevel[] = [
      'read_only',
      'standard',
      'full_access',
    ];

    const observations: string[] = [];
    const ingestLocalImage = vi.fn(() => Promise.reject(new Error('文本读取不应进入图片 ingress。')));
    const issueClaims = vi.fn(() => []);
    for (const permissionLevel of permissionLevels) {
      const context = createToolContextFixture({
        conversationId: 'conv-host-read',
        turnId: `turn-${permissionLevel}`,
        patch: {
          parentToolCallId: ToolCallIdSchema.parse(`tool-call-${permissionLevel}`),
          physicalFileReader: createNodePhysicalFileReader(),
          managedImageIngress: { ingestLocalImage },
          toolResultAssetClaims: {
            issueClaims,
            consumeClaims: vi.fn(() => []),
            releaseClaims: vi.fn(),
          },
          commandRunPermission: {
            status: 'available' as const,
            snapshot: CommandRunPermissionSnapshotV1Schema.parse({
              protocol_version: 1,
              kind: 'command_run_permission_snapshot',
              root_agent_run_id: `agent-run-${permissionLevel}`,
              settings_revision: 1,
              captured_at_ms: 1,
              permission_level: permissionLevel,
              internal_data_access: 'allowed',
              gui_control: 'denied',
              local_ipc_control: 'denied',
              process_lifecycle: 'terminate_with_run',
            }),
          },
        },
      });

      const result = WorkspaceReadFileResultSchema.parse(JSON.parse(
        await new ReadFileTool().run({ locator }, context),
      ));
      expect(result.data).toMatchObject({
        source_kind: 'host_file',
        locator,
        file_name: '外部 报告.md',
        content_type: 'text/markdown',
        byte_length: Buffer.byteLength(content),
      });
      observations.push(result.observation);
    }

    expect(new Set(observations)).toEqual(new Set([content]));
    expect(ingestLocalImage).not.toHaveBeenCalled();
    expect(issueClaims).not.toHaveBeenCalled();
  });

  it('稳定格式错误码跨过 ToolRuntimePort 后仍对 Agent 可见', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-read-file-error-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, '伪装文本.txt');
    await fsp.writeFile(filePath, '%PDF-1.7\n%%EOF', 'ascii');
    const locator = formatHostFileLocator(filePath);
    const context = createToolContextFixture({
      conversationId: 'conv-host-read-error',
      turnId: 'turn-host-read-error',
      patch: {
        parentToolCallId: ToolCallIdSchema.parse('tool-call-host-read-error'),
        physicalFileReader: createNodePhysicalFileReader(),
        managedImageIngress: {
          ingestLocalImage: vi.fn(() => Promise.reject(new Error('非图片不应进入图片 ingress。'))),
        },
        toolResultAssetClaims: {
          issueClaims: vi.fn(() => []),
          consumeClaims: vi.fn(() => []),
          releaseClaims: vi.fn(),
        },
      },
    });
    const harness = createToolRuntimeHarness([new ReadFileTool()]);

    try {
      const result = await harness.toolRuntime.executeTool('read_file', { locator }, context);
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('[READ_FILE_UNSUPPORTED_FORMAT]'),
      });
    } finally {
      harness.restore();
    }
  });
});
