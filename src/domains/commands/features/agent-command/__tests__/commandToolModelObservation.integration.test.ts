import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { ToolCallIdSchema } from 'linnkit/contracts';
import {
  CommandProcessHandleSchema,
  ProcessAgentModelControlV1Schema,
  ProcessOutputCursorSchema,
  ShellAgentModelControlV1Schema,
  type ProcessToolRuntimeResult,
  type ShellToolRuntimeResult,
} from '@app/schemas/commands';

import { resetWorkspaceRootToDefault, setWorkspaceRoot } from 'src/shared/utils/pathManager';
import { truncateObservationToPreview } from 'src/tools/tool_output/toolOutputStore';
import {
  formatProcessToolModelObservation,
  projectProcessToolModelControl,
} from '../functions/projectProcessToolModelControl';
import {
  formatShellToolModelObservation,
  projectShellToolModelControl,
} from '../functions/projectShellToolModelControl';
import { parseCommandToolModelControlLine } from '../functions/commandToolModelObservation';

const PROCESS_HANDLE = CommandProcessHandleSchema.parse(
  'command_process_123e4567-e89b-42d3-a456-426614174000',
);
const PIPE_DISPLAY = {
  mode: 'pipe',
  coverage: 'complete',
  outputPhase: 'open',
  textProjection: 'available',
} as const;
const RUNNING_PRESENTATION = {
  kind: 'command_execution_presentation_facts',
  protocol_version: 1,
  timing: {
    status: 'started',
    started_at_ms: 1_750_000_000_000,
  },
} as const;
const COMPLETED_PRESENTATION = {
  ...RUNNING_PRESENTATION,
  timing: {
    ...RUNNING_PRESENTATION.timing,
    settled_at_ms: 1_750_000_000_500,
  },
} as const;
const CANCELLED_TERMINAL = {
  outcome: 'terminated',
  reason: 'cancelled',
  exitCode: null,
  signal: 'SIGTERM',
} as const;
const COMMAND_OUTPUT_STORE = {
  mode: 'pipe',
  stdout: {
    status: 'published',
    completeness: 'complete',
    blob_id: '0123456789abcdef',
    persisted_characters: 12,
    persisted_lines: 2,
  },
  stderr: { status: 'not_created', reason: 'empty' },
} as const;

