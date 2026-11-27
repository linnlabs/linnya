import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { PluginCliToolResultDataSchema, type PluginCliToolResultData } from '@app/schemas';
import { CommandAgentRunIdSchema } from '@app/schemas/commands';
import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createCommandRunPermissionSnapshot } from 'src/domains/commands/features/permission-settings';
import { deriveConversationWorkDirectoryIdentity } from 'src/domains/conversation-files';
import { PluginCliTool } from 'src/tools/commands/plugin_cli';
import type { ToolContext } from 'src/tools/types';
import type { ConversationWorkDirectoryAdmissionPort } from '../../conversation-lifecycle';
import {
  activateDesiredBackendPluginClis,
  clearBackendPluginClisForTests,
  deactivateStaleBackendPluginClis,
} from '../../../plugin-registry/pluginCliInvocationRuntime';
import type { BackendPluginCliRegistration } from '../../../plugin-registry/registry';
import { createPluginCliToolRuntime, type PluginCliToolDiagnosticPort } from '..';

const CONVERSATION_ID = 'conversation-plugin-cli-tool';
const temporaryRoots: string[] = [];

afterEach(async () => {
  await clearBackendPluginClisForTests();
  await Promise.all(temporaryRoots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

async function createConversationRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-plugin-cli-tool-'));
  temporaryRoots.push(root);
  return root;
}

function registerCli(cli: BackendPluginCliContribution): BackendPluginCliRegistration {
  const registration = { pluginId: 'slides', cli };
  activateDesiredBackendPluginClis([registration]);
  return registration;
}

function permissionContext(input: {
  readonly level?: 'read_only' | 'standard' | 'full_access';
  readonly internalDataAccess?: 'allowed' | 'denied';
} = {}) {
  return {
    status: 'available',
    snapshot: createCommandRunPermissionSnapshot({
      settings: {
        schema_version: 1,
        kind: 'command_permission_settings',
        revision: 1,
        permission_level: input.level ?? 'standard',
        internal_data_access: input.internalDataAccess ?? 'allowed',
        gui_control: 'denied',
        local_ipc_control: 'denied',
        process_lifecycle: 'terminate_with_run',
      },
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_plugin_cli_tool'),
      capturedAtMs: 10,
    }),
  } as const;
}

/** 与真实组合根相同：工具 → 工具运行时 → 共用执行核心 → 已启用插件命令。 */
function createHarness(input: {
  readonly conversationRoot: string;
  readonly registration?: BackendPluginCliRegistration;
  readonly permission?: ReturnType<typeof permissionContext>;
  readonly abortSignal?: AbortSignal;
}) {
  const admissions: string[] = [];
  const admission: ConversationWorkDirectoryAdmissionPort = {
    async withAdmission(request, admitted) {
      admissions.push(String(request.conversationId));
      return admitted({
        identity: deriveConversationWorkDirectoryIdentity(CONVERSATION_ID),
        absolutePath: input.conversationRoot,
        status: 'existing',
      });
    },
  };
  const diagnostics: Parameters<PluginCliToolDiagnosticPort['recordUnexpectedFailure']>[0][] = [];
  const internalDataContext = Object.freeze({ databaseService: Object.freeze({ getDb: () => 'workspace-db' }) });
  const runtime = createPluginCliToolRuntime({
    dependencies: {
      resolveCli: pluginId => (input.registration?.pluginId === pluginId ? input.registration : undefined),
      internalDataContext,
      readConversationProjectId: async conversationId => (conversationId === CONVERSATION_ID ? 'project-1' : null),
    },
    conversationAdmission: admission,
    diagnostics: { recordUnexpectedFailure: failure => diagnostics.push(failure) },
    createInvocationId: () => 'invocation-1',
    createCorrelationId: () => 'correlation-1',
  });
  const context: ToolContext = {
    conversationId: CONVERSATION_ID,
    runId: RunIdSchema.parse('run_plugin_cli_tool'),
    parentToolCallId: ToolCallIdSchema.parse('call_plugin_cli_tool'),
    commandRunPermission: input.permission ?? permissionContext(),
    pluginCliToolRuntime: runtime,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  };
  return {
    admissions,
    diagnostics,
    internalDataContext,
    run: (args: Record<string, unknown>) => new PluginCliTool().run(args, context),
  };
}

// 结果必须符合 schemas 里的共享合同：linnya 命令行按同一份合同读取 stdout。
const ToolOutputSchema = z.object({ data: PluginCliToolResultDataSchema, observation: z.string() });

function parseData(output: string): PluginCliToolResultData {
  return ToolOutputSchema.parse(JSON.parse(output)).data;
}

describe('plugin_cli 工具：外部命令行调用已启用插件的命令', () => {
  it('在会话工作目录内执行插件命令，结果只带 conversation: 定位符', async () => {
    const conversationRoot = await createConversationRoot();
    const execute = vi.fn();
    const registration = registerCli({
      prepare(prepareInput) {
        expect(prepareInput.argv).toEqual(['render', '--presentation', 'deck-1']);
        expect(prepareInput.conversationRoot).toBe(conversationRoot);
        expect(prepareInput.invocationId).toBe('call_plugin_cli_tool_cli_invocation-1');
        return {
          status: 'ready',
          plan: {
            access: {
              internalDataAccess: 'required',
              conversationFiles: 'write',
              externalFiles: 'denied',
              network: 'denied',
              guiControl: 'denied',
              localIpcControl: 'denied',
            },
            execute: async context => {
              await execute(context);
              // 插件只拿到 conversationRoot，把产物写在会话目录并回报 conversation: 定位符。
              await fsp.mkdir(path.join(conversationRoot, 'slides-renders'), { recursive: true });
              await fsp.writeFile(path.join(conversationRoot, 'slides-renders', 'slide-01.jpg'), 'jpeg');
              return {
                exitCode: 0,
                stdout: '{"slides":[{"slideNumber":1,"locator":"conversation:/slides-renders/slide-01.jpg"}]}\n',
                stderr: '',
              };
            },
          },
        };
      },
    });
    const harness = createHarness({ conversationRoot, registration });

    const data = parseData(await harness.run({ plugin_id: 'slides', argv: ['render', '--presentation', 'deck-1'] }));

    expect(harness.admissions).toEqual([CONVERSATION_ID]);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: CONVERSATION_ID,
      agentRunId: 'run_plugin_cli_tool',
      projectId: 'project-1',
      hostContext: harness.internalDataContext,
    }));
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty('inference');
    expect(data).toEqual({
      plugin_id: 'slides',
      argv: ['render', '--presentation', 'deck-1'],
      exit_code: 0,
      stdout: '{"slides":[{"slideNumber":1,"locator":"conversation:/slides-renders/slide-01.jpg"}]}\n',
      stderr: '',
    });
    // 本机绝对路径只在后端流转，不进入会落库、会进前端的工具结果。
    expect(JSON.stringify(data)).not.toContain(conversationRoot);
    await expect(fsp.readFile(path.join(conversationRoot, 'slides-renders', 'slide-01.jpg'), 'utf8')).resolves.toBe('jpeg');
  });

  it('内部数据访问关闭时，在打开数据库之前拒绝', async () => {
    const conversationRoot = await createConversationRoot();
    const execute = vi.fn();
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'required',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute,
        },
      }),
    });
    const harness = createHarness({
      conversationRoot,
      registration,
      permission: permissionContext({ internalDataAccess: 'denied' }),
    });

    await expect(harness.run({ plugin_id: 'slides', argv: ['inspect', '--presentation', 'deck-1'] }))
      .rejects.toThrow(/permission_denied .*Internal Linnya data access is disabled for this run/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it('只读档的运行不能执行会写对话文件的命令', async () => {
    const conversationRoot = await createConversationRoot();
    const execute = vi.fn();
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'required',
            conversationFiles: 'write',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute,
        },
      }),
    });
    const harness = createHarness({ conversationRoot, registration, permission: permissionContext({ level: 'read_only' }) });

    await expect(harness.run({ plugin_id: 'slides', argv: ['export', '--presentation', 'deck-1'] }))
      .rejects.toThrow(/requires write access, but this run is read-only/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it('申报了模型操作的命令被拒绝，外部命令行的运行不调用 Linnya 的模型', async () => {
    const conversationRoot = await createConversationRoot();
    const execute = vi.fn();
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'write',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
            hostInference: ['text'],
          },
          execute,
        },
      }),
    });
    const harness = createHarness({ conversationRoot, registration });

    await expect(harness.run({ plugin_id: 'slides', argv: ['summarize'] }))
      .rejects.toThrow(/uses Linnya models/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it('插件命令非零退出时以工具错误返回 stderr；未启用的插件报不可用', async () => {
    const conversationRoot = await createConversationRoot();
    const registration = registerCli({
      prepare: () => ({
        status: 'completed',
        result: { exitCode: 2, stdout: '', stderr: 'slides.cli.invalid_arguments: Unknown command\n' },
      }),
    });
    const harness = createHarness({ conversationRoot, registration });

    await expect(harness.run({ plugin_id: 'slides', argv: ['bogus'] }))
      .rejects.toThrow(/exited with code 2:\nslides\.cli\.invalid_arguments: Unknown command/u);
    await expect(harness.run({ plugin_id: 'canvas', argv: ['--help'] }))
      .rejects.toThrow(/plugin_unavailable .*Plugin CLI is unavailable/u);
  });

  it('未知异常只给关联号，异常正文进宿主诊断', async () => {
    const conversationRoot = await createConversationRoot();
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'none',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute: async () => {
            throw new Error('secret database path /private-data/workspace.sqlite');
          },
        },
      }),
    });
    const harness = createHarness({ conversationRoot, registration });

    const failure = harness.run({ plugin_id: 'slides', argv: ['fonts', 'list'] });
    await expect(failure).rejects.toThrow(/runtime_failure .*Reference: correlation-1/u);
    await expect(failure).rejects.not.toThrow(/secret database path/u);
    expect(harness.diagnostics).toEqual([expect.objectContaining({
      correlationId: 'correlation-1',
      stage: 'execute',
      toolCallId: 'call_plugin_cli_tool',
      pluginId: 'slides',
    })]);
  });

  it('工具调用被停止时取消插件命令', async () => {
    const conversationRoot = await createConversationRoot();
    const abortController = new AbortController();
    const registration = registerCli({
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'none',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute: context => new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true });
            abortController.abort(new Error('run stopped'));
          }),
        },
      }),
    });
    const harness = createHarness({ conversationRoot, registration, abortSignal: abortController.signal });

    await expect(harness.run({ plugin_id: 'slides', argv: ['render', '--presentation', 'deck-1'] }))
      .rejects.toThrow(/cancelled/u);
  });

  it('用户停用插件时：进行中的命令被取消并等它收尾，停用后拒绝新调用，重新启用后恢复', async () => {
    const conversationRoot = await createConversationRoot();
    const executed = vi.fn();
    let markStarted: () => void = () => {};
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    let cleanedUp = false;
    const cli: BackendPluginCliContribution = {
      prepare: () => ({
        status: 'ready',
        plan: {
          access: {
            internalDataAccess: 'none',
            conversationFiles: 'none',
            externalFiles: 'denied',
            network: 'denied',
            guiControl: 'denied',
            localIpcControl: 'denied',
          },
          execute: context => {
            executed();
            if (executed.mock.calls.length > 1) return Promise.resolve({ exitCode: 0, stdout: '{}\n', stderr: '' });
            return new Promise((_resolve, reject) => {
              context.signal.addEventListener('abort', () => {
                // 插件收到取消后先收尾（例如删掉写了一半的导出文件），停用流程要等到这里结束。
                setTimeout(() => {
                  cleanedUp = true;
                  reject(context.signal.reason);
                }, 10);
              }, { once: true });
              markStarted();
            });
          },
        },
      }),
    };
    const registration = registerCli(cli);
    const harness = createHarness({ conversationRoot, registration });

    const running = harness.run({ plugin_id: 'slides', argv: ['export', '--presentation', 'deck-1'] });
    await started;
    await deactivateStaleBackendPluginClis([]);
    expect(cleanedUp).toBe(true);
    await expect(running).rejects.toThrow(/cancelled/u);

    await expect(harness.run({ plugin_id: 'slides', argv: ['export', '--presentation', 'deck-1'] }))
      .rejects.toThrow(/plugin_unavailable/u);
    expect(executed).toHaveBeenCalledTimes(1);

    activateDesiredBackendPluginClis([registration]);
    const output = await harness.run({ plugin_id: 'slides', argv: ['export', '--presentation', 'deck-1'] });
    expect(parseData(output).exit_code).toBe(0);
    expect(executed).toHaveBeenCalledTimes(2);
  });

  it('参数沿用 Shell 桥的上限：插件 ID 与参数格式不合法时在执行前拒绝', async () => {
    const conversationRoot = await createConversationRoot();
    const harness = createHarness({ conversationRoot });

    await expect(harness.run({ plugin_id: 'Slides', argv: [] })).rejects.toThrow(/plugin_cli plugin_id/u);
    await expect(harness.run({ plugin_id: 'slides', argv: ['a\0b'] })).rejects.toThrow(/NUL/u);
    expect(harness.admissions).toEqual([]);
  });
});
