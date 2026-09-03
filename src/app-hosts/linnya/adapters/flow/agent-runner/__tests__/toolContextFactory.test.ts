import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { runtimeKernel } from '@linnlabs/linnkit';
import { DatabaseService } from 'src/electron-main/services/database';
import {
  createRuntimeEventToolContextHostPorts,
  createToolContext,
} from 'src/app-hosts/linnya/adapters/context-injection/toolContextFactory';
import { clearPluginRuntimeStateForTests } from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type { ToolContext } from 'src/tools/types';
import { createToolOutputEvent, RunIdSchema } from '@linnlabs/linnkit/contracts';
import { createCommandRunPermissionSnapshot } from 'src/domains/commands/features/permission-settings';
import { CommandAgentRunIdSchema } from '@app/schemas/commands';
import type { ShellToolRuntimePort } from 'src/app-hosts/linnya/adapters/commands/shell-runtime/definitions';

type PatchedToolContext = ToolContext & {
  customFlag?: unknown;
};

const databaseService = new DatabaseService(':memory:');
const fakeDb = {} as Database.Database;
const getDbSpy = vi.spyOn(databaseService, 'getDb').mockReturnValue(fakeDb);

afterEach(() => {
  clearPluginRuntimeStateForTests();
  getDbSpy.mockClear();
});

function createHostServices() {
  return {
    knowledgeBaseService: {} as never,
    databaseService,
    commandRunPermission: {
      status: 'available',
      snapshot: createCommandRunPermissionSnapshot({
        settings: {
          schema_version: 1,
          kind: 'command_permission_settings',
          revision: 0,
          permission_level: 'standard',
          internal_data_access: 'allowed',
          gui_control: 'denied',
          local_ipc_control: 'denied',
          process_lifecycle: 'terminate_with_run',
        },
        rootAgentRunId: CommandAgentRunIdSchema.parse('run_tool_context_test'),
        capturedAtMs: 1,
      }),
    } as const,
    signal: new AbortController().signal,
  };
}

function createRuntimeHostPorts(conversationId: string, turnId: string) {
  const sequencer = new runtimeKernel.execution.EventSequencer(conversationId, `trace_${turnId}`);
  const eventBus = new runtimeKernel.execution.EventBus(sequencer.getExecutionId());
  const publisher = new runtimeKernel.execution.RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse(turnId),
    lane: 'foreground',
    visibility: 'conversation',
  });
  const registeredChildRunInvoker = { invoke: vi.fn() };
  return {
    eventBus,
    registeredChildRunInvoker,
    hostPorts: createRuntimeEventToolContextHostPorts({
      runtimeEventSink: (event, source) => publisher.publish(event, source),
      conversationId,
      turnId,
      registeredChildRunInvoker,
      subrunTraceHistoryProjector: { project: vi.fn() },
    }),
  };
}

