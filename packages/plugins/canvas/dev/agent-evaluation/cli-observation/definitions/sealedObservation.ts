import { z } from 'zod';

export const CANVAS_CLI_FROZEN_PRODUCER_SOURCE = '61bddb736ad78efbfc74a282a3b589f23e3cbfde';
/** 已核fresh-null iff合同的真实源字节；不是对任意版本null的兼容白名单。 */
export const CANVAS_CLI_PRODUCER_FILES = {
  'src/backend/orchestration/executeCanvasCliWrite.ts': '98415c48c4f843ea4f1bee6d4ff920f813d3dfffaaa00665b274001f2323228d',
  'src/backend/features/canvasWrite/orchestration/prepareCanvasWrite.ts': '1643a608cb515f2112df77270871242e5acb2fe8e73a5109c34d032c5582a8fe',
  'src/backend/capabilities/canvasComputation/createCanvasComputationRuntime.ts': '3f38aaa7466e0ecfa2c290667ad6bb27b8aad9cc64b46c61c756699945e6a03d',
  'src/backend/orchestration/definitions/canvasComputationWorker.ts': 'ccb8cbab48f5fa3eaf2b46147e35723e0229b083db5229ba9819c6b76ded44ee',
  'src/backend/features/canvasLayoutRun/worker.ts': '8d2edcbbaea3de92912905fcb3d7a6a74d58fd7c2fd9070125f1c907532dbb04',
  'src/shared/layout/definitions/canvasLayout.ts': 'ab795eb184fdc94367cdff9a27fa3054b600a94230f92ac55892530dc8d5a567',
} as const;

const sha = z.string().regex(/^[a-f0-9]{64}$/), revision = z.string().regex(/^[a-f0-9]{40}$/);
const time = z.number().finite().nonnegative(), id = z.number().int().positive();
export const CanvasCliObservationProvenanceSchema = z.object({ observationSourceRevision: revision, productionSourceRevision: revision,
  originalBackendSha256: sha, payloadManifestSha256: sha });
export const CanvasCliObservationActivationSchema = CanvasCliObservationProvenanceSchema.extend({
  schemaVersion: z.literal(1), kind: z.literal('canvas-cli-observation-activation'), backendPid: id, observedAt: time,
  evidenceDirectory: z.string().min(1), preparedArtifactDirectory: z.string().min(1), productionBuildProvenanceFile: z.string().min(1),
  productionBuildProvenanceSha256: sha,
  wrapperSha256: sha, namedBackendPluginSelected: z.literal(true), nonCliReferencesPreserved: z.literal(true),
}).strict();
export const CanvasCliProductionBuildSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('canvas-cli-official-production-build'),
  sourceRevision: revision, sourceDirty: z.literal(false), originalBackendSha256: sha, producerSourceDirectory: z.string().min(1),
  command: z.array(z.string()).min(1), exitCode: z.literal(0), completedAt: time, logFile: z.string().min(1), logSha256: sha,
}).strict();
export const CanvasCliObservationSessionSchema = CanvasCliObservationProvenanceSchema.extend({ schemaVersion: z.literal(1),
  kind: z.literal('canvas-cli-observation-shell'), evidenceDirectory: z.string(), pid: id, startedAt: time, synchronousIo: z.literal(true),
  performanceQualification: z.literal('observed-task-conservative-latency-only'),
}).strict();
export const CanvasCliObservationSealSchema = z.object({ schemaVersion: z.literal(1), finishedAt: time, exitCode: z.literal(0),
  status: z.literal('complete'), writeFailed: z.literal(false), pending: z.array(z.unknown()).length(0), invocations: z.number().int().nonnegative(),
  files: z.array(z.object({ name: z.string().regex(/^(?:session|\d{6,})\.json$/), bytes: z.number().int().nonnegative(), sha256: sha }).strict()),
}).strict();

const missing = z.object({ state: z.enum(['absent', 'ambiguous', 'not-applicable']), value: z.null() }).strict();
const requestId = z.union([missing, z.object({ state: z.literal('explicit'), value: z.string() }).strict()]);
const dryRun = z.union([z.object({ state: z.enum(['ambiguous', 'not-applicable']), value: z.null() }).strict(),
  z.object({ state: z.literal('explicit'), value: z.literal(true) }).strict(), z.object({ state: z.literal('absent'), value: z.literal(false) }).strict()]);
const input = z.object({ invocationId: z.string(), command: z.string().nullable(), locator: z.string().nullable(), managedOpsPath: z.string().nullable(),
  opsPathOutsideConversation: z.boolean(), requestId, dryRun }).strict();
const identity = z.object({ conversationId: z.string().nullable(), agentRunId: z.string().nullable(), projectId: z.string().nullable() }).strict();
const result = z.object({ exitCode: z.number().int(), stdout: z.string(), stderr: z.string() }).strict();
const event = z.object({ id, observedAt: time });
export const CanvasCliObservationEventSchema = z.discriminatedUnion('kind', [
  event.extend({ kind: z.literal('prepare-start'), facts: z.object({ input, attribution: z.literal('unattributed-no-execution-context') }).strict() }).strict(),
  event.extend({ kind: z.literal('prepare-ready'), facts: z.object({}).strict() }).strict(),
  event.extend({ kind: z.literal('execute-start'), facts: z.object({ identity }).strict() }).strict(),
  event.extend({ kind: z.literal('prepare-result'), facts: z.object({ result, attribution: z.literal('unattributed-no-execution-context') }).strict() }).strict(),
  event.extend({ kind: z.literal('execute-result'), facts: z.object({ result, attribution: z.literal('execution-context-recorded') }).strict() }).strict(),
  event.extend({ kind: z.literal('prepare-threw'), facts: z.object({ threw: z.literal(true) }).strict() }).strict(),
  event.extend({ kind: z.literal('execute-threw'), facts: z.object({ threw: z.literal(true) }).strict() }).strict(),
]);
