import type { BundleBuildTrace } from '../../build/bundle-trace/definitions/bundleBuildTrace.mjs';
import type { BundleBuildTraceSet } from '../../build/bundle-trace/definitions/bundleBuildTraceSet.mjs';
import type {
  ArtifactContentBom,
  ArtifactContentEntry,
} from '../definitions/artifactContentBom';
import type {
  ArtifactBundleComponentMap,
  ArtifactBundleNpmComponent,
  ArtifactBundleOccurrence,
} from '../definitions/artifactBundleComponentMap';

interface BundleTraceEvidence {
  readonly fileName: string;
  readonly trace: BundleBuildTrace;
}

interface TraceOutputEvidence {
  readonly buildTarget: string;
  readonly fileName: string;
  readonly output: BundleBuildTrace['outputs'][number];
}

const COMPILED_ARTIFACT_EXTENSION = /\.(?:cjs|css|html|js|jsc|mjs)$/iu;

function sortStrings(left: string, right: string): number {
  return left.localeCompare(right);
}

function outputKey(outputPath: string, sha256: string): string {
  return `${outputPath}\0${sha256}`;
}

function resolveTracePathForArtifactEntry(entry: ArtifactContentEntry): string | undefined {
  if (entry.scope === 'app-asar') return entry.path;
  const unpackedMatch = entry.path.match(/(?:^|\/)resources\/app\.asar\.unpacked\/(.+)$/iu);
  if (unpackedMatch) return unpackedMatch[1];
  const pluginMatch = entry.path.match(/(?:^|\/)resources\/plugins\/([^/]+)\/(.+)$/iu);
  if (!pluginMatch) return undefined;
  return `packages/plugins/${pluginMatch[1]}/${pluginMatch[2]}`;
}

function isUnmatchedCompiledCandidate(entry: ArtifactContentEntry): boolean {
  if (entry.type !== 'file' || !COMPILED_ARTIFACT_EXTENSION.test(entry.path)) return false;
  if (entry.scope === 'app-asar') {
    return !entry.path.startsWith('node_modules/');
  }
  return /(?:^|\/)resources\/plugins\/[^/]+\/dist\//iu.test(entry.path)
    && !/(?:^|\/)node_modules\//u.test(entry.path);
}

function assertSameArtifactIdentity(
  contentBom: ArtifactContentBom,
  traceSet: BundleBuildTraceSet,
): void {
  if (
    contentBom.identity.platform !== traceSet.identity.platform
    || contentBom.identity.architecture !== traceSet.identity.architecture
    || contentBom.source.revision !== traceSet.source.revision
    || contentBom.source.dirty !== traceSet.source.dirty
  ) {
    throw new Error('Desktop content BOM 与 bundle trace set 的构建身份不一致');
  }
}