describe('createToolContext', () => {
  it('应把 composition root 提供的 child invoker 原样注入 ToolContext', () => {
    const { hostPorts, registeredChildRunInvoker } = createRuntimeHostPorts(
      'conv_child_port',
      'turn_child_port'
    );
    const context = createToolContext({
      hostServices: createHostServices(),
      hostPorts,
      request: { query: 'child port', model_id: 'model-test', promptKey: 'default' },
      runContext: {
        runId: RunIdSchema.parse('run_child_port'),
        traceId: 'trace_child_port',
        tags: {},
      },
      toolContextPatch: {},
      history: [],
      conversationId: 'conv_child_port',
      turnId: 'turn_child_port',
    });

    expect(context.registeredChildRunInvoker).toBe(registeredChildRunInvoker);
  });

  it('应注入明确区分 working 与 persisted history 的 conversationView', () => {
    const history: RuntimeEvent[] = [
      createToolOutputEvent(
        'evt_1',
        'conv_1',
        'turn_1',
        'knowledge_search',
        'call_1',
        { status: 'success', observation: 'search complete', data: {} }
      ),
    ];
    const { hostPorts } = createRuntimeHostPorts('conv_1', 'turn_1');
    const context = createToolContext({
      hostServices: createHostServices(),
      hostPorts,
      request: {
        query: 'hello',
        promptKey: 'default',
      } as never,
      runContext: {
        runId: RunIdSchema.parse('run_1'),
        traceId: 'trace_1',
        tags: {},
      },
      toolContextPatch: {
        customFlag: true,
      },
      history,
      conversationId: 'conv_1',
      turnId: 'turn_1',
    });

    expect(context.conversationView?.getPersistedHistoryEvents()).toBe(history);
    expect(context.conversationView?.getWorkingHistoryEvents()).toBe(history);
    expect(context.conversationId).toBe('conv_1');
    expect(context.turnId).toBe('turn_1');
    expect((context as PatchedToolContext).customFlag).toBe(true);
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it('toolContextPatch 不得覆盖 runtime-owned capability 与 execution meta', () => {
    const patchedView = {
      getWorkingHistoryEvents: vi.fn(() => ['patched-working']),
      getPersistedHistoryEvents: vi.fn(() => ['patched-persisted']),
    };
    const history: RuntimeEvent[] = [
      createToolOutputEvent(
        'evt_runtime_1',
        'conv_runtime',
        'turn_runtime',
        'knowledge_search',
        'call_runtime_1',
        { status: 'success', observation: 'search complete', data: {} }
      ),
    ];
    const { hostPorts } = createRuntimeHostPorts('conv_runtime', 'turn_runtime');

    const context = createToolContext({
      hostServices: createHostServices(),
      hostPorts,
      request: {
        query: 'hello',
        promptKey: 'default',
      } as never,
      runContext: {
        runId: RunIdSchema.parse('run_runtime'),
        traceId: 'trace_runtime',
        tags: {},
      },
      toolContextPatch: {
        conversationId: 'conv_patch',
        turnId: 'turn_patch',
        conversationView: patchedView,
        customFlag: 'kept',
      },
      history,
      conversationId: 'conv_runtime',
      turnId: 'turn_runtime',
    });

    expect(context.conversationId).toBe('conv_runtime');
    expect(context.turnId).toBe('turn_runtime');
    expect(context.conversationView?.getWorkingHistoryEvents()).toBe(history);
    expect(context.conversationView).not.toBe(patchedView);
    expect(patchedView.getWorkingHistoryEvents).not.toHaveBeenCalled();
    expect((context as PatchedToolContext).customFlag).toBe('kept');
  });

  it('toolContextPatch 不得伪造 host 冻结的命令权限或受控 runtime', () => {
    const { hostPorts } = createRuntimeHostPorts('conv_permission', 'turn_permission');
    const shellToolRuntime: ShellToolRuntimePort = {
      executeShell: vi.fn(),
      executeProcess: vi.fn(),
    };
    const hostServices = {
      ...createHostServices(),
      shellToolRuntime,
    };
    const forgedPermission = {
      status: 'available',
      snapshot: { permission_level: 'full_access' },
    };
    const context = createToolContext({
      hostServices,
      hostPorts,
      request: { query: 'permission', model_id: 'model-test', promptKey: 'default' },
      runContext: {
        runId: RunIdSchema.parse('run_permission'),
        traceId: 'trace_permission',
        tags: {},
      },
      toolContextPatch: {
        commandRunPermission: forgedPermission,
        shellToolRuntime: {
          executeShell: vi.fn(),
          executeProcess: vi.fn(),
        },
      },
      history: [],
      conversationId: 'conv_permission',
      turnId: 'turn_permission',
    });

    expect(context.commandRunPermission).toBe(hostServices.commandRunPermission);
    expect(context.commandRunPermission).not.toBe(forgedPermission);
    expect(context.shellToolRuntime).toBe(shellToolRuntime);
  });
});
