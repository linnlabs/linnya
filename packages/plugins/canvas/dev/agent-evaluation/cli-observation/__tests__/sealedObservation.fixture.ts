import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackendPluginCliResult } from '@plugin/backend/pluginCli';
import type { CanvasCliExecutionIdentity } from '../definitions';
import { createCanvasCliObservation } from '../createCanvasCliObservation';
import { CANVAS_CLI_FROZEN_PRODUCER_SOURCE, CANVAS_CLI_PRODUCER_FILES } from '../definitions/sealedObservation';

/** 可控可信build/安装边界；这些文件只测接纳合同，绝不当实际App或Worker性能证据。 */
export function createSealedObservationFixture(root: string) {
  const artifact = path.join(root, 'cli-artifact'), directory = path.join(root, 'cli-session'), sources = path.join(root, 'producer-sources');
  mkdirSync(path.join(artifact, 'dist/backend'), { recursive: true });
  const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
  const save = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value) + '\n', { flag: 'wx' });
  const original = 'fixture original compiled backend', wrapper = 'fixture observed backend';
  writeFileSync(path.join(artifact, 'dist/backend/index.production.cjs'), original); writeFileSync(path.join(artifact, 'dist/backend/index.cjs'), wrapper);
  const payloads = { productionSourceRevision: CANVAS_CLI_FROZEN_PRODUCER_SOURCE, payloads: [{ originalPath: 'dist/backend/index.cjs',
    observedPath: 'dist/backend/index.production.cjs', bytes: Buffer.byteLength(original), sha256: hash(original) }] };
  const payloadFile = path.join(artifact, 'cli-observation-payloads.json'); save(payloadFile, payloads);
  const config = { evidenceDirectory: directory, observationSourceRevision: 'b'.repeat(40), productionSourceRevision: CANVAS_CLI_FROZEN_PRODUCER_SOURCE,
    originalBackendSha256: hash(original), payloadManifestSha256: hash(readFileSync(payloadFile)) };
  save(path.join(artifact, 'cli-observation-build.json'), { ...config, wrapperSha256: hash(wrapper), copiedPayloadCount: 1 });
  const packageRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  for (const name of Object.keys(CANVAS_CLI_PRODUCER_FILES)) {
    const target = path.join(sources, name); mkdirSync(path.dirname(target), { recursive: true }); copyFileSync(path.join(packageRoot, name), target);
  }
  const logFile = path.join(root, 'official-build.log'); writeFileSync(logFile, 'CPU fixture official-build boundary; not a real build proof\n');
  const provenanceFile = path.join(root, 'production-build-provenance.json'); save(provenanceFile, {
    schemaVersion: 1, kind: 'canvas-cli-official-production-build', sourceRevision: config.productionSourceRevision, sourceDirty: false,
    originalBackendSha256: config.originalBackendSha256, producerSourceDirectory: sources,
    command: ['pnpm', '--filter', '@plugin/canvas', 'build'], exitCode: 0, completedAt: 50, logFile, logSha256: hash(readFileSync(logFile)),
  });
  let time = 100, invocation = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => time), observation = createCanvasCliObservation(config);
  const activationFile = path.join(root, 'cli-activation.json'); save(activationFile, { ...config, schemaVersion: 1,
    kind: 'canvas-cli-observation-activation', backendPid: process.pid, observedAt: 200, preparedArtifactDirectory: artifact,
    productionBuildProvenanceFile: provenanceFile, productionBuildProvenanceSha256: hash(readFileSync(provenanceFile)), wrapperSha256: hash(wrapper),
    namedBackendPluginSelected: true, nonCliReferencesPreserved: true });
  return { directory, activationFile, artifact, sources, provenanceFile, observation, restoreClock: () => clock.mockRestore(),
    record(input: { readonly argv: readonly string[]; readonly response: unknown; readonly at: number; readonly until: number;
      readonly identity?: CanvasCliExecutionIdentity; readonly prepareOnly?: boolean; readonly exitCode?: number }) {
      time = input.at;
      const id = observation.start({ argv: input.argv, conversationRoot: '/conversation', invocationId: `cli-${++invocation}` });
      const result: BackendPluginCliResult = { exitCode: input.exitCode ?? 0, stdout: JSON.stringify(input.response) + '\n', stderr: '' };
      if (!input.prepareOnly) {
        observation.ready(id); const identity = input.identity ?? { conversationId: 'conv', agentRunId: 'run', projectId: 'project' };
        observation.execute(id, { conversationId: identity.conversationId ?? undefined, agentRunId: identity.agentRunId ?? undefined,
          projectId: identity.projectId ?? undefined, hostContext: null, signal: new AbortController().signal });
      }
      time = input.until; observation.result(id, input.prepareOnly ? 'prepare' : 'execute', result);
    },
    seal(at = 2000) { time = at; observation.seal(); clock.mockRestore(); },
  };
}
