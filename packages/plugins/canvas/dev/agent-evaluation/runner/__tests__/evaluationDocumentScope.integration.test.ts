import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import {
  attachCanvasEvaluation,
  startCanvasEvaluation,
  collectCanvasEvaluation,
  type EvaluationRunnerPorts,
} from '../index';
import { updateRunnerState, writeEvidence, readRunnerState } from '../adapters/evidenceFiles';

it.each(['attach', 'start', 'collect'] as const)(
  'retains a wrong-document raw response but rejects it as %s evidence',
  async stage => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'canvas-runner-scope-'));
    const commands: string[] = [],
      calls: string[] = [];
    const ports: EvaluationRunnerPorts = {
      verifyRevision: async () => {},
      async bridge(input) {
        commands.push(input.command.kind);
        const value = {
          snapshot: { schemaVersion: 1, documentId: 'another-canvas', sequence: 0, elements: [] },
        };
        await writeEvidence(input.directory, input.label + '.response.json', { ok: true, value });
        return value;
      },
      async cli(input) {
        calls.push(input.args[0]);
        return {
          exitCode: 0,
          value: {
            schema_version: 1,
            ok: true,
            command: 'messages',
            conversation_id: 'conv',
            status: 'ready',
            messages: [],
            has_more_before: false,
            has_more_after: false,
            revision: 1,
          },
        };
      },
    };
    try {
      await updateRunnerState(directory, {
        config: {
          repositoryRoot: directory,
          sourceRevision: 'a'.repeat(40),
          batchId: 'fixed',
          taskId: 'T1',
          modelConfigId: 'model',
          model: { provider: 'test', model: 'test', version: 'test' },
          imageCapability: 'no-vision',
          repetition: 1,
          evidenceMode: 'not-applicable',
          limitations: [],
        },
        projectId: 'project',
        documentId: 'expected-canvas',
        documentIds: {},
        phase: stage === 'attach' ? 'setup' : stage === 'start' ? 'attached' : 'started',
        connectionFile: path.join(directory, 'bridge.json'),
        receipt: {
          conversation_id: 'conv',
          user_message_id: 'message',
          turn_id: 'turn',
          run_id: 'run',
          execution_id: 'execution',
          agent_id: 'default',
          accepted_at: 1,
        },
        startedAt: 1,
      });
      if (stage === 'collect') {
        const result = await collectCanvasEvaluation({ directory, label: 'final', ports });
        expect(result.evidenceComplete).toBe(false);
        expect(result.errors.join('\n')).toContain('another Canvas document');
        await expect(readFile(path.join(directory, 'final/after.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } else {
        const request =
          stage === 'attach'
            ? attachCanvasEvaluation({
                directory,
                connectionFile: path.join(directory, 'bridge.json'),
                ports,
              })
            : startCanvasEvaluation({ directory, ports });
        await expect(request).rejects.toThrow('another Canvas document');
        expect(commands).not.toContain('seed');
        expect(calls).not.toContain('send');
        expect((await readRunnerState(directory)).phase).toBe(
          stage === 'attach' ? 'setup' : 'attached'
        );
      }
      const raw = path.join(
        directory,
        stage === 'attach'
          ? 'attach/mounted.response.json'
          : stage === 'start'
            ? 'start/before.response.json'
            : 'final/after.response.json'
      );
      expect(await readFile(raw, 'utf8')).toContain('another-canvas');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
