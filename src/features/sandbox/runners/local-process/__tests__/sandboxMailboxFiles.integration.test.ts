import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { SandboxRunnerRequest } from '../../../definitions/sandboxRunner.js';
import type { SandboxRunnerEvaluationResult } from '../../../runner-evaluation/definitions/sandboxRunnerEvaluation.js';
import {
  SANDBOX_MAILBOX_REQUEST_MAX_BYTES,
  SANDBOX_MAILBOX_RESULT_MAX_BYTES,
  SandboxMailboxProtocolError,
} from '../definitions/sandboxMailboxProtocol.js';
import {
  publishSandboxRequestMailbox,
  publishSandboxResultMailbox,
  readSandboxRequestMailbox,
  readSandboxResultMailbox,
  resolveSandboxRequestMailboxPath,
  resolveSandboxResultMailboxPath,
} from '../functions/sandboxMailboxFiles.js';

const RUN_TOKEN = '0'.repeat(32);
const MISMATCHED_RUN_TOKEN = '1'.repeat(32);

function createRequest(source = 'return 1;'): SandboxRunnerRequest {
  return {
    runId: 'mailbox-run',
    profileId: 'mailbox-profile',
    language: 'javascript',
    source,
    globals: { title: '中文' },
    bindings: [
      {
        kind: 'capability',
        globalName: 'hostCompose',
        capability: 'host.compose',
      },
    ],
    limits: {
      timeoutMs: 10_000,
      maxLogLines: 200,
      maxLogLineLength: 2_000,
      maxResultBytes: 256 * 1024,
      maxSourceBytes: 128 * 1024,
      maxCapabilityPayloadBytes: 256 * 1024,
      maxHeapMb: 128,
      idleTimeoutMs: 12_000,
    },
    capabilities: [
      {
        name: 'host.compose',
        maxCalls: 1,
        maxBytes: 256 * 1024,
        allowHosts: ['localhost'],
        allowReadPaths: ['input'],
        allowWritePaths: ['output'],
      },
    ],
    telemetry: {
      conversationId: 'conversation-1',
      metadata: { attempt: 1 },
    },
  };
}

function createResult(): SandboxRunnerEvaluationResult {
  return {
    success: true,
    value: { ok: true },
    logs: ['完成'],
    elapsedMs: 12,
    capabilityCalls: [{ name: 'host.compose', payload: { slideCount: 1 } }],
    deniedActions: [],
  };
}

