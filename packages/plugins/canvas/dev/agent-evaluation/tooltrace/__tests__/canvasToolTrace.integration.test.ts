import { describe, expect, it } from 'vitest';
import { parseCanvasToolTrace } from '../index';

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
  return message(
    order,
    'shell',
    { command },
    {
      status: 'completed',
      presentationText: 'stdout:\n' + JSON.stringify(output),
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
function parse(messages: readonly unknown[]) {
  return parseCanvasToolTrace({
    scope,
    audit,
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

  it('counts only the selected model run reading an attached image returned by its earlier render', () => {
    const image = {
      source_kind: 'conversation_file',
      locator: 'conversation:/render.png',
      content_type: 'image/png',
      attachment_status: 'attached',
    };
    const facts = parse([
      shell(1, 'linnya-canvas render workspace:/T1.canvas', {
        sequence: 1,
        locator: image.locator,
        width: 100,
        height: 100,
        format: 'png',
      }),
      message(2, 'read_file', { locator: image.locator }, image, 'runner-run'),
      message(
        3,
        'read_file',
        { locator: image.locator },
        { ...image, locator: 'conversation:/other.png' }
      ),
      message(4, 'read_file', { locator: image.locator }, image),
    ]);
    expect(facts.renders).toHaveLength(1);
    expect(facts.imageReads).toEqual([
      expect.objectContaining({ toolCallId: 'call-4', renderToolCallId: 'call-1' }),
    ]);
  });

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
