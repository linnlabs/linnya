import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CANVAS_CLI_FROZEN_PRODUCER_SOURCE, CANVAS_CLI_PRODUCER_FILES, CanvasCliObservationActivationSchema,
  CanvasCliObservationEventSchema, CanvasCliObservationSealSchema, CanvasCliObservationSessionSchema, CanvasCliProductionBuildSchema } from './definitions/sealedObservation';
import type { CanvasCliExecutionIdentity, CanvasObservedCliInput, CanvasObservedCliInvocation, CanvasSealedCliObservation } from './definitions';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'));
function requireEvidence(condition: boolean, code: string): asserts condition { if (!condition) throw new Error(`canvas_cli_evidence_${code}`); }
async function verifiedFile(file: string, sha256: string, bytes?: number) {
  const value = await readFile(file);
  requireEvidence(hash(value) === sha256 && (bytes === undefined || value.length === bytes), 'file_hash_or_size_mismatch');
  return value;
}
function inside(root: string, name: string) {
  requireEvidence(name !== '' && !name.includes('\\') && !path.posix.isAbsolute(name) && !path.win32.isAbsolute(name)
    && path.posix.normalize(name) === name && name !== '..' && !name.startsWith('../'), 'payload_path_outside_artifact');
  return path.resolve(root, ...name.split('/'));
}

