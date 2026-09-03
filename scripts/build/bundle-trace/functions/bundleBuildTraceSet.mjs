function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function assertTrace(trace, fileName) {
  if (
    !trace
    || typeof trace !== 'object'
    || Array.isArray(trace)
    || trace.kind !== 'linnya-bundle-build-trace'
    || trace.schemaVersion !== 1
    || typeof trace.buildTarget !== 'string'
    || !Array.isArray(trace.buildInputs)
    || !Array.isArray(trace.outputs)
  ) {
    throw new Error(`bundle trace 合同无效：${fileName}`);
  }
}

export function createBundleBuildTraceSet({
  identity,
  requiredBuildTargets,
  requiredBuildTargetPrefixes,
  source,
  traceFiles,
}) {
  if (traceFiles.length === 0) throw new Error('bundle trace set 不能为空');
  const traces = traceFiles.map(({ fileName, sha256, trace }) => {
    assertTrace(trace, fileName);
    const npmPackages = sortedUnique(
      trace.buildInputs
        .filter(input => input.kind === 'npm-package')
        .map(input => `${input.packageName}@${input.packageVersion}`),
    );
    return {
      buildTarget: trace.buildTarget,
      fileName,
      inputCount: trace.buildInputs.length,
      npmPackageCount: npmPackages.length,
      outputCount: trace.outputs.length,
      sha256,
      tool: trace.tool,
    };
  }).sort((left, right) => left.buildTarget.localeCompare(right.buildTarget));
  const buildTargets = traces.map(trace => trace.buildTarget);
  if (new Set(buildTargets).size !== buildTargets.length) {
    throw new Error('bundle trace set 含重复 build target');
  }
  const missingTargets = requiredBuildTargets.filter(target => !buildTargets.includes(target));
  const missingPrefixes = requiredBuildTargetPrefixes.filter(prefix => (
    !buildTargets.some(target => target.startsWith(prefix))
  ));
  if (missingTargets.length > 0 || missingPrefixes.length > 0) {
    throw new Error(
      `bundle trace set 缺少生产 target：${[...missingTargets, ...missingPrefixes.map(prefix => `${prefix}*`)].join(', ')}`,
    );
  }
  const allNpmPackages = new Set();
  let outputCount = 0;
  for (const { trace } of traceFiles) {
    outputCount += trace.outputs.length;
    for (const input of trace.buildInputs) {
      if (input.kind === 'npm-package') {
        allNpmPackages.add(`${input.packageName}@${input.packageVersion}`);
      }
    }
  }
  return {
    schemaVersion: 1,
    kind: 'linnya-bundle-build-trace-set',
    identity,
    source,
    traces,
    summary: {
      traceFileCount: traces.length,
      buildTargetCount: buildTargets.length,
      outputCount,
      npmPackageCount: allNpmPackages.size,
    },
    limitations: ['artifact-output-occurrences-not-yet-linked'],
  };
}