function createNpmComponents(traces: readonly BundleTraceEvidence[]): readonly ArtifactBundleNpmComponent[] {
  const components = new Map<string, {
    readonly buildTargets: Set<string>;
    readonly name: string;
    readonly version: string;
  }>();
  for (const { trace } of traces) {
    for (const input of trace.buildInputs) {
      if (input.kind !== 'npm-package' || !input.packageName || !input.packageVersion) continue;
      const id = `${input.packageName}@${input.packageVersion}`;
      const existing = components.get(id) ?? {
        buildTargets: new Set<string>(),
        name: input.packageName,
        version: input.packageVersion,
      };
      existing.buildTargets.add(trace.buildTarget);
      components.set(id, existing);
    }
  }
  return [...components.entries()]
    .map(([id, component]) => ({
      id,
      name: component.name,
      version: component.version,
      buildTargets: [...component.buildTargets].sort(sortStrings),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function sample(paths: readonly string[]): readonly string[] {
  return [...paths].sort(sortStrings).slice(0, 12);
}

export function createArtifactBundleComponentMap(input: {
  readonly bundleTraceSet: BundleBuildTraceSet;
  readonly bundleTraceSetSha256: string;
  readonly contentBom: ArtifactContentBom;
  readonly contentBomSha256: string;
  readonly traces: readonly BundleTraceEvidence[];
}): ArtifactBundleComponentMap {
  assertSameArtifactIdentity(input.contentBom, input.bundleTraceSet);
  const traceByFileName = new Map(input.traces.map(trace => [trace.fileName, trace]));
  const traceOutputs: TraceOutputEvidence[] = [];
  for (const traceSummary of input.bundleTraceSet.traces) {
    const evidence = traceByFileName.get(traceSummary.fileName);
    if (!evidence || evidence.trace.buildTarget !== traceSummary.buildTarget) {
      throw new Error(`bundle trace set 缺少已登记文件：${traceSummary.fileName}`);
    }
    for (const output of evidence.trace.outputs) {
      traceOutputs.push({
        buildTarget: evidence.trace.buildTarget,
        fileName: evidence.fileName,
        output,
      });
    }
  }
  const outputsByKey = new Map<string, TraceOutputEvidence[]>();
  const outputsBySha256 = new Map<string, TraceOutputEvidence[]>();
  for (const output of traceOutputs) {
    const key = outputKey(output.output.path, output.output.sha256);
    const candidates = outputsByKey.get(key) ?? [];
    candidates.push(output);
    outputsByKey.set(key, candidates);
    const sameHash = outputsBySha256.get(output.output.sha256) ?? [];
    sameHash.push(output);
    outputsBySha256.set(output.output.sha256, sameHash);
  }
  const distributedOutputKeys = new Set<string>();
  const matchedArtifactEntryKeys = new Set<string>();
  const occurrences: ArtifactBundleOccurrence[] = [];
  for (const entry of input.contentBom.entries) {
    if (entry.type !== 'file') continue;
    const tracePath = resolveTracePathForArtifactEntry(entry);
    if (entry.scope !== 'app-asar' && entry.scope !== 'app-filesystem') continue;
    const key = tracePath ? outputKey(tracePath, entry.sha256) : undefined;
    const pathCandidates = key ? outputsByKey.get(key) ?? [] : [];
    // electron-builder 可在 extraResources 中重定位 bundle。只有路径无法对应且
    // SHA-256 在整个 trace set 唯一时才接受 relocation，避免同内容文件被猜 owner。
    const candidates = tracePath ? pathCandidates : outputsBySha256.get(entry.sha256) ?? [];
    if (candidates.length > 1) {
      throw new Error(`artifact bundle occurrence 对应多个 trace output：${entry.path}`);
    }
    const candidate = candidates[0];
    if (!candidate) continue;
    distributedOutputKeys.add(outputKey(candidate.output.path, candidate.output.sha256));
    matchedArtifactEntryKeys.add(`${entry.scope}\0${entry.path}`);
    occurrences.push({
      artifactPath: entry.path,
      artifactScope: entry.scope,
      buildTarget: candidate.buildTarget,
      inputAttribution: candidate.output.inputAttribution,
      sha256: entry.sha256,
      traceFileName: candidate.fileName,
      traceOutputPath: candidate.output.path,
    });
  }
  const intermediateOutputKeys = new Set<string>();
  for (const { trace } of input.traces) {
    for (const buildInput of trace.buildInputs) {
      if (buildInput.kind !== 'bundle-output' || !buildInput.sha256) continue;
      const key = outputKey(buildInput.path, buildInput.sha256);
      if (!outputsByKey.has(key)) {
        throw new Error(`派生 bundle input 没有上游 trace output：${buildInput.path}`);
      }
      intermediateOutputKeys.add(key);
    }
  }
  const nonBundleCodeArtifacts = input.contentBom.entries.filter(entry => (
    isUnmatchedCompiledCandidate(entry)
    && !matchedArtifactEntryKeys.has(`${entry.scope}\0${entry.path}`)
  ));
  const unusedTraceOutputs = traceOutputs.filter(({ output }) => {
    const key = outputKey(output.path, output.sha256);
    return !distributedOutputKeys.has(key) && !intermediateOutputKeys.has(key);
  });
  const components = createNpmComponents(input.traces);
  const limitations: ArtifactBundleComponentMap['limitations'] = [
    {
      code: 'non-bundle-code-artifact-not-attributed',
      entryCount: nonBundleCodeArtifacts.length,
      pathSamples: sample(nonBundleCodeArtifacts.map(entry => `${entry.scope}:${entry.path}`)),
    },
    {
      code: 'trace-output-not-distributed-or-used-as-intermediate',
      entryCount: unusedTraceOutputs.length,
      pathSamples: sample(unusedTraceOutputs.map(output => (
        `${output.buildTarget}:${output.output.path}`
      ))),
    },
    {
      code: 'bundle-package-legal-evidence-not-attached',
      entryCount: components.length,
      pathSamples: [],
    },
  ];
  return {
    schemaVersion: 1,
    kind: 'linnya-desktop-artifact-bundle-component-map',
    identity: input.contentBom.identity,
    source: input.contentBom.source,
    environment: input.contentBom.environment,
    contentBomSha256: input.contentBomSha256,
    contentTreeSha256: input.contentBom.summary.treeSha256,
    bundleTraceSetSha256: input.bundleTraceSetSha256,
    occurrences: occurrences.sort((left, right) => (
      `${left.artifactScope}:${left.artifactPath}`.localeCompare(
        `${right.artifactScope}:${right.artifactPath}`,
      )
    )),
    components,
    limitations,
    summary: {
      artifactOccurrenceCount: occurrences.length,
      buildTargetCount: input.bundleTraceSet.summary.buildTargetCount,
      intermediateOutputCount: intermediateOutputKeys.size,
      npmPackageComponentCount: components.length,
      traceOutputCount: traceOutputs.length,
    },
  };
}
