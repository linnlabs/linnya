import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceReadFileEventDataSchema, buildDocumentView } from '@app/schemas';
import {
  ResearchManifestSchema,
  type ResearchWorkflowCliPort,
} from '../definitions/researchWorkflow';
import { runResearchWorkflow } from './runResearchWorkflow';
import { readProjection } from './readProjection';
import { collectSourceRecords, renderSourcePacket } from '../functions/sourcePacket';
import { collectMessages } from './collectStage';
import { auditScope } from '../functions/workflowFacts';
import {
  cleanupFixtures,
  fakeCli,
  fixture,
  status,
  textRead,
  tool,
  writeResult,
} from './__test-helpers__/researchWorkflowFixture';

afterEach(cleanupFixtures);

describe('research workflow through formal CLI port', () => {
  it('selects the stage agent and refuses to resend if that frozen choice changes', async () => {
    const options = await fixture();
    const manifest = ResearchManifestSchema.parse(
      JSON.parse(await readFile(options.manifestFile, 'utf8'))
    );
    manifest.stages[0].agentId = 'deep_research_experimental';
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    const cli = fakeCli(
      new Map([
        ['workspace:/input.md', '依据'],
        ['workspace:/output.md', '成稿'],
      ])
    );
    await runResearchWorkflow({ ...options, cli });
    expect(cli.send).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'deep_research_experimental' })
    );
    expect(cli.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining('使用 Default Agent'),
      })
    );
    manifest.stages[0].agentId = 'default';
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe('stale');
    expect(cli.send).toHaveBeenCalledTimes(1);
  });

  it('freezes current input/output, runs once, and invalidates changed input instead of resending', async () => {
    const options = await fixture();
    const docs = new Map([
      ['workspace:/input.md', '依据'],
      ['workspace:/output.md', '修订后正文'],
    ]);
    const cli = fakeCli(docs);
    const first = await runResearchWorkflow({ ...options, cli });
    expect(first.stages[0]).toMatchObject({
      status: 'completed',
      semanticQuality: 'not_evaluated',
      outputs: [{ hanCharacters: 5 }],
    });
    await runResearchWorkflow({ ...options, cli });
    expect(cli.send).toHaveBeenCalledTimes(1);
    expect(cli.send).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'default' }));
    docs.set('workspace:/input.md', '新依据');
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe('stale');
    expect(cli.send).toHaveBeenCalledTimes(1);
  });
  it('unknown send admission persists and cannot resend on the same output', async () => {
    const options = await fixture();
    const cli = fakeCli(new Map([['workspace:/input.md', '依据']]), {
      send: vi.fn<ResearchWorkflowCliPort['send']>(async () => {
        throw new Error('connection lost after admission');
      }),
    });
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe(
      'admission_unknown'
    );
    await runResearchWorkflow({ ...options, cli });
    expect(cli.send).toHaveBeenCalledTimes(1);
  });
  it('missing output is collection failure, never a new author run', async () => {
    const options = await fixture();
    const cli = fakeCli(new Map([['workspace:/input.md', '依据']]));
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe(
      'collection_failed'
    );
    await runResearchWorkflow({ ...options, cli });
    expect(cli.send).toHaveBeenCalledTimes(1);
  });
  it('paused run needs explicit resume; a watch timeout never stops or starts another run', async () => {
    const options = await fixture();
    let current = status('paused');
    const cli = fakeCli(
      new Map([
        ['workspace:/input.md', '依据'],
        ['workspace:/output.md', '完成'],
      ]),
      {
        status: vi.fn<ResearchWorkflowCliPort['status']>(async () => current),
        resume: vi.fn<ResearchWorkflowCliPort['resume']>(async () => {
          current = status('running', 'execution-2');
          return {
            schema_version: 1,
            ok: true,
            command: 'resume',
            receipt: {
              conversation_id: 'conversation',
              run_id: 'run',
              turn_id: 'turn',
              execution_id: 'execution-2',
              agent_id: 'default',
              accepted_at: 2,
            },
          };
        }),
        watchStatus: vi.fn<ResearchWorkflowCliPort['watchStatus']>(async () => {
          current = status('completed', 'execution-2');
          return { frames: [], timedOut: true };
        }),
      }
    );
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe('paused');
    expect(cli.resume).not.toHaveBeenCalled();
    expect(
      (await runResearchWorkflow({ ...options, cli, resumeStage: 'D1' })).stages[0]?.status
    ).toBe('completed');
    expect(cli.resume).toHaveBeenCalledTimes(1);
    expect(cli.send).toHaveBeenCalledTimes(1);
    expect(cli.stop).not.toHaveBeenCalled();
  });
  it('does not accept completed status with a conflicting terminal result as a complete delivery', async () => {
    const options = await fixture();
    const cli = fakeCli(new Map([['workspace:/input.md', '输入']]), {
      result: vi.fn<ResearchWorkflowCliPort['result']>(async () => ({
        outcome: 'cancelled',
        completedAt: 3,
        resultStatus: 'unavailable',
        reason: 'run_not_completed',
      })),
    });
    const state = await runResearchWorkflow({ ...options, cli });
    expect(state.stages[0]).toMatchObject({
      status: 'collection_failed',
      error: 'Terminal status/result mismatch: completed/cancelled',
    });
    await runResearchWorkflow({ ...options, cli });
    expect(cli.send).toHaveBeenCalledTimes(1);
  });

  it('cancelled remains cancelled and evidence is collected without reading missing outputs', async () => {
    const options = await fixture();
    const cli = fakeCli(new Map([['workspace:/input.md', '依据']]), {
      status: vi.fn<ResearchWorkflowCliPort['status']>(async () => status('cancelled')),
      result: vi.fn<ResearchWorkflowCliPort['result']>(async () => ({
        outcome: 'cancelled',
        completedAt: 3,
        resultStatus: 'unavailable',
        reason: 'run_not_completed',
      })),
    });
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe('cancelled');
    expect(
      JSON.parse(await readFile(path.join(options.output, 'D1/result.json'), 'utf8')).outcome
    ).toBe('cancelled');
    expect(cli.send).toHaveBeenCalledTimes(1);
  });
  it('a lost resume response observes its new execution, without issuing another resume or send', async () => {
    const options = await fixture();
    let current = status('paused');
    const cli = fakeCli(
      new Map([
        ['workspace:/input.md', '依据'],
        ['workspace:/output.md', '完成'],
      ]),
      {
        status: vi.fn<ResearchWorkflowCliPort['status']>(async () => current),
        resume: vi.fn<ResearchWorkflowCliPort['resume']>(async () => {
          current = status('completed', 'execution-2');
          throw new Error('lost receipt');
        }),
      }
    );
    await runResearchWorkflow({ ...options, cli });
    expect(
      (await runResearchWorkflow({ ...options, cli, resumeStage: 'D1' })).stages[0]?.resumePending
    ).toBe(true);
    expect(
      (await runResearchWorkflow({ ...options, cli, resumeStage: 'D1' })).stages[0]?.status
    ).toBe('completed');
    expect(cli.resume).toHaveBeenCalledTimes(1);
    expect(cli.send).toHaveBeenCalledTimes(1);
  });
  it('reconciles a lost resume without auto-resuming a second pause, then fences the new execution', async () => {
    const options = await fixture();
    let execution = 'execution';
    let resumeCount = 0;
    const cli = fakeCli(new Map([['workspace:/input.md', '输入']]), {
      status: vi.fn<ResearchWorkflowCliPort['status']>(async () => status('paused', execution)),
      resume: vi.fn<ResearchWorkflowCliPort['resume']>(async () => {
        resumeCount += 1;
        if (resumeCount === 1) execution = 'execution-2';
        throw new Error('lost response');
      }),
    });
    await runResearchWorkflow({ ...options, cli });
    await runResearchWorkflow({ ...options, cli, resumeStage: 'D1' });
    const reconciled = await runResearchWorkflow({ ...options, cli, resumeStage: 'D1' });
    expect(reconciled.stages[0]).toMatchObject({ status: 'paused', resumePending: false });
    expect(cli.resume).toHaveBeenCalledTimes(1);
    const second = await runResearchWorkflow({ ...options, cli, resumeStage: 'D1' });
    expect(second.stages[0]).toMatchObject({
      resumePending: true,
      resumeFromExecutionId: 'execution-2',
    });
    await runResearchWorkflow({ ...options, cli, resumeStage: 'D1' });
    expect(cli.resume).toHaveBeenCalledTimes(2);
    expect(cli.send).toHaveBeenCalledTimes(1);
  });

  it('collects all message pages, deduplicates by identity and excludes other runs', async () => {
    const one = tool('web_read', {}, 'first', {}, 1);
    const two = tool('web_read', {}, 'second', {}, 2);
    const cli = fakeCli(new Map(), {
      messagePage: vi.fn<ResearchWorkflowCliPort['messagePage']>(async (_id, before) => ({
        schema_version: 1,
        ok: true,
        command: 'messages',
        conversation_id: 'conversation',
        status: 'ready',
        revision: 1,
        messages: before
          ? [one, { ...two, run_id: 'another-run', message_id: 'another-message' }]
          : [two],
        has_more_before: before === undefined,
        has_more_after: false,
        ...(before === undefined ? { prev_cursor: 2 } : {}),
      })),
    });
    expect(
      (await collectMessages(cli, 'conversation', 'run')).map(message => message.content)
    ).toEqual(['first', 'second']);
    expect(cli.messagePage).toHaveBeenCalledTimes(2);
  });
  it('publishes actual source packets and verifies their readback without upgrading unknown data', async () => {
    const options = await fixture();
    const manifest = ResearchManifestSchema.parse(
      JSON.parse(await readFile(options.manifestFile, 'utf8'))
    );
    manifest.stages[0].sourcePacket = { prefix: 'workspace:/S1', index: 'workspace:/S1-index.md' };
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    const docs = new Map([
      ['workspace:/input.md', '依据'],
      ['workspace:/output.md', '文章'],
    ]);
    const cli = fakeCli(docs, {
      messagePage: vi.fn<ResearchWorkflowCliPort['messagePage']>(async () => ({
        schema_version: 1,
        ok: true,
        command: 'messages',
        conversation_id: 'conversation',
        status: 'ready',
        revision: 1,
        has_more_before: false,
        has_more_after: false,
        messages: [
          tool('web_read', {}, '冻结原文', {}, 1),
          writeResult('workspace:/output.md', 2, true),
        ],
      })),
    });
    const state = await runResearchWorkflow({ ...options, cli });
    expect(state.stages[0]).toMatchObject({
      status: 'completed',
      packetDocuments: [{ locator: 'workspace:/S1-001.md' }, { locator: 'workspace:/S1-index.md' }],
    });
    expect(docs.get('workspace:/S1-001.md')).toContain('冻结原文');
    const raw = JSON.parse(
      await readFile(path.join(options.output, 'D1/source-records.json'), 'utf8')
    );
    expect(raw[0]).toMatchObject({ kind: 'unverified', observation: '冻结原文' });
    await runResearchWorkflow({ ...options, cli });
    expect(cli.send).toHaveBeenCalledTimes(1);
    expect(cli.workspaceTool).toHaveBeenCalledWith(expect.objectContaining({ tool: 'write_file' }));
  });
  it('exports the complete reconciled source packet after a lost final publication receipt', async () => {
    const options = await fixture();
    const manifest = ResearchManifestSchema.parse(
      JSON.parse(await readFile(options.manifestFile, 'utf8'))
    );
    manifest.stages[0].sourcePacket = { prefix: 'workspace:/S1', index: 'workspace:/S1-index.md' };
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    const docs = new Map([
      ['workspace:/input.md', '依据'],
      ['workspace:/output.md', '文章'],
    ]);
    const workspace = fakeCli(docs);
    const cli = fakeCli(docs, {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
        const message = await workspace.workspaceTool(request);
        if (request.tool === 'write_file' && request.args.locator === 'workspace:/S1-index.md')
          throw new Error('Final publication accepted but receipt lost');
        return message;
      }),
      messagePage: vi.fn<ResearchWorkflowCliPort['messagePage']>(async () => ({
        schema_version: 1,
        ok: true,
        command: 'messages',
        conversation_id: 'conversation',
        status: 'ready',
        revision: 1,
        has_more_before: false,
        has_more_after: false,
        messages: [
          tool('web_read', {}, '第一份原文', {}, 1),
          tool('web_read', {}, '第二份原文', {}, 2),
          writeResult('workspace:/output.md', 3),
        ],
      })),
    });
    const publications = path.join(options.output, 'D1/source-publications.json');
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe(
      'collection_failed'
    );
    expect(JSON.parse(await readFile(publications, 'utf8'))).toHaveLength(2);
    const frozenIndex = docs.get('workspace:/S1-index.md');
    if (frozenIndex === undefined) throw new Error('Fixture index was not published');
    docs.set('workspace:/S1-index.md', `${frozenIndex}\n`);
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe(
      'collection_failed'
    );
    expect(JSON.parse(await readFile(publications, 'utf8'))).toHaveLength(2);
    docs.set('workspace:/S1-index.md', frozenIndex);
    const recovered = (await runResearchWorkflow({ ...options, cli })).stages[0];
    expect(recovered?.status).toBe('completed');
    expect(recovered?.packetDocuments).toHaveLength(3);
    expect(JSON.parse(await readFile(publications, 'utf8'))).toEqual(recovered?.packetDocuments);
    const journal: unknown = JSON.parse(
      await readFile(path.join(options.output, 'D1/source-publication-journal.json'), 'utf8')
    );
    expect(journal).toEqual(
      recovered?.packetDocuments.map(projection =>
        expect.objectContaining({ locator: projection.locator, status: 'complete', projection })
      )
    );
    expect(cli.send).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(cli.workspaceTool).mock.calls.filter(([request]) => request.tool === 'write_file')
    ).toHaveLength(3);
  });
  it('preserves source segment boundary whitespace through Markdown code-block normalization', async () => {
    const options = await fixture();
    const manifest = ResearchManifestSchema.parse(
      JSON.parse(await readFile(options.manifestFile, 'utf8'))
    );
    manifest.stages[0].sourcePacket = { prefix: 'workspace:/S1', index: 'workspace:/S1-index.md' };
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    const observation = '内容' + 'x'.repeat(5997) + ' ' + ' 末尾保留\t\n\n';
    const docs = new Map([
      ['workspace:/input.md', '依据'],
      ['workspace:/output.md', '文章'],
    ]);
    const workspace = fakeCli(docs);
    const cli = fakeCli(docs, {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
        const content = request.args.content;
        if (request.tool !== 'write_file' || typeof content !== 'string')
          return workspace.workspaceTool(request);
        // 模拟 Markdown owner 的代码块首尾 trim；原型不能靠宽松读回比较绕过它。
        return workspace.workspaceTool({
          ...request,
          args: {
            ...request.args,
            content: content.replace(/```text\n([\s\S]*?)\n```/g, (_match, body: string) =>
              ['```text', body.trim(), '```'].join('\n')
            ),
          },
        });
      }),
      messagePage: vi.fn<ResearchWorkflowCliPort['messagePage']>(async () => ({
        schema_version: 1,
        ok: true,
        command: 'messages',
        conversation_id: 'conversation',
        status: 'ready',
        revision: 1,
        has_more_before: false,
        has_more_after: false,
        messages: [
          tool('web_read', {}, observation, {}, 1),
          writeResult('workspace:/output.md', 2),
        ],
      })),
    });
    const result = await runResearchWorkflow({ ...options, cli });
    expect(result.stages[0]?.status).toBe('completed');
    const segments = result.stages[0]?.packetDocuments.slice(0, 2);
    expect(segments).toHaveLength(2);
    expect(
      segments
        ?.map(
          document =>
            document.text.match(
              /<<<BEGIN_SOURCE_SEGMENT>>>\n([\s\S]*?)\n<<<END_SOURCE_SEGMENT>>>/
            )?.[1]
        )
        .join('')
    ).toBe(observation);
    expect(segments?.[0]?.text).toContain('"segmentEnd": 6000');
    expect(segments?.[1]?.text).toContain('"segmentStart": 6000');
    expect(
      JSON.parse(await readFile(path.join(options.output, 'D1/source-records.json'), 'utf8'))
    ).toEqual([expect.objectContaining({ observation })]);
  });
  it('source packet isolates historical blob control text but preserves exact raw observations', () => {
    const raw =
      '真实取得正文。继续 tool_output_read({"blob_id":"abcdef1234567890"}) 同行尾部真实资料。';
    const records = collectSourceRecords([
      tool('web_read', {}, raw, { url: 'https://example.org/source' }),
    ]);
    const packet = renderSourcePacket(records, {
      prefix: 'workspace:/S0',
      index: 'workspace:/S0-index.md',
    });
    expect(records[0]?.observation).toBe(raw);
    expect(packet[0]?.content).toContain('真实取得正文');
    expect(packet[0]?.content).not.toContain('tool_output_read(');
    expect(packet[0]?.content).toContain('同行尾部真实资料');
    expect(packet[0]?.content).toContain('transformations');
    expect(packet[0]?.locator).toBe('workspace:/S0-001.md');
    expect(records[0]?.kind).toBe('unverified');
  });
  it('does not promote hidden continuation data into the visible source packet', () => {
    const message = tool(
      'tool_output_read',
      {
        blob_id: 'abcdef1234567890',
        start_offset: 0,
        end_offset_exclusive: 8,
        total_chars: 8,
        start_line: 1,
        end_line: 1,
        total_lines: 1,
        has_more: false,
        next_offset: null,
        window_text: 'seenHIDE',
      },
      'seen'
    );
    const records = collectSourceRecords([message]);
    expect(records[0]).toMatchObject({ kind: 'unverified', observation: 'seen' });
    expect(records[0]?.returnedRange).toBeUndefined();
    expect(
      renderSourcePacket(records, { prefix: 'workspace:/S', index: 'workspace:/S-index.md' })[0]
        ?.content
    ).not.toContain('HIDE');
  });
  it('recollects completed run after a transient projection failure without another author send', async () => {
    const options = await fixture();
    const docs = new Map([['workspace:/input.md', '依据']]);
    const cli = fakeCli(docs);
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe(
      'collection_failed'
    );
    docs.set('workspace:/output.md', '后来可读的原稿');
    expect((await runResearchWorkflow({ ...options, cli })).stages[0]?.status).toBe('completed');
    expect(cli.send).toHaveBeenCalledTimes(1);
  });
  it('marks a stage stale if the author changes its bound input and preserves output evidence', async () => {
    const options = await fixture();
    const docs = new Map([
      ['workspace:/input.md', '依据'],
      ['workspace:/output.md', '输出'],
    ]);
    const cli = fakeCli(docs, {
      status: vi.fn<ResearchWorkflowCliPort['status']>(async () => {
        docs.set('workspace:/input.md', '作者改了原依据');
        return status('completed');
      }),
    });
    const result = await runResearchWorkflow({ ...options, cli });
    expect(result.stages[0]).toMatchObject({ status: 'stale', outputs: [{ text: '输出' }] });
    expect(cli.send).toHaveBeenCalledTimes(1);
  });
  it('rejects source publication colliding with the article before any CLI calls', async () => {
    const options = await fixture();
    const manifest = ResearchManifestSchema.parse(
      JSON.parse(await readFile(options.manifestFile, 'utf8'))
    );
    manifest.stages[0].sourcePacket = { prefix: 'workspace:/S', index: 'workspace:/output.md' };
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    const cli = fakeCli(new Map());
    await expect(runResearchWorkflow({ ...options, cli })).rejects.toThrow('overlap');
    expect(cli.send).not.toHaveBeenCalled();
    expect(cli.workspaceTool).not.toHaveBeenCalled();
  });
  it('binds citation snapshots to the version while excluding conversation index decoration', async () => {
    let snippet = '冻结摘录';
    let index = 1;
    const cli = fakeCli(new Map(), {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async () => {
        const message = textRead('workspace:/article.md', '文章 [@Abc234]');
        const data = WorkspaceReadFileEventDataSchema.parse(message.payload.data);
        if (data.source_kind !== 'workspace_vfs')
          throw new Error('Fixture must use Workspace text');
        return {
          ...message,
          payload: {
            ...message.payload,
            data: {
              ...data,
              citations: {
                citations: [
                  {
                    sourceType: 'web',
                    ref: 'Abc234',
                    index,
                    url: 'https://example.org/source',
                    docTitle: 'Source',
                    snippet,
                    authors: [],
                  },
                ],
              },
              citation_diagnostics: [],
            },
          },
        };
      }),
    });
    const context = { cli, projectId: 'project', record: async () => undefined };
    const before = await readProjection(context, 'workspace:/article.md');
    index = 7;
    expect((await readProjection(context, 'workspace:/article.md')).versionHash).toBe(
      before.versionHash
    );
    snippet = '另一版本摘录';
    const after = await readProjection(context, 'workspace:/article.md');
    expect(after.sha256).toBe(before.sha256);
    expect(after.versionHash).not.toBe(before.versionHash);
  });
  it('attributes inode-only writes from successful owner results, not guessed arguments', async () => {
    const options = await fixture();
    const manifest = ResearchManifestSchema.parse(
      JSON.parse(await readFile(options.manifestFile, 'utf8'))
    );
    const scope = auditScope([writeResult('workspace:/input.md', 1, true)], manifest.stages[0], [
      'workspace:/input.md',
    ]);
    expect(scope.issues).toContainEqual(
      expect.objectContaining({ kind: 'write_out_of_scope', detail: 'workspace:/input.md' })
    );
    expect(scope.authorOutputReadbacks).toEqual([]);
  });
  it('distinguishes an old readback from reading after the final successful write', async () => {
    const options = await fixture();
    const manifest = ResearchManifestSchema.parse(
      JSON.parse(await readFile(options.manifestFile, 'utf8'))
    );
    const first = writeResult('workspace:/output.md');
    const oldRead = textRead('workspace:/output.md', '旧文');
    oldRead.payload.started_at = 3;
    oldRead.payload.completed_at = 4;
    const finalWrite = writeResult('workspace:/output.md', 3);
    finalWrite.payload.started_at = 5;
    finalWrite.payload.completed_at = 6;
    const finalRead = textRead('workspace:/output.md', '新文');
    finalRead.payload.started_at = 7;
    finalRead.payload.completed_at = 8;
    const scope = auditScope([first, oldRead, finalWrite, finalRead], manifest.stages[0], []);
    expect(scope.authorOutputReadbacks.map(read => read.finalWriteRelation)).toEqual([
      'before_last_successful_write',
      'after_last_successful_write',
    ]);
    expect(scope.authorReadbackCompleteness).toBe('not_inferred_from_single_calls');
  });
  it('does not add future packets on reopen and cascades later verdict staleness', async () => {
    const options = await fixture();
    const manifest = ResearchManifestSchema.parse(
      JSON.parse(await readFile(options.manifestFile, 'utf8'))
    );
    const template = manifest.stages[0];
    manifest.stages = [
      {
        ...template,
        id: 'D0',
        expectedDocuments: ['workspace:/D0.md'],
        sourcePacket: { prefix: 'workspace:/S0', index: 'workspace:/S0-index.md' },
      },
      {
        ...template,
        id: 'D1',
        expectedDocuments: ['workspace:/D1.md'],
        allowedMaterials: ['workspace:/D0.md'],
        sourcePacket: { prefix: 'workspace:/S1', index: 'workspace:/S1-index.md' },
      },
    ];
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    let stage = 'D0';
    let sends = 0;
    const docs = new Map([
      ['workspace:/input.md', '依据'],
      ['workspace:/D0.md', '初稿'],
      ['workspace:/D1.md', '修订稿'],
    ]);
    const cli = fakeCli(docs, {
      send: vi.fn<ResearchWorkflowCliPort['send']>(async () => {
        stage = sends++ === 0 ? 'D0' : 'D1';
        return {
          conversation_id: stage,
          run_id: stage,
          turn_id: 'turn',
          execution_id: 'execution',
          agent_id: 'default',
          accepted_at: 1,
          user_message_id: stage,
        };
      }),
      status: vi.fn<ResearchWorkflowCliPort['status']>(async () => ({
        ...status('completed'),
        run_id: stage,
        conversation_id: stage,
      })),
      messagePage: vi.fn<ResearchWorkflowCliPort['messagePage']>(async () => ({
        schema_version: 1,
        ok: true,
        command: 'messages',
        conversation_id: stage,
        status: 'ready',
        revision: 1,
        has_more_before: false,
        has_more_after: false,
        messages: [
          { ...tool('web_read', {}, '实际原文', {}, 1), run_id: stage },
          { ...writeResult(`workspace:/${stage}.md`, 2), run_id: stage },
        ],
      })),
    });
    expect(
      (await runResearchWorkflow({ ...options, cli })).stages.map(stage => stage.status)
    ).toEqual(['completed', 'completed']);
    expect(
      (await runResearchWorkflow({ ...options, cli })).stages.map(stage => stage.status)
    ).toEqual(['completed', 'completed']);
    expect(cli.send).toHaveBeenCalledTimes(2);
    docs.set('workspace:/D0.md', '后来变化');
    expect(
      (await runResearchWorkflow({ ...options, cli })).stages.map(stage => stage.status)
    ).toEqual(['stale', 'stale']);
    expect(cli.send).toHaveBeenCalledTimes(2);
  });
  it('recovers outer-truncated long lines through explicit DocumentView character pages', async () => {
    const content = `[#Abc234] ${'长'.repeat(9200)}`;
    const cli = fakeCli(new Map(), {
      workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => {
        if (request.args.view !== 'document') {
          const read = textRead('workspace:/long.md', content, 1, Number(request.args.limit));
          return {
            ...read,
            content: '1 | 前缀\n继续 tool_output_read({"blob_id":"abcdef1234567890"})',
          };
        }
        const offset = Number(request.args.offset_chars);
        const end = Math.min(offset + 4000, content.length);
        const truncated = end < content.length;
        const nextOffset = truncated ? end : null;
        return tool(
          'read_file',
          {
            source_kind: 'workspace_document',
            locator: 'workspace:/long.md',
            inode: 'long',
            content_type: 'application/vnd.linnya.document-view',
            document: {
              documentId: 'doc',
              docType: 'markdown',
              documentName: 'long',
              truncatedByChars: truncated,
              totalTextLength: content.length,
              nextOffset,
              presentation: { kind: 'text', text: content.slice(offset, end) },
            },
          },
          buildDocumentView(
            {
              documentId: 'doc',
              docType: 'markdown',
              offsetChars: offset,
              totalTextLength: content.length,
              truncatedByChars: truncated,
              nextOffset,
            },
            content.slice(offset, end) + (truncated ? '... [truncated]' : '')
          )
        );
      }),
    });
    const result = await readProjection(
      { cli, projectId: 'project', record: async () => undefined },
      'workspace:/long.md'
    );
    expect(result).toMatchObject({
      representation: 'document-view',
      text: content,
      hanCharacters: 9200,
    });
  });
});