/** 只读完整封存原件及可信安装/正式build见证；不接收模型填入的性能值或重新执行CLI。 */
export async function readSealedCanvasCliObservation(input: { readonly directory: string; readonly activationFile: string }): Promise<CanvasSealedCliObservation> {
  const directory = path.resolve(input.directory), activationFile = path.resolve(input.activationFile);
  const activation = CanvasCliObservationActivationSchema.parse(await json(activationFile));
  const sessionFile = path.join(directory, 'session.json'), sealFile = path.join(directory, 'seal.json');
  const seal = CanvasCliObservationSealSchema.parse(await json(sealFile));
  const names = (await readdir(directory)).sort(), expectedNames = [...seal.files.map(file => file.name), 'seal.json'].sort();
  requireEvidence(new Set(expectedNames).size === expectedNames.length && JSON.stringify(names) === JSON.stringify(expectedNames), 'seal_file_set_mismatch');
  const records = new Map(await Promise.all(seal.files.map(async file => [file.name, await verifiedFile(path.join(directory, file.name), file.sha256, file.bytes)] as const)));
  const sessionBytes = records.get('session.json'); requireEvidence(!!sessionBytes, 'session_missing');
  const session = CanvasCliObservationSessionSchema.parse(JSON.parse(sessionBytes.toString('utf8')));
  requireEvidence(path.resolve(activation.evidenceDirectory) === directory && path.resolve(session.evidenceDirectory) === directory
    && activation.backendPid === session.pid && session.startedAt <= activation.observedAt && activation.observedAt <= seal.finishedAt, 'activation_session_mismatch');
  for (const key of ['observationSourceRevision', 'productionSourceRevision', 'originalBackendSha256', 'payloadManifestSha256'] as const)
    requireEvidence(activation[key] === session[key], 'session_provenance_mismatch');
  const artifact = path.resolve(activation.preparedArtifactDirectory), buildFile = path.join(artifact, 'cli-observation-build.json');
  const build = CanvasCliObservationActivationSchema.pick({ observationSourceRevision: true, productionSourceRevision: true,
    originalBackendSha256: true, payloadManifestSha256: true, wrapperSha256: true, evidenceDirectory: true })
    .extend({ copiedPayloadCount: z.number().int().positive() }).strip().parse(await json(buildFile));
  for (const key of ['observationSourceRevision', 'productionSourceRevision', 'originalBackendSha256', 'payloadManifestSha256', 'wrapperSha256', 'evidenceDirectory'] as const)
    requireEvidence(activation[key] === build[key], 'prepared_build_mismatch');
  const wrapperFile = path.join(artifact, 'dist/backend/index.cjs'), backendFile = path.join(artifact, 'dist/backend/index.production.cjs');
  const payloadFile = path.join(artifact, 'cli-observation-payloads.json');
  await verifiedFile(wrapperFile, activation.wrapperSha256);
  const payloadBytes = await verifiedFile(payloadFile, activation.payloadManifestSha256);
  const payloads = z.object({ productionSourceRevision: z.string(), payloads: z.array(z.object({ originalPath: z.string(), observedPath: z.string(),
    bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()) }).strict().parse(JSON.parse(payloadBytes.toString('utf8')));
  requireEvidence(payloads.productionSourceRevision === activation.productionSourceRevision && payloads.payloads.length === build.copiedPayloadCount, 'payload_source_or_count_mismatch');
  const payloadNames = new Set<string>();
  await Promise.all(payloads.payloads.map(async entry => {
    requireEvidence(!payloadNames.has(entry.observedPath), 'duplicate_payload'); payloadNames.add(entry.observedPath);
    requireEvidence(entry.observedPath === (entry.originalPath === 'dist/backend/index.cjs' ? 'dist/backend/index.production.cjs' : entry.originalPath), 'payload_remapped');
    await verifiedFile(inside(artifact, entry.observedPath), entry.sha256, entry.bytes);
  }));
  requireEvidence(payloads.payloads.some(entry => entry.originalPath === 'dist/backend/index.cjs' && entry.sha256 === activation.originalBackendSha256), 'original_backend_mapping_missing');
  const provenanceFile = path.resolve(activation.productionBuildProvenanceFile);
  const provenanceBytes = await verifiedFile(provenanceFile, activation.productionBuildProvenanceSha256);
  const provenance = CanvasCliProductionBuildSchema.parse(JSON.parse(provenanceBytes.toString('utf8')));
  requireEvidence(activation.productionSourceRevision === CANVAS_CLI_FROZEN_PRODUCER_SOURCE && provenance.sourceRevision === activation.productionSourceRevision
    && provenance.originalBackendSha256 === activation.originalBackendSha256 && provenance.completedAt <= session.startedAt, 'unreviewed_producer_source');
  const logFile = path.resolve(provenance.logFile); await verifiedFile(logFile, provenance.logSha256);
  const sourceFiles = await Promise.all(Object.entries(CANVAS_CLI_PRODUCER_FILES).map(async ([name, sha256]) => {
    const file = inside(path.resolve(provenance.producerSourceDirectory), name); await verifiedFile(file, sha256); return file;
  }));
  // 源指纹、正式build记录和实际已装载compiled SHA三者闭合后才允许解释fresh-null。
  const eventNames = names.filter(name => /^\d/.test(name)).sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
  requireEvidence(eventNames.every((name, index) => name === `${String(index + 1).padStart(6, '0')}.json`), 'event_sequence_gap');
  const pending = new Map<number, { input: CanvasObservedCliInput; preparedAt: number; phase: 'prepare' | 'ready' | 'execute' | 'closed';
    execution?: { identity: CanvasCliExecutionIdentity; startedAt: number }; files: string[] }>();
  const invocations: CanvasObservedCliInvocation[] = [];
  let lastAt = session.startedAt;
  for (const name of eventNames) {
    const file = path.join(directory, name), bytes = records.get(name); requireEvidence(!!bytes, 'event_missing');
    const event = CanvasCliObservationEventSchema.parse(JSON.parse(bytes.toString('utf8')));
    requireEvidence(event.observedAt >= lastAt && event.observedAt <= seal.finishedAt, 'event_clock_order'); lastAt = event.observedAt;
    if (event.kind === 'prepare-start') {
      requireEvidence(event.id === pending.size + 1, 'invocation_sequence_gap');
      pending.set(event.id, { input: event.facts.input, preparedAt: event.observedAt, phase: 'prepare', files: [file] }); continue;
    }
    const row = pending.get(event.id); requireEvidence(!!row && row.phase !== 'closed', 'event_without_open_invocation'); row.files.push(file);
    if (event.kind === 'prepare-ready') { requireEvidence(row.phase === 'prepare', 'prepare_phase_mismatch'); row.phase = 'ready'; continue; }
    if (event.kind === 'execute-start') {
      requireEvidence(row.phase === 'ready', 'execute_phase_mismatch'); row.phase = 'execute'; row.execution = { identity: event.facts.identity, startedAt: event.observedAt }; continue;
    }
    const stage = event.kind === 'prepare-result' || event.kind === 'prepare-threw' ? 'prepare' : 'execute';
    requireEvidence(row.phase === stage && (stage === 'prepare' || !!row.execution), 'terminal_phase_mismatch');
    invocations.push({ origin: 'backend-cli-observation', recordingId: event.id, invocationId: row.input.invocationId, input: row.input,
      preparedAt: row.preparedAt, startedAt: row.execution?.startedAt ?? null, finishedAt: event.observedAt, stage,
      identity: row.execution?.identity ?? null, result: 'result' in event.facts ? event.facts.result : null,
      threw: event.kind === 'prepare-threw' || event.kind === 'execute-threw', sourceFiles: [...row.files] });
    row.phase = 'closed';
  }
  requireEvidence(pending.size === seal.invocations && invocations.length === seal.invocations && [...pending.values()].every(row => row.phase === 'closed'), 'invocation_ledger_incomplete');
  return { activation, session, finishedAt: seal.finishedAt, invocations, producerContract: 'source61-fresh-committed-null-iff-no-arrange',
    evidenceFiles: [activationFile, sessionFile, sealFile, buildFile, wrapperFile, backendFile, payloadFile, provenanceFile, logFile,
      ...sourceFiles, ...eventNames.map(name => path.join(directory, name)), ...payloads.payloads.map(entry => inside(artifact, entry.observedPath))] };
}
