import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseCanvasToolTrace, collectCanvasReceiptWitness } from '../index';
import { admitCanvasReceiptWitness } from '../functions/admitCanvasReceiptWitness';
import {
  CanvasReceiptWitnessSchema,
  type CanvasReceiptReaderRequest,
} from '../definitions/canvasReceiptWitness';
import { writeTraceJson } from '../adapters/traceFiles';

const scope = {
  sourceRevision: 'a'.repeat(40),
  batchId: 'fixed',
  documentId: 'doc',
  conversationId: 'conv',
  runId: 'run',
};
const documentPath = 'workspace:/T1.canvas';
function sources(
  command = `linnya-canvas apply ${documentPath} --ops-file ops.json --request-id actual | python summarize.py`,
  runId = 'run'
) {
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
  const page = {
    schema_version: 1,
    ok: true,
    command: 'messages',
    conversation_id: 'conv',
    status: 'ready',
    has_more_before: false,
    has_more_after: false,
    revision: 1,
    messages: [
      {
        message_id: 'message',
        conversation_id: 'conv',
        turn_id: 'turn',
        role: 'assistant',
        message_type: 'tool_calls',
        sort_seq: 1,
        timestamp: 1,
        content: '',
        merge_key: 'tool:1',
        presentation: null,
        run_id: runId,
        payload: {
          tool_call_id: 'call',
          tool_name: 'shell',
          status: 'success',
          phase: 'complete',
          started_at: 1,
          completed_at: 2,
          args: { command },
          data: {},
        },
      },
    ],
  };
  const facts = parseCanvasToolTrace({
    scope: {
      conversationId: 'conv',
      rootRunId: 'run',
      documentId: 'doc',
      locators: [documentPath],
    },
    audit,
    pages: [{ sourceFile: 'messages.json', value: page }],
  });
  return { audit, page, facts };
}
function response(requestId = 'actual') {
  return {
    documentId: documentPath,
    receipt: {
      requestId,
      status: 'committed',
      pendingId: null,
      commit: {
        documentId: documentPath,
        requestId,
        sequence: 1,
        refs: {},
        results: [
          {
            index: 0,
            id: 'c1',
            status: 'applied',
            reason: 'partial_fields_skipped',
            fieldResults: [
              { field: 'color', status: 'applied', reason: null },
              { field: 'data', status: 'skipped', reason: 'user_editing' },
            ],
          },
        ],
      },
    },
  };
}
function witness() {
  return CanvasReceiptWitnessSchema.parse({
    scope,
    projectId: 'project',
    documentPath,
    reader: { cliEntry: '/artifact/cli.cjs', sha256: 'b'.repeat(64), hostAppRoot: '/source' },
    complete: true,
    queries: [
      {
        requestId: 'actual',
        exitCode: 0,
        responseFile: '/receipt.json',
        response: response(),
        failure: null,
      },
    ],
    evidenceFiles: ['/receipt.json'],
  });
}
it('只用本run字面请求补权威commit，过滤输出的未知attempt/correction仍保留，不将查询算重放', () => {
  const facts = sources().facts,
    value = witness();
  expect(facts.requests).toEqual([
    expect.objectContaining({ requestId: 'actual', runId: 'run', toolCallId: 'call' }),
  ]);
  const joined = admitCanvasReceiptWitness({ value, facts, scope, projectId: 'project' });
  expect(joined.facts.commits).toHaveLength(1);
  expect(joined.facts.commits[0]).toMatchObject({
    documentId: 'doc',
    results: [
      {
        reason: 'partial_fields_skipped',
        fieldResults: [{ field: 'color' }, { field: 'data', reason: 'user_editing' }],
      },
    ],
  });
  expect(joined.facts.attempts).toEqual([]);
  expect(joined.facts.dryRuns).toEqual([]);
  expect(joined.facts.replays).toEqual([]);
  expect(joined.facts.needsReview).toBe(true);
  expect(joined.facts.diagnostics).toEqual(facts.diagnostics);
  expect(
    admitCanvasReceiptWitness({ value, facts: joined.facts, scope, projectId: 'project' }).facts
      .commits
  ).toHaveLength(1);
  expect(facts.commits).toEqual([]);
});
it('拒绝跨run/文档/项目及无字面编号的回执，不把同会话另一run算成本次写入', () => {
  const facts = sources().facts,
    value = witness();
  expect(() =>
    admitCanvasReceiptWitness({
      value: { ...value, scope: { ...scope, runId: 'other' } },
      facts,
      scope,
      projectId: 'project',
    })
  ).toThrow('another evaluation');
  expect(() => admitCanvasReceiptWitness({ value, facts, scope, projectId: 'other' })).toThrow(
    'another evaluation'
  );
  expect(() =>
    admitCanvasReceiptWitness({
      value,
      facts: sources(undefined, 'other').facts,
      scope,
      projectId: 'project',
    })
  ).toThrow('no literal identity');
  const other = response();
  other.documentId = 'workspace:/Other.canvas';
  expect(() =>
    admitCanvasReceiptWitness({
      value: { ...value, queries: [{ ...value.queries[0], response: other }] },
      facts,
      scope,
      projectId: 'project',
    })
  ).toThrow('another document');
  for (const command of [
    `echo 'linnya-canvas apply ${documentPath} --request-id actual'`,
    `cat > ops.json <<'EOF'\nlinnya-canvas apply ${documentPath} --request-id actual\nEOF`,
    `for x in 1; do\nlinnya-canvas apply ${documentPath} --request-id actual\ndone`,
    `example() {\nlinnya-canvas apply ${documentPath} --request-id actual\n}`,
    `linnya-canvas apply ${documentPath} --request-id $ID`,
    `linnya-canvas apply ${documentPath} --request-id actual --dry-run`,
  ])
    expect(sources(command).facts.requests).toEqual([]);
});
it('pending/null/缺失协议不伪造执行或失败attempt，旧回执缺字段结果保持未知', () => {
  const facts = sources().facts,
    value = witness(),
    pending = response();
  pending.receipt.status = 'pending';
  expect(
    admitCanvasReceiptWitness({
      value: {
        ...value,
        queries: [
          {
            ...value.queries[0],
            response: { ...pending, receipt: { ...pending.receipt, commit: null } },
          },
        ],
      },
      facts,
      scope,
      projectId: 'project',
    }).facts.commits
  ).toEqual([]);
  const unavailable = admitCanvasReceiptWitness({
    value: {
      ...value,
      complete: false,
      queries: [{ ...value.queries[0], response: null, failure: 'invalid_response' }],
    },
    facts,
    scope,
    projectId: 'project',
  });
  expect(unavailable.facts.diagnostics.map(diagnostic => diagnostic.code)).toContain(
    'receipt_query_unavailable'
  );
  expect(unavailable.facts.attempts).toEqual([]);
  const old = response();
  old.receipt.commit.results = [];
  const admitted = admitCanvasReceiptWitness({
    value: {
      ...value,
      queries: [
        {
          ...value.queries[0],
          response: {
            ...old,
            receipt: {
              ...old.receipt,
              commit: {
                ...old.receipt.commit,
                results: [{ index: 0, id: 'c1', status: 'skipped', reason: 'stale_field' }],
              },
            },
          },
        },
      ],
    },
    facts,
    scope,
    projectId: 'project',
  });
  expect(admitted.facts.commits[0].results[0].fieldResults).toBeUndefined();
});
it('collector从正式原件验证run归属，以固定只读参数查询并保存失败原件；已有目录拒绝覆盖', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-receipt-witness-'));
  try {
    const directory = path.join(root, 'run'),
      artifactRoot = path.join(root, 'artifact'),
      collectionDirectory = path.join(directory, 'final');
    await mkdir(collectionDirectory, { recursive: true });
    await mkdir(path.join(artifactRoot, 'dist/cli'), { recursive: true });
    await writeFile(path.join(artifactRoot, 'dist/cli/canvas-cli.cjs'), 'fixture cli');
    const state = {
      config: {
        repositoryRoot: '/source',
        sourceRevision: scope.sourceRevision,
        batchId: scope.batchId,
        taskId: 'T1',
        modelConfigId: 'configured',
        model: { provider: 'fixture', model: 'fixture', version: 'fixture' },
        imageCapability: 'no-vision',
        repetition: 1,
        evidenceMode: 'not-applicable',
      },
      projectId: 'project',
      documentId: 'doc',
      documentIds: {},
      phase: 'started',
      receipt: {
        conversation_id: 'conv',
        run_id: 'run',
        user_message_id: 'message',
        turn_id: 'turn',
        execution_id: 'exec',
        agent_id: 'default',
        accepted_at: 1,
      },
    };
    const source = sources();
    await Promise.all([
      writeTraceJson(path.join(directory, 'state.json'), state),
      writeTraceJson(path.join(collectionDirectory, 'collection.json'), {
        ...scope,
        taskId: 'T1',
        collectedAt: 20,
        errors: [],
        sourceValid: true,
        messagesComplete: true,
        evidenceComplete: true,
        scoring: 'not-performed',
        manualActions: null,
        documentId: undefined,
      }),
      writeTraceJson(path.join(collectionDirectory, 'messages-index.json'), {
        complete: true,
        files: ['messages-1.response.json'],
      }),
      writeTraceJson(path.join(collectionDirectory, 'messages-1.response.json'), source.page),
      writeTraceJson(path.join(collectionDirectory, 'audit.response.json'), source.audit),
    ]);
    const calls: CanvasReceiptReaderRequest[] = [];
    const reader = {
      async read(input: { request: CanvasReceiptReaderRequest; directory: string; label: string }) {
        calls.push(input.request);
        const file = path.join(input.directory, input.label + '.response.json');
        await writeTraceJson(file, response());
        return { exitCode: 0, value: response(), evidenceFiles: [file], responseFile: file };
      },
    };
    const request = {
        runDirectory: directory,
        collectionLabel: 'final',
        artifactRoot,
        databasePath: path.join(root, 'explicit.sqlite'),
        requestIds: ['actual', 'actual'],
      },
      outputDirectory = path.join(root, 'witness');
    const result = await collectCanvasReceiptWitness({ request, outputDirectory, reader });
    expect(result).toMatchObject({ complete: true, queries: 1 });
    expect(calls).toEqual([
      expect.objectContaining({
        documentPath,
        projectId: 'project',
        conversationId: 'conv',
        requestId: 'actual',
        databasePath: request.databasePath,
      }),
    ]);
    const value = CanvasReceiptWitnessSchema.parse(JSON.parse(await readFile(result.file, 'utf8')));
    expect(value.queries[0].response?.receipt?.commit?.results[0].fieldResults).toHaveLength(2);
    await expect(
      collectCanvasReceiptWitness({ request, outputDirectory, reader })
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(
      collectCanvasReceiptWitness({
        request: { ...request, requestIds: ['unproven'] },
        outputDirectory: path.join(root, 'unproven'),
        reader,
      })
    ).rejects.toThrow('no literal identity');
    expect(calls).toHaveLength(1);
    const failed = await collectCanvasReceiptWitness({
      request,
      outputDirectory: path.join(root, 'failed'),
      reader: {
        async read(input) {
          const file = path.join(input.directory, 'failed.stderr.txt');
          await writeFile(file, 'native process failure', { flag: 'wx', mode: 0o600 });
          return { exitCode: 9, value: undefined, responseFile: null, evidenceFiles: [file] };
        },
      },
    });
    const failure = CanvasReceiptWitnessSchema.parse(
      JSON.parse(await readFile(failed.file, 'utf8'))
    );
    expect(failed.complete).toBe(false);
    expect(failure.queries).toMatchObject([
      { requestId: 'actual', exitCode: 9, failure: 'process_failed', response: null },
    ]);
    expect(
      await readFile(
        failure.evidenceFiles.find(file => file.endsWith('failed.stderr.txt')) ?? '',
        'utf8'
      )
    ).toBe('native process failure');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
