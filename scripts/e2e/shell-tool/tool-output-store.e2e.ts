import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
  TOOL_OUTPUT_BODY_FILE_NAME,
  TOOL_OUTPUT_MANIFEST_FILE_NAME,
  ToolOutputBlobSourceSchema,
} from '../../../src/tools/tool_output/definitions/toolOutputBlob';
import { createToolOutputTextBlobWriter } from '../../../src/tools/tool_output/orchestration/createToolOutputTextBlobWriter';
import { readToolOutputTextWindow } from '../../../src/tools/tool_output/orchestration/readToolOutputTextWindow';
import { cleanupToolOutputStoreByTime } from '../../../src/tools/tool_output/orchestration/cleanupToolOutputStore';

const runRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-tool-output-e2e-中文 path-'));
const blobsDirectory = path.join(
  runRoot,
  'Artifacts',
  'v1',
  'conversations',
  'conversation-e2e',
  'instances',
  'default',
  'tool_output',
  'blobs',
);
const source = ToolOutputBlobSourceSchema.parse({
  kind: 'tool_output_text',
  conversation_id: 'conversation-e2e',
  instance_id: 'default',
  tool_name: 'shell',
  turn_id: 'turn-e2e',
  tool_call_id: 'tool-call-e2e',
});
let succeeded = false;

try {
  const writer = await createToolOutputTextBlobWriter({ blobsDirectory, source });
  const block = `${'x'.repeat(TOOL_OUTPUT_BLOCK_CHAR_CAPACITY - 2)}🙂`;
  const blockCount = 256;
  const heapBefore = process.memoryUsage().heapUsed;
  let peakHeap = heapBefore;
  for (let index = 0; index < blockCount; index += 1) {
    await writer.append(block);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
  }
  const saved = await writer.finalize();
  assert.deepEqual(await writer.finalize(), saved);
  const blobDirectory = path.dirname(saved.filePath);
  const totalChars = block.length * blockCount;
  assert.equal(
    (await fsp.stat(path.join(blobDirectory, TOOL_OUTPUT_BODY_FILE_NAME))).size,
    totalChars * 2,
  );

  const manifestStatBeforeRead = await fsp.stat(
    path.join(blobDirectory, TOOL_OUTPUT_MANIFEST_FILE_NAME),
  );
  const offset = totalChars - 8_000;
  const window = await readToolOutputTextWindow({
    blobDirectory,
    blobId: saved.blobId,
    conversationId: source.conversation_id,
    instanceId: source.instance_id,
    args: { offset, limit: 9_000 },
  });
  assert.equal(window.windowText, `${'x'.repeat(7_998)}🙂`);
  assert.equal(window.startOffset, offset);
  assert.equal(window.nextOffset, null);
  const manifestStatAfterRead = await fsp.stat(
    path.join(blobDirectory, TOOL_OUTPUT_MANIFEST_FILE_NAME),
  );
  assert.equal(manifestStatAfterRead.mtimeMs, manifestStatBeforeRead.mtimeMs);

  const [left, right] = await Promise.all([
    createToolOutputTextBlobWriter({ blobsDirectory, source: {
      ...source,
      tool_call_id: 'tool-call-concurrent',
    } }),
    createToolOutputTextBlobWriter({ blobsDirectory, source: {
      ...source,
      tool_call_id: 'tool-call-concurrent',
    } }),
  ]);
  await Promise.all([left.append('concurrent🙂'), right.append('concurrent🙂')]);
  const [leftResult, rightResult] = await Promise.all([left.finalize(), right.finalize()]);
  assert.equal(leftResult.blobId, rightResult.blobId);

  const aborted = await createToolOutputTextBlobWriter({ blobsDirectory, source: {
    ...source,
    tool_call_id: 'tool-call-abort',
  } });
  await aborted.append('not published');
  await aborted.abort();
  const manualPending = path.join(blobsDirectory, '.pending-old-generation');
  const manualOrphan = path.join(blobsDirectory, 'eeeeeeeeeeeeeeee');
  await fsp.mkdir(manualPending);
  await fsp.mkdir(manualOrphan);
  await fsp.writeFile(path.join(manualPending, TOOL_OUTPUT_BODY_FILE_NAME), 'pending');
  await fsp.writeFile(path.join(manualOrphan, TOOL_OUTPUT_BODY_FILE_NAME), 'orphan');
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);
  await fsp.utimes(saved.filePath, old, old);
  const cleanup = await cleanupToolOutputStoreByTime({
    logger: { warn(message) { throw new Error(message); } },
    retentionDays: 7,
    workspaceRoot: runRoot,
  });
  assert.deepEqual(cleanup, { scanned: 4, deleted: 3, failed: 0 });
  await assert.rejects(fsp.stat(blobDirectory), { code: 'ENOENT' });
  await assert.rejects(fsp.stat(manualPending), { code: 'ENOENT' });
  await assert.rejects(fsp.stat(manualOrphan), { code: 'ENOENT' });
  await fsp.stat(path.dirname(leftResult.filePath));

  succeeded = true;
  console.log(JSON.stringify({
    status: 'ok',
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cases: 5,
    bodyChars: totalChars,
    peakHeapDeltaBytes: Math.max(0, peakHeap - heapBefore),
  }));
} finally {
  await fsp.rm(runRoot, { recursive: true, force: true });
  if (!succeeded) process.exitCode = 1;
}
