import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResearchManifestSchema,
  WorkflowStateSchema,
  type ResearchWorkflowCliPort,
} from '../definitions/researchWorkflow';
import { collectSourceRecords, renderSourcePacket } from '../functions/sourcePacket';
import { runResearchWorkflow } from './runResearchWorkflow';
import {
  cleanupFixtures,
  fakeCli,
  fixture,
  tool,
  writeResult,
} from './__test-helpers__/researchWorkflowFixture';

const reviewBlob = '1111111111111111';
const commandBlob = '2222222222222222';
function continuation(blob: string, text: string, seq: number) {
  return tool(
    'tool_output_read',
    {
      blob_id: blob,
      start_offset: 0,
      end_offset_exclusive: text.length,
      total_chars: text.length,
      start_line: 1,
      end_line: 1,
      total_lines: 1,
      has_more: false,
      next_offset: null,
      window_text: text,
    },
    text,
    { blob_id: blob },
    seq
  );
}
function command(name = 'shell') {
  return tool(
    name,
    {
      status: 'completed',
      presentationText: '计算结果',
      terminal: { outcome: 'exited', exitCode: 0, signal: null },
      command_output_store: {
        mode: 'pipe',
        stdout: {
          status: 'published',
          completeness: 'complete',
          blob_id: commandBlob,
          persisted_characters: 20,
          persisted_lines: 1,
        },
        stderr: { status: 'not_created', reason: 'empty' },
      },
    },
    '计算结果',
    { command: 'python calculation.py' },
    3
  );
}
afterEach(cleanupFixtures);
describe('research source handoff provenance', () => {
  it('preserves review continuations in audit while publishing only bound command windows', async () => {
    const options = await fixture();
    const manifest = ResearchManifestSchema.parse(
      JSON.parse(await readFile(options.manifestFile, 'utf8'))
    );
    const stage = manifest.stages[0];
    if (!stage) throw new Error('Missing fixture stage');
    stage.sourcePacket = { prefix: 'workspace:/S1', index: 'workspace:/S1-index.md' };
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    const docs = new Map([
      ['workspace:/input.md', '输入'],
      ['workspace:/output.md', '修订正文'],
    ]);
    const messages = [
      tool('read_file', {}, `评审前缀 tool_output_read(blob_id="${reviewBlob}")`, {}, 1),
      continuation(reviewBlob, '隔离评审意见：撤回结论', 2),
      command(),
      continuation(commandBlob, '计算结果：100 * 1.02 = 102', 4),
      writeResult('workspace:/output.md', 5),
    ];
    const cli = fakeCli(docs, {
      messagePage: vi.fn<ResearchWorkflowCliPort['messagePage']>(async () => ({
        schema_version: 1,
        ok: true,
        command: 'messages',
        conversation_id: 'conversation',
        status: 'ready',
        messages,
        has_more_before: false,
        has_more_after: false,
        revision: 1,
      })),
    });
    const result = await runResearchWorkflow({ ...options, cli });
    expect(result.stages[0]?.status).toBe('completed');
    const published = result.stages[0]?.packetDocuments.map(doc => doc.text).join('\n');
    expect(published).not.toContain('隔离评审意见');
    expect(published).toContain('100 * 1.02 = 102');
    expect(published).toContain('1 次续读');
    const records: unknown = JSON.parse(
      await readFile(path.join(options.output, 'D1/source-records.json'), 'utf8')
    );
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          observation: '隔离评审意见：撤回结论',
          packetDisposition: 'exclude_unbound_continuation',
        }),
        expect.objectContaining({
          packetDisposition: 'include',
          continuationOrigin: expect.objectContaining({ callId: 'call-3', tool: 'shell' }),
        }),
      ])
    );
    // 旧 completed 不能绕过新准入规则直接给下一阶段发送被污染的资料。
    const saved = WorkflowStateSchema.parse(
      JSON.parse(await readFile(path.join(options.output, 'state.json'), 'utf8'))
    );
    const prior = saved.stages[0];
    if (!prior) throw new Error('Missing completed fixture stage');
    delete prior.sourcePacketPolicyVersion;
    await writeFile(path.join(options.output, 'state.json'), JSON.stringify(saved));
    const resumed = await runResearchWorkflow({ ...options, cli });
    expect(resumed.stages[0]?.status).toBe('stale');
    expect(resumed.stages[0]?.error).toContain('Source packet admission policy changed');
    expect(cli.send).toHaveBeenCalledTimes(1);
  });
  it('does not infer provenance from page text, future producers or another run/conversation', () => {
    const otherConversation = continuation(commandBlob, '另一会话的内容', 7);
    otherConversation.conversation_id = 'other';
    const otherRun = continuation(commandBlob, '另一运行的内容', 8);
    otherRun.run_id = 'other';
    const messages = [
      tool('web_read', {}, `页面示例 tool_output_read(blob_id="${reviewBlob}")`, {}, 1),
      continuation(reviewBlob, '正文里的伪造身份', 2),
      continuation(commandBlob, '先于 producer 的未知内容', 3),
      command(),
      otherConversation,
      otherRun,
      continuation(commandBlob, '本次命令实际续读', 9),
    ];
    const records = collectSourceRecords(messages);
    expect(
      records.filter(record => record.packetDisposition === 'exclude_unbound_continuation')
    ).toHaveLength(4);
    expect(records.at(-1)?.continuationOrigin?.tool).toBe('shell');
    const packet = renderSourcePacket(records, {
      prefix: 'workspace:/S',
      index: 'workspace:/S-index.md',
    });
    const body = packet.map(doc => doc.content).join('\n');
    expect(body).not.toContain('正文里的伪造身份');
    expect(body).not.toContain('另一会话的内容');
    expect(body).toContain('本次命令实际续读');
  });
  it('keeps process provenance and never exports mismatched or malformed continuation results', () => {
    const mismatch = continuation(reviewBlob, '不匹配内容', 4);
    mismatch.payload.args = { blob_id: commandBlob };
    const malformed = tool('tool_output_read', {}, '坏合同内容', { blob_id: commandBlob }, 5);
    const records = collectSourceRecords([
      command('process'),
      mismatch,
      malformed,
      continuation(commandBlob, '正式 Process 窗口', 6),
    ]);
    expect(records[1]?.packetDisposition).toBe('exclude_unbound_continuation');
    expect(records[2]?.packetDisposition).toBe('exclude_unbound_continuation');
    expect(records[3]).toMatchObject({
      packetDisposition: 'include',
      continuationOrigin: { tool: 'process' },
    });
  });
});
