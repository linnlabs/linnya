import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { CanvasSnapshotSchema, CanvasCommitResultSchema } from '@plugin/canvas/shared';
import { createCanvasAgentFixture } from '../../../../scripts/agent-evaluation';
import type { EvaluationRunnerPorts } from '../definitions/evaluationRunner';
import {
  createEvidenceStep,
  readRunnerState,
  updateRunnerState,
  writeEvidence,
} from '../adapters/evidenceFiles';
export async function attachCanvasEvaluation(input: {
  readonly directory: string;
  readonly connectionFile: string;
  readonly ports: EvaluationRunnerPorts;
}) {
  const state = await readRunnerState(input.directory);
  if (state.phase !== 'setup') throw new Error('This evaluation has already been attached');
  await input.ports.verifyRevision(state.config.repositoryRoot, state.config.sourceRevision);
  const directory = await createEvidenceStep(input.directory, 'attach'),
    connectionFile = path.resolve(input.connectionFile);
  const bridge = (
    label: string,
    command: Parameters<EvaluationRunnerPorts['bridge']>[0]['command']
  ) =>
    input.ports.bridge({ connectionFile, projectId: state.projectId, directory, label, command });
  await bridge('mount', {
    id: randomUUID(),
    kind: 'mount',
    payload: { projectId: state.projectId, documentId: state.documentId },
  });
  const fixture = createCanvasAgentFixture(state.config.taskId);
  for (let offset = 0; offset < fixture.userSeedOperations.length; offset += 500) {
    const raw = await bridge(`seed-${offset / 500 + 1}`, {
      id: randomUUID(),
      kind: 'seed',
      payload: { operations: fixture.userSeedOperations.slice(offset, offset + 500) },
    });
    const result = z
      .object({ commit: CanvasCommitResultSchema, source: z.literal('user') })
      .parse(raw);
    if (result.commit.results.some(operation => operation.status !== 'applied'))
      throw new Error('User seed was not applied completely; retain this failed fixture');
  }
  await bridge('fit', { id: randomUUID(), kind: 'fit', payload: {} });
  const before = z
    .object({ snapshot: CanvasSnapshotSchema })
    .parse(await bridge('read', { id: randomUUID(), kind: 'read', payload: {} }));
  await writeEvidence(input.directory, 'before-setup.json', before.snapshot);
  if (state.config.taskId === 'T11') {
    const target = before.snapshot.elements.find(element => element.type === 'text');
    if (!target) throw new Error('T11 did not seed its editable X card');
    await bridge('edit', { id: randomUUID(), kind: 'edit', payload: { elementId: target.id } });
  }
  await updateRunnerState(input.directory, { ...state, connectionFile, phase: 'attached' });
  return {
    phase: 'attached',
    control: fixture.control,
    next:
      state.config.taskId === 'T11'
        ? 'Use real keyboard input to leave the X draft, then start.'
        : 'Start the model; approvals remain real UI actions.',
  };
}
