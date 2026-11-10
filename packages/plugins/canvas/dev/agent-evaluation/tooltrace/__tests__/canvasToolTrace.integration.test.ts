import { describe, expect, it } from 'vitest';
import { parseCanvasToolTrace } from '../index';
import { readCanvasImageReadSequence } from '../functions/readCanvasImageReadSequence';

const scope = {
  conversationId: 'conv',
  rootRunId: 'run',
  documentId: 'doc',
  locators: ['workspace:/T1.canvas'],
};
const audit = {
  schema_version: 1,
  ok: true,
  command: 'audit',
  conversation_id: 'conv',
  requested_run_id: 'run',
  completeness: {
    run_registry: 'complete',
    event_store: 'complete',
    telemetry: 'best_effort',
    telemetry_retention_days: 7,
  },
  runs: [{ run_id: 'run', status: 'completed', started_at: 1, updated_at: 20 }],
};
function message(
  order: number,
  tool: string,
  args: Record<string, unknown>,
  data: unknown,
  runId = 'run'
) {
  return {
    message_id: `message-${order}`,
    conversation_id: 'conv',
    turn_id: 'turn',
    role: 'assistant',
    message_type: 'tool_calls',
    sort_seq: order,
    timestamp: order,
    content: '',
    merge_key: `tool:${order}`,
    presentation: null,
    run_id: runId,
    payload: {
      tool_call_id: `call-${order}`,
      tool_name: tool,
      status: 'success',
      phase: 'complete',
      started_at: order,
      completed_at: order + 1,
      args,
      data,
    },
  };
}
function shell(order: number, command: string, output: unknown) {
  return shellOutputs(order, command, [output]);
}
function shellOutputs(order: number, command: string, outputs: readonly unknown[]) {
  return message(
    order,
    'shell',
    { command },
    {
      status: 'completed',
      presentationText: 'stdout:\n' + outputs.map(output => JSON.stringify(output)).join('\n'),
      display: {
        mode: 'pipe',
        coverage: 'complete',
        outputPhase: 'closed',
        textProjection: 'available',
      },
      terminal: { outcome: 'exited', exitCode: 0 },
      command_output_store: { stdout: { status: 'published', completeness: 'complete' } },
    }
  );
}
function parse(messages: readonly unknown[], auditValue: unknown = audit) {
  return parseCanvasToolTrace({
    scope,
    audit: auditValue,
    pages: [
      {
        sourceFile: 'messages.json',
        value: {
          schema_version: 1,
          ok: true,
          command: 'messages',
          conversation_id: 'conv',
          status: 'ready',
          messages,
          has_more_before: false,
          has_more_after: false,
          revision: 1,
        },
      },
    ],
  });
}
const committed = {
  status: 'committed',
  requestId: 'write-1',
  sequence: 1,
  refs: {},
  results: [],
  diagnostics: [],
};
const literal = (payload: string, command: string) =>
  `cat > ops.json <<'JSON'\n${payload}\nJSON\n${command}`;

