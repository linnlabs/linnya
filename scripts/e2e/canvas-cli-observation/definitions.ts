import { z } from 'zod';

const file = z.string().min(1), sha = z.string().regex(/^[a-f0-9]{64}$/);
export const SmokeRequestSchema = z.object({ repositoryRoot: file, buildProvenanceFile: file, buildLogFile: file,
  frozenRendererDirectory: file, outputDirectory: file }).strict();
export type SmokeRequest = z.infer<typeof SmokeRequestSchema>;
export const BuildRecordSchema = z.object({ sourceRevision: z.string(), sourceClean: z.literal(true),
  buildOnlyCommandExitCode: z.literal(0), hostCanvasAndDependencyHashes: z.array(z.object({ path: file, bytes: z.number().int(), sha256: sha })) });
export const CpuProofSchema = z.object({ namedBackendPluginSelected: z.literal(true), nonCliReferencesPreserved: z.literal(true),
  originalBackendSha256: sha, wrapperSha256: sha, proofPid: z.number().int().positive(),
  otherExports: z.array(z.string()), otherContributions: z.array(z.string()) });
export const PreparedSmokeSchema = z.object({ request: SmokeRequestSchema, sourceRevision: z.string(), observationSourceRevision: z.string(),
  buildFile: file, buildSha256: sha, preparedArtifact: file, installedArtifact: file, evidenceDirectory: file,
  payloadManifestSha256: sha, originalBackendSha256: sha, wrapperSha256: sha, cpuProofFile: file,
  instanceRoot: file, rendererDirectory: file, loaderSourceSha256: sha }).strict();
export type PreparedSmoke = z.infer<typeof PreparedSmokeSchema>;
export const ProcessInstanceSchema = z.object({ pid: z.number().int().positive(), startedAt: z.string(), command: z.string() });
export type ProcessInstance = z.infer<typeof ProcessInstanceSchema>;
export const ProcessInstancesSchema = z.array(ProcessInstanceSchema);
export const PayloadsSchema = z.object({ payloads: z.array(z.object({ originalPath: file, observedPath: file, sha256: sha })) });