describe('command tool model observation', () => {
  it('首行让模型取得 shell running 的 opaque handle/cursor，正文保持稳定纯文本', () => {
    const runtimeResult: ShellToolRuntimeResult = {
      status: 'running',
      processHandle: PROCESS_HANDLE,
      nextCursor: ProcessOutputCursorSchema.parse(7),
      presentation: RUNNING_PRESENTATION,
      display: PIPE_DISPLAY,
      observation: 'stdout:\nstarted',
    };

    const observation = formatShellToolModelObservation(runtimeResult);
    const control = ShellAgentModelControlV1Schema.parse(
      parseCommandToolModelControlLine(observation),
    );

    expect(control).toEqual({
      protocol_version: 1,
      kind: 'shell_model_control',
      status: 'running',
      process_handle: PROCESS_HANDLE,
      next_cursor: 7,
    });
    expect(observation).toContain('\n\noutput:\nstdout:\nstarted');
    expect(observation).not.toContain('display');
  });

  it('让模型区分 shell 完成和拒绝，而不是把无输出当成未知状态', () => {
    const completed: ShellToolRuntimeResult = {
      status: 'completed',
      terminal: { outcome: 'exited', exitCode: 7, signal: null },
      command_output_store: COMMAND_OUTPUT_STORE,
      presentation: COMPLETED_PRESENTATION,
      display: { ...PIPE_DISPLAY, outputPhase: 'closed' },
      observation: '(no output)',
    };
    const rejected: ShellToolRuntimeResult = {
      status: 'rejected',
      code: 'capacity_unavailable',
      observation: 'The command capacity is unavailable.',
    };

    expect(projectShellToolModelControl(completed)).toEqual({
      protocol_version: 1,
      kind: 'shell_model_control',
      status: 'completed',
      terminal: { outcome: 'exited', exitCode: 7, signal: null },
    });
    expect(formatShellToolModelObservation(completed)).toContain(
      'stdout full output: blob_id=0123456789abcdef (reference: tool_output://blobs/0123456789abcdef; 12 characters, 2 lines). Continue with tool_output_read({"blob_id":"0123456789abcdef"}).',
    );
    const rejectedObservation = formatShellToolModelObservation(rejected);
    expect(parseCommandToolModelControlLine(rejectedObservation)).toEqual({
      protocol_version: 1,
      kind: 'shell_model_control',
      status: 'rejected',
      code: 'capacity_unavailable',
    });
    expect(rejectedObservation).toContain(
      '\n\nmessage:\nThe command capacity is unavailable.',
    );
  });

  it('让模型从 process 每类结果保留同一 handle 和下一步控制事实', () => {
    const results: readonly ProcessToolRuntimeResult[] = [
      {
        status: 'running',
        nextCursor: ProcessOutputCursorSchema.parse(11),
        presentation: RUNNING_PRESENTATION,
        display: PIPE_DISPLAY,
        observation: 'stdout:\ntick',
      },
      {
        status: 'completed',
        terminal: CANCELLED_TERMINAL,
        command_output_store: COMMAND_OUTPUT_STORE,
        presentation: COMPLETED_PRESENTATION,
        display: { ...PIPE_DISPLAY, outputPhase: 'closed' },
        observation: 'stdout:\nfinal',
      },
      { status: 'accepted', observation: 'Process interaction accepted.' },
      {
        status: 'rejected',
        code: 'unknown_handle',
        observation: 'Unknown process handle.',
      },
    ];

    const controls = results.map(result => ProcessAgentModelControlV1Schema.parse(
      parseCommandToolModelControlLine(formatProcessToolModelObservation({
        processHandle: PROCESS_HANDLE,
        result,
      })),
    ));

    expect(controls).toEqual([
      {
        protocol_version: 1,
        kind: 'process_model_control',
        process_handle: PROCESS_HANDLE,
        status: 'running',
        next_cursor: 11,
      },
      {
        protocol_version: 1,
        kind: 'process_model_control',
        process_handle: PROCESS_HANDLE,
        status: 'completed',
        terminal: CANCELLED_TERMINAL,
      },
      {
        protocol_version: 1,
        kind: 'process_model_control',
        process_handle: PROCESS_HANDLE,
        status: 'accepted',
      },
      {
        protocol_version: 1,
        kind: 'process_model_control',
        process_handle: PROCESS_HANDLE,
        status: 'rejected',
        code: 'unknown_handle',
      },
    ]);
  });

  it('严格拒绝内部进程、artifact、owner 和 renderer display 字段', () => {
    const publicControl = projectProcessToolModelControl({
      processHandle: PROCESS_HANDLE,
      result: {
        status: 'running',
        nextCursor: ProcessOutputCursorSchema.parse(1),
        presentation: RUNNING_PRESENTATION,
        display: PIPE_DISPLAY,
        observation: 'stdout:\nok',
      },
    });
    const forbiddenFields = {
      pid: 42,
      artifactPath: '/private/command-output/stdout.bin',
      owner_generation_id: 'generation-secret',
      display: PIPE_DISPLAY,
    };

    expect(ProcessAgentModelControlV1Schema.safeParse({
      ...publicControl,
      ...forbiddenFields,
    }).success).toBe(false);
    const serialized = JSON.stringify(publicControl);
    for (const forbidden of ['pid', 'artifactPath', 'owner_generation_id', 'display']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('超长正文经过正式 head/tail 治理后仍保留完整可解析的控制首行', async () => {
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'command-model-control-'));
    setWorkspaceRoot(workspaceRoot);
    try {
      const observation = formatShellToolModelObservation({
        status: 'running',
        processHandle: PROCESS_HANDLE,
        nextCursor: ProcessOutputCursorSchema.parse(23),
        presentation: RUNNING_PRESENTATION,
        display: PIPE_DISPLAY,
        observation: `stdout:\n${'x'.repeat(25_000)}`,
      });
      const truncated = await truncateObservationToPreview({
        context: {
          conversationId: 'conversation_command_model_control',
          turnId: 'turn_command_model_control',
          parentToolCallId: ToolCallIdSchema.parse('call_command_model_control'),
        },
        toolName: 'shell',
        text: observation,
        maxChars: 20_000,
        maxLines: 1_200,
      });

      expect(truncated.truncated).toBe(true);
      expect(parseCommandToolModelControlLine(truncated.preview)).toEqual({
        protocol_version: 1,
        kind: 'shell_model_control',
        status: 'running',
        process_handle: PROCESS_HANDLE,
        next_cursor: 23,
      });
      expect(truncated.preview).toContain('内容已截断');
    } finally {
      resetWorkspaceRootToDefault();
      await fsp.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
