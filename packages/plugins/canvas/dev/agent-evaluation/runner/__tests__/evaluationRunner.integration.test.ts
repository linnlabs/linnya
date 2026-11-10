import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import {
  setupCanvasEvaluation,
  attachCanvasEvaluation,
  startCanvasEvaluation,
  collectCanvasEvaluation,
  type EvaluationRunnerPorts,
} from '../index';
import { writeEvidence, readRunnerState } from '../adapters/evidenceFiles';

it('creates an independent fixture, sends once and retains all paginated raw evidence without manufacturing a score', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canvas-runner-')),
    repositoryRoot = path.join(root, 'source'),
    directory = path.join(root, 'run');
  await mkdir(repositoryRoot);
  const snapshot = { schemaVersion: 1, documentId: 'doc-9', sequence: 0, elements: [] };
  const calls: (readonly string[])[] = [];
  let documents = 0,
    sourceChanged = false;
  const receipt = {
    conversation_id: 'conv',
    user_message_id: 'message',
    turn_id: 'turn',
    run_id: 'run',
    execution_id: 'execution',
    agent_id: 'default',
    accepted_at: 1,
  };
  const ports: EvaluationRunnerPorts = {
    verifyRevision: async () => {
      if (sourceChanged) throw new Error('Source revision changed');
    },
    async bridge(input) {
      await writeEvidence(input.directory, input.label + '.response.json', {
        ok: true,
        value: { snapshot },
      });
      return { snapshot };
    },
    async cli(input) {
      calls.push(input.args);
      let value: unknown = { ok: true };
      if (input.args[0] === 'projects')
        value = {
          schema_version: 1,
          ok: true,
          command: 'projects',
          action: 'create',
          project: {
            project_id: 'project',
            name: 'Test',
            description: null,
            icon: null,
            system_role: null,
            created_at: 1,
            updated_at: 1,
            can_delete: true,
          },
        };
      if (input.args[0] === 'tools')
        value = {
          ok: true,
          tool: { payload: { status: 'success', data: { documentId: `doc-${++documents}` } } },
        };
      if (input.args[0] === 'send')
        value = { schema_version: 1, ok: true, command: 'send', receipt };
      if (input.args[0] === 'messages')
        value = {
          schema_version: 1,
          ok: true,
          command: 'messages',
          conversation_id: 'conv',
          status: 'ready',
          messages: [],
          has_more_before: !input.args.includes('--before'),
          has_more_after: false,
          prev_cursor: input.args.includes('--before') ? 1 : 2,
          revision: 1,
        };
      await writeEvidence(input.directory, input.label + '.response.json', value);
      return { exitCode: 0, value };
    },
  };
  try {
    await setupCanvasEvaluation({
      config: {
        repositoryRoot,
        sourceRevision: 'a'.repeat(40),
        batchId: 'fixed',
        taskId: 'T1',
        modelConfigId: 'configured',
        model: { provider: 'test', model: 'model', version: 'fixed' },
        imageCapability: 'no-vision',
        evidenceMode: 'not-applicable',
      },
      outputDirectory: directory,
      ports,
    });
    expect(documents).toBe(9);
    await expect(
      setupCanvasEvaluation({
        config: (await readRunnerState(directory)).config,
        outputDirectory: directory,
        ports,
      })
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await attachCanvasEvaluation({
      directory,
      connectionFile: path.join(root, 'bridge.json'),
      ports,
    });
    await startCanvasEvaluation({ directory, ports });
    await expect(startCanvasEvaluation({ directory, ports })).rejects.toThrow('Attach');
    expect(calls.filter(args => args[0] === 'send')).toHaveLength(1);
    expect(calls.find(args => args[0] === 'send')?.[1]).toContain('仅通过check');
    sourceChanged = true;
    const result = await collectCanvasEvaluation({ directory, label: 'final', ports });
    expect(result.errors).toContain('Source revision changed');
    expect(
      JSON.parse(await readFile(path.join(directory, 'final/messages-index.json'), 'utf8'))
    ).toEqual({ complete: true, files: ['messages-1.response.json', 'messages-2.response.json'] });
    expect(calls.some(args => args[0] === 'messages' && args.includes('--before'))).toBe(true);
    await expect(readFile(path.join(directory, 'run.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      collectCanvasEvaluation({ directory, label: 'final', ports })
    ).rejects.toMatchObject({ code: 'EEXIST' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