describe('trusted Canvas tool trace', () => {
  it('同一shell多目标的无身份check/render不归到目标画布，读Other图片不贡献最终看图序号', () => {
    const check = {
      sequence: 2,
      cardCount: 0,
      edgeCount: 0,
      overlapCount: 0,
      crossingCount: 0,
      overlaps: [],
      crossings: [],
      longEdges: [],
      outliers: [],
      note: 'formal check',
    };
    const render = {
      sequence: 2,
      locator: 'conversation:/Other.png',
      width: 100,
      height: 100,
      format: 'png',
    };
    const facts = parse([
      shellOutputs(
        1,
        'linnya-canvas check workspace:/T1.canvas\nlinnya-canvas check workspace:/Other.canvas\nlinnya-canvas render workspace:/T1.canvas\nlinnya-canvas render workspace:/Other.canvas',
        [
          { ...check, sequence: 1 },
          check,
          { ...render, sequence: 1, locator: 'conversation:/T1-old.png' },
          render,
        ]
      ),
      message(
        2,
        'read_file',
        { locator: render.locator },
        {
          source_kind: 'conversation_file',
          locator: render.locator,
          content_type: 'image/png',
          attachment_status: 'attached',
        }
      ),
    ]);
    expect(facts.needsReview).toBe(true);
    expect(facts.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      'response_target_ambiguous',
      'response_target_ambiguous',
    ]);
    expect(facts.checks).toEqual([]);
    expect(facts.renders).toEqual([]);
    expect(facts.imageReads).toEqual([]);
  });
  it('同目标单次check加单次render仍按类型唯一归属，可接纳实际读图；同类重复响应则待复核', () => {
    const check = {
      sequence: 2,
      cardCount: 0,
      edgeCount: 0,
      overlapCount: 0,
      crossingCount: 0,
      overlaps: [],
      crossings: [],
      longEdges: [],
      outliers: [],
      note: 'formal check',
    };
    const render = {
      sequence: 2,
      locator: 'conversation:/target.png',
      width: 100,
      height: 100,
      format: 'png',
    };
    const command =
      'linnya-canvas check workspace:/T1.canvas\nlinnya-canvas render workspace:/T1.canvas';
    const facts = parse([
      shellOutputs(1, command, [check, render]),
      message(
        2,
        'read_file',
        { locator: render.locator },
        {
          source_kind: 'conversation_file',
          locator: render.locator,
          content_type: 'image/png',
          attachment_status: 'attached',
        }
      ),
    ]);
    expect(facts.needsReview).toBe(false);
    expect(facts.checks).toHaveLength(1);
    expect(facts.renders).toHaveLength(1);
    expect(facts.imageReads).toHaveLength(1);
    const repeated = parse([
      shellOutputs(1, 'linnya-canvas render workspace:/T1.canvas', [
        render,
        { ...render, locator: 'conversation:/extra.png' },
      ]),
    ]);
    expect(repeated.needsReview).toBe(true);
    expect(repeated.renders).toEqual([]);
    const missing = parse([
      shellOutputs(
        1,
        'linnya-canvas render workspace:/T1.canvas\nlinnya-canvas render workspace:/T1.canvas',
        [render]
      ),
    ]);
    expect(missing.needsReview).toBe(true);
    expect(missing.renders).toEqual([]);
  });
  it('separates dry-run corrections, actual writes and stable-ID replay without counting preview as commit', () => {
    const facts = parse([
      shell(
        1,
        literal('bad', 'linnya-canvas apply workspace:/T1.canvas --ops-file ops.json --dry-run'),
        { error: { code: 'invalid_operations', message: 'invalid' } }
      ),
      shell(
        2,
        literal('[]', 'linnya-canvas apply workspace:/T1.canvas --ops-file ops.json --dry-run'),
        { status: 'dry-run', tentative: true, results: [] }
      ),
      shell(
        3,
        'linnya-canvas apply workspace:/T1.canvas --ops-file ops.json --request-id write-1',
        committed
      ),
      shell(
        4,
        'linnya-canvas apply workspace:/T1.canvas --ops-file ops.json --request-id write-1',
        committed
      ),
    ]);
    expect(facts.diagnostics).toEqual([]);
    expect(facts.attempts).toHaveLength(1);
    expect(facts.attempts[0].correction).toBe(false);
    expect(
      facts.dryRuns.map(value => [value.validationAccepted, value.correction, value.outcome])
    ).toEqual([
      [false, false, 'rejected'],
      [true, true, 'previewed'],
    ]);
    expect(facts.commits).toHaveLength(1);
    expect(facts.replays).toHaveLength(1);
  });

  it('records pending as validation accepted without claiming execution, then admits the eventual receipt once', () => {
    const command = 'linnya-canvas arrange workspace:/T1.canvas --request-id write-1';
    const pending = parse([
      shell(1, command, {
        status: 'pending',
        requestId: 'write-1',
        operationCount: 60,
        reason: 'approval',
      }),
    ]);
    expect(pending.attempts[0]).toMatchObject({ outcome: 'pending', validationAccepted: true });
    expect(pending.commits).toEqual([]);
    const complete = parse([
      shell(1, command, {
        status: 'pending',
        requestId: 'write-1',
        operationCount: 60,
        reason: 'approval',
      }),
      shell(2, command, committed),
    ]);
    expect(complete.attempts).toHaveLength(1);
    expect(complete.commits).toHaveLength(1);
  });

  it.each(['attached', 'already_attached'])(
    '%s 只接纳同 run 先 render 后读取相同 locator 的图片，排除未投递结果',
    attachmentStatus => {
      const image = {
        source_kind: 'conversation_file',
        locator: 'conversation:/render.png',
        content_type: 'image/png',
        attachment_status: attachmentStatus,
      };
      const facts = parse([
        message(1, 'read_file', { locator: image.locator }, image),
        shell(2, 'linnya-canvas render workspace:/T1.canvas', {
          sequence: 1,
          locator: image.locator,
          width: 100,
          height: 100,
          format: 'png',
        }),
        message(3, 'read_file', { locator: image.locator }, image, 'runner-run'),
        message(4, 'read_file', { locator: image.locator }, image, 'child-run'),
        message(
          5,
          'read_file',
          { locator: image.locator },
          { ...image, locator: 'conversation:/other.png' }
        ),
        message(6, 'read_file', { locator: image.locator }, {
          ...image,
          attachment_status: 'not_delivered',
        }),
        message(7, 'read_file', { locator: image.locator }, image),
      ], {
        ...audit,
        runs: [...audit.runs, {
          run_id: 'child-run', parent_run_id: 'run', status: 'completed',
          started_at: 1, updated_at: 20,
        }],
      });
      expect(facts.needsReview).toBe(false);
      expect(facts.renders).toHaveLength(1);
      expect(readCanvasImageReadSequence(facts)).toBe(1);
      expect(facts.imageReads).toEqual([
        expect.objectContaining({
          toolCallId: 'call-7',
          renderToolCallId: 'call-2',
          attachmentStatus,
        }),
      ]);
    }
  );

  it('does not execute here-doc text or guess control flow and generic failures', () => {
    const facts = parse([
      shell(
        1,
        literal('linnya-canvas apply workspace:/T1.canvas --request-id fake', 'echo ignored'),
        committed
      ),
      shell(
        2,
        'for x in 1; do\nlinnya-canvas apply workspace:/T1.canvas --request-id loop\ndone',
        committed
      ),
      shell(
        3,
        'linnya-canvas apply workspace:/T1.canvas --ops-file ops.json --request-id unknown',
        { error: { code: 'operation_failed', message: 'unknown boundary' } }
      ),
    ]);
    expect(facts.needsReview).toBe(true);
    expect(facts.attempts).toHaveLength(1);
    expect(facts.attempts[0].validationAccepted).toBeNull();
    expect(facts.commits).toEqual([]);
  });
});
