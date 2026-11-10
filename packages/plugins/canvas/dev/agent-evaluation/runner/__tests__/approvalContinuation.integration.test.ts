import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { CanvasCommandSchema, type CanvasSnapshot } from '../../../../src/shared';
import {
  planCanvasCommit,
  type CanvasCommitState,
} from '../../../../src/backend/features/canvasCommit';
import { checkCanvas } from '../../../../src/backend/features/canvasQuery';
import {
  createCanvasAgentFixture,
  evaluateCanvasAgentRun,
  CanvasAgentEvaluationRunSchema,
} from '../../../../scripts/agent-evaluation';
import { draftCanvasEvaluationRun, CanvasToolTraceFactsSchema } from '../../tooltrace';
import {
  continueCanvasApprovalEvaluation,
  collectCanvasEvaluation,
  CanvasEvaluationRunnerStateSchema,
  type EvaluationRunnerPorts,
} from '../index';
import { readRunnerState, writeEvidence } from '../adapters/evidenceFiles';

const receipt = (runId: string, conversationId = 'conv') => ({
  conversation_id: conversationId,
  run_id: runId,
  user_message_id: 'message-' + runId,
  turn_id: 'turn-' + runId,
  execution_id: 'exec-' + runId,
  agent_id: 'default',
  accepted_at: runId === 'first' ? 101 : 301,
});
const empty: CanvasCommitState = {
  sequence: 0,
  maximumRevision: 0,
  nextCard: 1,
  nextEdge: 1,
  elements: [],
  deletedOrigins: {},
};
const user = {
  viewId: 'user',
  source: { kind: 'user', conversationId: null, runId: null },
} as const;
const snapshot = (state: CanvasCommitState): CanvasSnapshot => ({
  documentId: 'doc',
  schemaVersion: 1,
  sequence: state.sequence,
  elements: state.elements.map(row => row.element),
});
function shell(order: number, runId: string, command: string, output: unknown) {
  return {
    message_id: 'm-' + order,
    conversation_id: 'conv',
    turn_id: 'turn-' + runId,
    role: 'assistant',
    message_type: 'tool_calls',
    sort_seq: order + 10,
    timestamp: order,
    content: '',
    merge_key: 'call:' + order,
    presentation: null,
    run_id: runId,
    payload: {
      tool_call_id: 'call-' + order,
      tool_name: 'shell',
      status: 'success',
      phase: 'complete',
      started_at: order,
      completed_at: order + 1,
      args: { command },
      data: {
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
      },
    },
  };
}
async function fixture(taskId: 'T9' | 'T12' = 'T9') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'canvas-approval-continuation-'));
  const initial = planCanvasCommit({
    state: empty,
    operations: createCanvasAgentFixture(taskId).userSeedOperations,
    actor: user,
    origin: 'seed',
    now: 1,
    claims: [],
  });
  const moved =
    taskId === 'T9'
      ? planCanvasCommit({
          state: initial.state,
          actor: user,
          claims: [],
          origin: 'approved',
          now: 2,
          operations: initial.state.elements.map((row, index) =>
            CanvasCommandSchema.parse({
              op: 'update',
              id: row.element.id,
              baseRevision: 1,
              patch: {
                x: (index % 4) * 6000 + (Math.floor(index / 4) % 5) * 280,
                y: Math.floor(index / 20) * 160,
              },
            })
          ),
        })
      : initial;
  const before = snapshot(initial.state),
    after = snapshot(moved.state),
    decision = taskId === 'T9' ? 'allow' : 'deny';
  const state = CanvasEvaluationRunnerStateSchema.parse({
    config: {
      repositoryRoot: '/source',
      sourceRevision: 'a'.repeat(40),
      batchId: 'fixed',
      taskId,
      modelConfigId: 'configured',
      model: { provider: 'synthetic', model: 'test', version: '1' },
      imageCapability: 'no-vision',
      repetition: 1,
      evidenceMode: 'not-applicable',
    },
    projectId: 'project',
    documentId: 'doc',
    documentIds: {},
    phase: 'started',
    connectionFile: 'connection.json',
    startedAt: 100,
    receipt: receipt('first'),
  });
  const scope = {
    sourceRevision: state.config.sourceRevision,
    batchId: 'fixed',
    documentId: 'doc',
    conversationId: 'conv',
    runId: 'first',
  };
  const screenshot = path.join(directory, 'synthetic-ui-observer.txt');
  await writeFile(screenshot, 'Contract fixture only; not real UI evidence');
  const controls = {
      scope,
      approvalShown: true,
      approvalDecision: decision,
      editedCardId: null,
      evidenceFiles: [screenshot],
    },
    controlsFile = path.join(directory, 'controls.json');
  await writeEvidence(directory, 'state.json', state);
  await writeEvidence(directory, 'before.json', before);
  await writeEvidence(directory, 'controls.json', controls);
  await writeFile(path.join(directory, 'prompt.txt'), 'fixed original task');
  const calls: (readonly string[])[] = [];
  let status = 'completed',
    sendConversation = 'conv',
    sendExit = 0;
  const target = `workspace:/${taskId}.canvas`;
  const messages = [
    shell(
      1,
      'first',
      `cat > ops.json <<'JSON'\nbad\nJSON\nlinnya-canvas apply ${target} --ops-file ops.json --dry-run`,
      { error: { code: 'invalid_operations', message: 'invalid fixture' } }
    ),
    shell(
      2,
      'first',
      `cat > ops.json <<'JSON'\n[]\nJSON\nlinnya-canvas apply ${target} --ops-file ops.json --dry-run`,
      { status: 'dry-run', tentative: true, results: [] }
    ),
    shell(3, 'first', `linnya-canvas apply ${target} --ops-file ops.json --request-id proposal`, {
      status: 'pending',
      requestId: 'proposal',
      operationCount: taskId === 'T9' ? 60 : 24,
      reason: 'approval',
    }),
    shell(4, 'unlisted-run', `linnya-canvas check ${target}`, {
      ...checkCanvas(after),
      sequence: 999,
    }),
    shell(5, 'second', `linnya-canvas check ${target}`, checkCanvas(after)),
  ];
  const ports: EvaluationRunnerPorts = {
    verifyRevision: async () => undefined,
    bridge: async input => {
      const value = { snapshot: after };
      await writeEvidence(input.directory, input.label + '.response.json', { ok: true, value });
      return value;
    },
    async cli(input) {
      calls.push(input.args);
      const command = input.args[0],
        runId = input.args[input.args.indexOf('--run') + 1] ?? 'first';
      let value: unknown;
      if (command === 'send')
        value = {
          schema_version: 1,
          ok: true,
          command,
          receipt: receipt('second', sendConversation),
        };
      if (command === 'status')
        value = {
          schema_version: 1,
          ok: true,
          command,
          conversation_id: 'conv',
          run: {
            conversation_id: 'conv',
            run_id: runId,
            turn_id: 'turn',
            execution_id: 'exec',
            agent_id: 'default',
            status,
            started_at: 100,
            updated_at: 400,
            command_approvals: [],
            result_available: true,
          },
        };
      if (command === 'audit')
        value = {
          schema_version: 1,
          ok: true,
          command,
          conversation_id: 'conv',
          requested_run_id: runId,
          completeness: {
            run_registry: 'complete',
            event_store: 'complete',
            telemetry: 'best_effort',
            telemetry_retention_days: 7,
          },
          runs: ['first', 'second', 'unlisted-run'].map(id => ({
            run_id: id,
            status: 'completed',
            started_at: 100,
            updated_at: 400,
          })),
        };
      if (command === 'result')
        value = {
          schema_version: 1,
          ok: true,
          command,
          conversation_id: 'conv',
          run_id: runId,
          outcome: 'completed',
          completed_at: runId === 'first' ? 200 : 400,
          result_status: 'unavailable',
          reason: 'final_answer_missing',
        };
      if (command === 'messages')
        value = {
          schema_version: 1,
          ok: true,
          command,
          conversation_id: 'conv',
          status: 'ready',
          messages,
          has_more_before: false,
          has_more_after: false,
          revision: 1,
        };
      await writeEvidence(input.directory, input.label + '.request.json', { args: input.args });
      await writeEvidence(input.directory, input.label + '.response.json', value);
      return { exitCode: command === 'send' ? sendExit : 0, value };
    },
  };
  return {
    directory,
    state,
    before,
    after,
    controls,
    controlsFile,
    scope,
    calls,
    ports,
    moved,
    setStatus(value: string) {
      status = value;
    },
    setConversation(value: string) {
      sendConversation = value;
    },
    failSend() {
      sendExit = 1;
    },
    rejectFirstWrite() {
      messages.push(
        shell(
          0,
          'first',
          `cat > ops.json <<'JSON'\nbad\nJSON\nlinnya-canvas apply ${target} --ops-file ops.json --request-id first-rejected`,
          {
            error: {
              code: 'invalid_operations',
              message: 'Original rejected write must remain visible',
            },
          }
        )
      );
    },
  };
}
it.each(['T9', 'T12'] as const)(
  '审批任务%s保留首run pending与预检修正，续轮check匹配最终快照，不将UI执行计为第二次模型write',
  async taskId => {
    const f = await fixture(taskId);
    try {
      await continueCanvasApprovalEvaluation({
        directory: f.directory,
        controlsFile: f.controlsFile,
        ports: f.ports,
      });
      const state = await readRunnerState(f.directory);
      expect(state.receipt).toEqual(f.state.receipt);
      expect(state.startedAt).toBe(100);
      expect(state.config).toEqual(f.state.config);
      expect(JSON.parse(await readFile(path.join(f.directory, 'before.json'), 'utf8'))).toEqual(
        f.before
      );
      expect(await readFile(path.join(f.directory, 'prompt.txt'), 'utf8')).toBe(
        'fixed original task'
      );
      expect(f.calls.find(args => args[0] === 'send')).toEqual([
        'send',
        taskId === 'T9' ? '已在画布允许，请继续检查结果。' : '已在画布拒绝，请确认结果。',
        '--conversation',
        'conv',
        '--project',
        'project',
        '--model',
        'configured',
        '--reasoning',
        'high',
      ]);
      await expect(
        continueCanvasApprovalEvaluation({
          directory: f.directory,
          controlsFile: f.controlsFile,
          ports: f.ports,
        })
      ).rejects.toThrow('already confirmed');
      const collection = await collectCanvasEvaluation({
        directory: f.directory,
        label: 'final',
        ports: f.ports,
      });
      expect(collection).toMatchObject({
        runId: 'first',
        continuationRunIds: ['second'],
        evidenceComplete: true,
      });
      const receiptFile = path.join(f.directory, 'ui-commit-witness.json');
      if (taskId === 'T9')
        await writeEvidence(f.directory, 'ui-commit-witness.json', {
          scope: f.scope,
          projectId: 'project',
          documentPath: `workspace:/${taskId}.canvas`,
          reader: {
            cliEntry: '/synthetic/cli.cjs',
            sha256: 'b'.repeat(64),
            hostAppRoot: '/source',
          },
          complete: true,
          queries: [
            {
              requestId: 'proposal',
              exitCode: 0,
              responseFile: receiptFile,
              failure: null,
              response: {
                documentId: `workspace:/${taskId}.canvas`,
                receipt: {
                  requestId: 'proposal',
                  status: 'committed',
                  pendingId: null,
                  commit: {
                    documentId: `workspace:/${taskId}.canvas`,
                    requestId: 'proposal',
                    sequence: f.after.sequence,
                    refs: {},
                    results: f.moved.results,
                  },
                },
              },
            },
          ],
          evidenceFiles: [receiptFile],
        });
      const result = await draftCanvasEvaluationRun({
        request: {
          runDirectory: f.directory,
          collectionLabel: 'final',
          ...(taskId === 'T9' ? { receiptWitnessFile: receiptFile } : {}),
        },
        outputDirectory: path.join(f.directory, 'draft'),
      });
      expect(result.kind).toBe('ready-for-review');
      const run = CanvasAgentEvaluationRunSchema.parse(
        JSON.parse(await readFile(path.join(f.directory, 'draft/run.json'), 'utf8'))
      );
      expect(run.startedAt).toBe(100);
      expect(run.finishedAt).toBe(400);
      expect(run.check.sequence).toBe(f.after.sequence);
      expect(run.attempts.map((value: { phase: string }) => value.phase)).toEqual([
        'dry-run',
        'dry-run',
        'write',
      ]);
      expect(run.attempts[run.attempts.length - 1]).toMatchObject({
        requestId: 'proposal',
        validationAccepted: true,
        correction: false,
      });
      expect(run.review).toBeUndefined();
      expect(run.metrics).toEqual({});
      expect(evaluateCanvasAgentRun(run)).toMatchObject({
        firstSubmissionAccepted: true,
        correctionRetries: 1,
        status: 'needs_review',
      });
      expect(run.commits).toHaveLength(taskId === 'T9' ? 1 : 0);
      const facts = CanvasToolTraceFactsSchema.parse(
        JSON.parse(await readFile(path.join(f.directory, 'draft/trace.json'), 'utf8'))
      );
      expect(
        facts.checks.map((value: { report: { sequence: number } }) => value.report.sequence)
      ).toEqual([f.after.sequence]);
      expect(facts.attempts[0].outcome).toBe('pending');
      await expect(
        readFile(path.join(f.directory, 'final/result.response.json'))
      ).resolves.toBeDefined();
      await expect(
        readFile(path.join(f.directory, 'final/continuation-1-result.response.json'))
      ).resolves.toBeDefined();
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  }
);
it('无真实UI见证、错scope/decision以及失败run均不能通知或当失败重试', async () => {
  const f = await fixture();
  try {
    await expect(
      continueCanvasApprovalEvaluation({
        directory: f.directory,
        controlsFile: path.join(f.directory, 'missing.json'),
        ports: f.ports,
      })
    ).rejects.toMatchObject({ code: 'ENOENT' });
    for (const [index, controls] of [
      { ...f.controls, approvalShown: false },
      { ...f.controls, approvalDecision: 'deny' },
      { ...f.controls, scope: { ...f.scope, runId: 'other' } },
    ].entries()) {
      const file = path.join(f.directory, 'bad-' + index + '.json');
      await writeFile(file, JSON.stringify(controls));
      await expect(
        continueCanvasApprovalEvaluation({
          directory: f.directory,
          controlsFile: file,
          ports: f.ports,
        })
      ).rejects.toThrow();
    }
    expect(f.calls).toEqual([]);
    f.setStatus('failed');
    await expect(
      continueCanvasApprovalEvaluation({
        directory: f.directory,
        controlsFile: f.controlsFile,
        ports: f.ports,
      })
    ).rejects.toThrow('failed or active');
    expect(f.calls.some(args => args[0] === 'send')).toBe(false);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
it('审批续轮不能把首次正式write拒绝洗成成功，首次失败和本run后续修正仍共同保留', async () => {
  const f = await fixture('T12');
  try {
    f.rejectFirstWrite();
    await continueCanvasApprovalEvaluation({
      directory: f.directory,
      controlsFile: f.controlsFile,
      ports: f.ports,
    });
    const collection = await collectCanvasEvaluation({
      directory: f.directory,
      label: 'final',
      ports: f.ports,
    });
    expect(collection.evidenceComplete).toBe(true);
    const result = await draftCanvasEvaluationRun({
      request: { runDirectory: f.directory, collectionLabel: 'final' },
      outputDirectory: path.join(f.directory, 'draft'),
    });
    expect(result.kind).toBe('ready-for-review');
    const run = CanvasAgentEvaluationRunSchema.parse(
      JSON.parse(await readFile(path.join(f.directory, 'draft/run.json'), 'utf8'))
    );
    expect(
      run.attempts
        .filter(attempt => attempt.phase === 'write')
        .map(attempt => [attempt.requestId, attempt.validationAccepted])
    ).toEqual([
      ['first-rejected', false],
      ['proposal', true],
    ]);
    expect(evaluateCanvasAgentRun(run)).toMatchObject({
      firstSubmissionAccepted: false,
      correctionRetries: 1,
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
it('running时的只读预检不占用发送身份，completed后仍可合法通知一次', async () => {
  const f = await fixture();
  try {
    f.setStatus('running');
    await expect(
      continueCanvasApprovalEvaluation({
        directory: f.directory,
        controlsFile: f.controlsFile,
        ports: f.ports,
      })
    ).rejects.toThrow('failed or active');
    expect(f.calls.filter(args => args[0] === 'send')).toEqual([]);
    f.setStatus('completed');
    await continueCanvasApprovalEvaluation({
      directory: f.directory,
      controlsFile: f.controlsFile,
      ports: f.ports,
    });
    expect(f.calls.filter(args => args[0] === 'send')).toHaveLength(1);
    expect((await readRunnerState(f.directory)).receipt).toEqual(f.state.receipt);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
it.each(['unknown', 'wrong-conversation'])(
  '续轮%s响应保留原件、不覆盖首receipt、不允许再次发送',
  async mode => {
    const f = await fixture();
    try {
      if (mode === 'unknown') f.failSend();
      else f.setConversation('other');
      await expect(
        continueCanvasApprovalEvaluation({
          directory: f.directory,
          controlsFile: f.controlsFile,
          ports: f.ports,
        })
      ).rejects.toThrow(mode === 'unknown' ? 'not confirmed' : 'original conversation');
      expect((await readRunnerState(f.directory)).receipt).toEqual(f.state.receipt);
      expect((await readRunnerState(f.directory)).continuations).toBeUndefined();
      await expect(
        continueCanvasApprovalEvaluation({
          directory: f.directory,
          controlsFile: f.controlsFile,
          ports: f.ports,
        })
      ).rejects.toMatchObject({ code: 'EEXIST' });
      expect(f.calls.filter(args => args[0] === 'send')).toHaveLength(1);
      await expect(
        readFile(path.join(f.directory, 'approval-continuation/send.response.json'))
      ).resolves.toBeDefined();
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  }
);