describe('Sandbox mailbox file protocol', () => {
  const roots: string[] = [];

  async function createRunDirectory(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-sandbox-mailbox-'));
    roots.push(root);
    return root;
  }

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it('原子发布并按同一 token 读取完整 request/result 业务合同', async () => {
    const runDirectory = await createRunDirectory();
    const request = createRequest();
    const result = createResult();

    await publishSandboxRequestMailbox({ runDirectory, runToken: RUN_TOKEN, request });
    await publishSandboxResultMailbox({ runDirectory, runToken: RUN_TOKEN, result });

    await expect(readSandboxRequestMailbox({ runDirectory, runToken: RUN_TOKEN })).resolves.toEqual(
      request
    );
    await expect(readSandboxResultMailbox({ runDirectory, runToken: RUN_TOKEN })).resolves.toEqual(
      result
    );
    expect((await readdir(runDirectory)).sort()).toEqual(['request.json', 'result.json']);
  });

  it('发布前执行 2 MiB request 预算且不留下 final 或 staging 文件', async () => {
    const runDirectory = await createRunDirectory();
    const request = createRequest('x'.repeat(SANDBOX_MAILBOX_REQUEST_MAX_BYTES));

    await expect(
      publishSandboxRequestMailbox({ runDirectory, runToken: RUN_TOKEN, request })
    ).rejects.toMatchObject({ code: 'mailbox_envelope_too_large' });
    expect(await readdir(runDirectory)).toEqual([]);
  });

  it('result 使用独立 4 MiB 预算且超限时同样不发布 partial 文件', async () => {
    const runDirectory = await createRunDirectory();
    const result = {
      ...createResult(),
      logs: ['x'.repeat(SANDBOX_MAILBOX_RESULT_MAX_BYTES)],
    };

    await expect(
      publishSandboxResultMailbox({ runDirectory, runToken: RUN_TOKEN, result })
    ).rejects.toMatchObject({ code: 'mailbox_envelope_too_large' });
    expect(await readdir(runDirectory)).toEqual([]);
  });

  it('读取前拒绝超限文件、非普通文件、非法 UTF-8 和 malformed JSON', async () => {
    const oversizedRoot = await createRunDirectory();
    await writeFile(
      resolveSandboxRequestMailboxPath(oversizedRoot),
      Buffer.alloc(SANDBOX_MAILBOX_REQUEST_MAX_BYTES + 1, 0x20)
    );
    await expect(
      readSandboxRequestMailbox({ runDirectory: oversizedRoot, runToken: RUN_TOKEN })
    ).rejects.toMatchObject({ code: 'mailbox_envelope_too_large' });

    const directoryRoot = await createRunDirectory();
    await mkdir(resolveSandboxRequestMailboxPath(directoryRoot));
    await expect(
      readSandboxRequestMailbox({ runDirectory: directoryRoot, runToken: RUN_TOKEN })
    ).rejects.toMatchObject({ code: 'mailbox_file_not_regular' });

    const utf8Root = await createRunDirectory();
    await writeFile(resolveSandboxRequestMailboxPath(utf8Root), Buffer.from([0xc3, 0x28]));
    await expect(
      readSandboxRequestMailbox({ runDirectory: utf8Root, runToken: RUN_TOKEN })
    ).rejects.toMatchObject({ code: 'mailbox_file_invalid_utf8', byteLength: 2 });

    const jsonRoot = await createRunDirectory();
    await writeFile(resolveSandboxRequestMailboxPath(jsonRoot), '{"source":"SECRET_RAW_PAYLOAD"');
    const error = await readSandboxRequestMailbox({
      runDirectory: jsonRoot,
      runToken: RUN_TOKEN,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SandboxMailboxProtocolError);
    expect(error).toMatchObject({ code: 'mailbox_file_malformed_json' });
    expect(String(error)).not.toContain('SECRET_RAW_PAYLOAD');
    expect(String(error)).not.toContain(Buffer.from('SECRET_RAW_PAYLOAD').toString('hex'));
  });

  it('拒绝 stale token 与 strict envelope 之外的字段', async () => {
    const staleRoot = await createRunDirectory();
    await publishSandboxRequestMailbox({
      runDirectory: staleRoot,
      runToken: RUN_TOKEN,
      request: createRequest(),
    });
    await expect(
      readSandboxRequestMailbox({
        runDirectory: staleRoot,
        runToken: MISMATCHED_RUN_TOKEN,
      })
    ).rejects.toMatchObject({ code: 'mailbox_token_mismatch' });

    const extraRoot = await createRunDirectory();
    await writeFile(
      resolveSandboxResultMailboxPath(extraRoot),
      JSON.stringify({
        protocol_version: 1,
        kind: 'sandbox_result',
        run_token: RUN_TOKEN,
        result: createResult(),
        unexpected: true,
      })
    );
    await expect(
      readSandboxResultMailbox({ runDirectory: extraRoot, runToken: RUN_TOKEN })
    ).rejects.toMatchObject({ code: 'invalid_result_envelope' });
  });

  it('同一 mailbox 只允许首次完整发布，重复发布不得覆盖既有结果', async () => {
    const runDirectory = await createRunDirectory();
    const first = createRequest('return "first";');
    const second = createRequest('return "second";');

    await publishSandboxRequestMailbox({ runDirectory, runToken: RUN_TOKEN, request: first });
    await expect(
      publishSandboxRequestMailbox({
        runDirectory,
        runToken: RUN_TOKEN,
        request: second,
      })
    ).rejects.toMatchObject({ code: 'mailbox_publish_failed' });

    await expect(readSandboxRequestMailbox({ runDirectory, runToken: RUN_TOKEN })).resolves.toEqual(
      first
    );
    expect(await readdir(runDirectory)).toEqual(['request.json']);
  });

  it('两个并发发布者竞争时只提交一个完整 request，且不残留 staging 文件', async () => {
    const runDirectory = await createRunDirectory();
    const candidates = [
      createRequest('return "concurrent-a";'),
      createRequest('return "concurrent-b";'),
    ];

    const settlements = await Promise.allSettled(
      candidates.map(request =>
        publishSandboxRequestMailbox({ runDirectory, runToken: RUN_TOKEN, request })
      )
    );
    const winnerIndex = settlements.findIndex(result => result.status === 'fulfilled');

    expect(settlements.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(settlements.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    await expect(readSandboxRequestMailbox({ runDirectory, runToken: RUN_TOKEN })).resolves.toEqual(
      candidates[winnerIndex]
    );
    expect(await readdir(runDirectory)).toEqual(['request.json']);
  });
});
