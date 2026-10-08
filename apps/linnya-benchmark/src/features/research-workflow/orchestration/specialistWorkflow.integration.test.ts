import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResearchManifestSchema,
  specialistStageIds,
  type ResearchWorkflowCliPort,
} from '../definitions/researchWorkflow';
import { runResearchWorkflow } from './runResearchWorkflow';
import {
  cleanupFixtures,
  fakeCli,
  fixture,
  status,
  writeResult,
} from './__test-helpers__/researchWorkflowFixture';

afterEach(cleanupFixtures);

async function specialistFixture(pauseFirstReview = false) {
  const options = await fixture();
  const template = ResearchManifestSchema.parse(
    JSON.parse(await readFile(options.manifestFile, 'utf8'))
  ).stages[0];
  const dependencies = {
    I0: [],
    P0: ['I0'],
    W0: ['I0', 'P0'],
    Q0A: ['W0'],
    Q0B: ['W0'],
    W1: ['W0', 'Q0A', 'Q0B'],
  };
  const manifest = ResearchManifestSchema.parse({
    schemaVersion: 2,
    projectId: 'project',
    stages: specialistStageIds.map(id => ({
      ...template,
      id,
      promptFile: `${id}.md`,
      agentId: 'default',
      allowedMaterials: dependencies[id].map(source => `workspace:/${source}.md`),
      expectedDocuments: [`workspace:/${id}.md`],
    })),
  });
  for (const stage of manifest.stages)
    await writeFile(path.join(path.dirname(options.manifestFile), stage.promptFile), stage.id);
  await writeFile(options.manifestFile, JSON.stringify(manifest));
  const docs = new Map(specialistStageIds.map(id => [`workspace:/${id}.md`, `合成产物 ${id}`]));
  const admitted = new Set<string>();
  let paused = pauseFirstReview;
  const executions = new Map<string, string>();
  let releaseReviews: () => void = () => undefined;
  const bothAdmitted = new Promise<void>(resolve => {
    releaseReviews = resolve;
  });
  const base = fakeCli(docs);
  let inspection = 0;
  const cli = fakeCli(docs, {
    send: vi.fn<ResearchWorkflowCliPort['send']>(async request => {
      const id = request.message.split('\n')[0];
      admitted.add(id);
      if (admitted.has('Q0A') && admitted.has('Q0B')) releaseReviews();
      return {
        conversation_id: id,
        run_id: id,
        turn_id: id,
        execution_id: `${id}-execution`,
        agent_id: request.agentId,
        accepted_at: 1,
        user_message_id: id,
      };
    }),
    status: vi.fn<ResearchWorkflowCliPort['status']>(async id => {
      if (id === 'Q0A' || id === 'Q0B') await bothAdmitted;
      return {
        ...status(id === 'Q0A' && paused ? 'paused' : 'completed'),
        conversation_id: id,
        run_id: id,
        execution_id: executions.get(id) ?? `${id}-execution`,
      };
    }),
    resume: vi.fn<ResearchWorkflowCliPort['resume']>(async id => {
      paused = false;
      executions.set(id, `${id}-resumed`);
      return {
        schema_version: 1,
        ok: true,
        command: 'resume',
        receipt: {
          conversation_id: id,
          run_id: id,
          turn_id: id,
          execution_id: `${id}-resumed`,
          agent_id: 'default',
          accepted_at: 2,
        },
      };
    }),
    messagePage: vi.fn<ResearchWorkflowCliPort['messagePage']>(async id => ({
      schema_version: 1,
      ok: true,
      command: 'messages',
      conversation_id: id,
      status: 'ready',
      revision: 1,
      has_more_before: false,
      has_more_after: false,
      messages: [{ ...writeResult(`workspace:/${id}.md`), run_id: id, conversation_id: id }],
    })),
    workspaceTool: vi.fn<ResearchWorkflowCliPort['workspaceTool']>(async request => ({
      ...(await base.workspaceTool(request)),
      conversation_id: request.conversationId ?? `inspection-${++inspection}`,
    })),
  });
  return { options, manifest, docs, cli };
}

describe('fixed specialist research workflow', () => {
  it('admits independent reviews concurrently, binds both versions and reopens without resending', async () => {
    const { options, cli } = await specialistFixture();
    const state = await runResearchWorkflow({ ...options, cli });
    expect(state.stages.map(stage => stage.status)).toEqual(Array(6).fill('completed'));
    expect(cli.send).toHaveBeenCalledTimes(6);
    expect(state.stageInspectionConversations?.Q0A).not.toBe(
      state.stageInspectionConversations?.Q0B
    );
    const stored = JSON.parse(await readFile(path.join(options.output, 'state.json'), 'utf8'));
    expect(stored.stages).toHaveLength(6);
    expect(
      state.stages.find(stage => stage.id === 'W1')?.inputs.map(input => input.locator)
    ).toEqual(['workspace:/W0.md', 'workspace:/Q0A.md', 'workspace:/Q0B.md']);
    const prompt = await readFile(path.join(options.output, 'Q0A/prompt.txt'), 'utf8');
    expect(prompt).not.toContain('Q0B');
    await runResearchWorkflow({ ...options, cli });
    expect(cli.send).toHaveBeenCalledTimes(6);
  });

  it('keeps the peer completed while a review is paused; resumes exact identity before revision', async () => {
    const { options, cli } = await specialistFixture(true);
    const first = await runResearchWorkflow({ ...options, cli });
    expect(first.stages.find(stage => stage.id === 'Q0A')?.status).toBe('paused');
    expect(first.stages.find(stage => stage.id === 'Q0B')?.status).toBe('completed');
    expect(first.stages.some(stage => stage.id === 'W1')).toBe(false);
    expect(cli.send).toHaveBeenCalledTimes(5);
    const second = await runResearchWorkflow({ ...options, cli, resumeStage: 'Q0A' });
    expect(second.stages.every(stage => stage.status === 'completed')).toBe(true);
    expect(cli.resume).toHaveBeenCalledWith('Q0A', 'Q0A');
    expect(second.stages.find(stage => stage.id === 'Q0A')?.receipt?.execution_id).toBe(
      'Q0A-resumed'
    );
    expect(cli.send).toHaveBeenCalledTimes(6);
    expect(cli.stop).not.toHaveBeenCalled();
  });

  it('invalidates a changed review and its revision, preserving the independent peer', async () => {
    const { options, docs, cli } = await specialistFixture();
    await runResearchWorkflow({ ...options, cli });
    docs.set('workspace:/Q0A.md', '改变了的评审');
    const state = await runResearchWorkflow({ ...options, cli });
    expect(state.stages.find(stage => stage.id === 'Q0A')?.status).toBe('stale');
    expect(state.stages.find(stage => stage.id === 'Q0B')?.status).toBe('completed');
    expect(state.stages.find(stage => stage.id === 'W1')?.status).toBe('stale');
    expect(cli.send).toHaveBeenCalledTimes(6);
  });

  it('rejects cross-review contamination and output overwrite before admission', async () => {
    const { options, manifest, cli } = await specialistFixture();
    const firstReview = manifest.stages.find(stage => stage.id === 'Q0A');
    if (!firstReview) throw new Error('Missing review fixture');
    firstReview.allowedMaterials.push('workspace:/Q0B.md');
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    await expect(runResearchWorkflow({ ...options, cli })).rejects.toThrow('parallel');
    expect(cli.send).not.toHaveBeenCalled();
    firstReview.allowedMaterials.pop();
    firstReview.expectedDocuments = ['workspace:/W0.md'];
    await writeFile(options.manifestFile, JSON.stringify(manifest));
    await expect(runResearchWorkflow({ ...options, cli })).rejects.toThrow('distinct output');
    expect(cli.send).not.toHaveBeenCalled();
  });
});
