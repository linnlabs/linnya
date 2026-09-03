import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BUNDLE_TRACE_ROOT_ENV = 'LINNYA_BUNDLE_TRACE_ROOT';

const normalizeSlashes = value => value.replaceAll('\\', '/');
const sortStrings = (left, right) => left.localeCompare(right);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function normalizeRelativePath(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!isPathInside(root, candidate)) return undefined;
  return normalizeSlashes(relative || '.');
}

function stripModuleDecorators(moduleId) {
  const withoutNullPrefix = moduleId.replace(/^\0/u, '');
  const queryIndex = withoutNullPrefix.indexOf('?');
  return queryIndex === -1 ? withoutNullPrefix : withoutNullPrefix.slice(0, queryIndex);
}

function resolvePhysicalModulePath(moduleId, workingDirectory) {
  const stripped = stripModuleDecorators(moduleId);
  if (!stripped || stripped.startsWith('<') || stripped.startsWith('virtual:')) return undefined;
  const filePath = path.isAbsolute(stripped) ? stripped : path.resolve(workingDirectory, stripped);
  try {
    return fs.statSync(filePath).isFile() ? filePath : undefined;
  } catch {
    return undefined;
  }
}

function findNodeModulePackageRoot(filePath) {
  const normalized = normalizeSlashes(filePath);
  const marker = '/node_modules/';
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1) return undefined;
  const packageStart = markerIndex + marker.length;
  const segments = normalized.slice(packageStart).split('/');
  const packageSegmentCount = segments[0]?.startsWith('@') ? 2 : 1;
  if (segments.length < packageSegmentCount) return undefined;
  return normalized.slice(0, packageStart) + segments.slice(0, packageSegmentCount).join('/');
}

function readPackageIdentity(packageRoot) {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (
      manifest
      && typeof manifest === 'object'
      && !Array.isArray(manifest)
      && typeof manifest.name === 'string'
      && typeof manifest.version === 'string'
      && manifest.name
      && manifest.version
    ) {
      return { name: manifest.name, version: manifest.version };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function createTraceInput({ moduleId, repositoryRoot, workingDirectory }) {
  const physicalPath = resolvePhysicalModulePath(moduleId, workingDirectory);
  if (!physicalPath) {
    const normalizedModuleId = normalizeSlashes(moduleId);
    const virtualPath = normalizedModuleId.includes(normalizeSlashes(repositoryRoot))
      ? normalizedModuleId.replaceAll(normalizeSlashes(repositoryRoot), '<repository>')
      : path.isAbsolute(stripModuleDecorators(moduleId))
        ? `<external-virtual>/${path.basename(stripModuleDecorators(moduleId))}`
        : normalizedModuleId;
    return {
      id: `virtual:${virtualPath}`,
      kind: 'virtual',
      path: virtualPath,
    };
  }
  const bytes = fs.readFileSync(physicalPath);
  const packageRoot = findNodeModulePackageRoot(physicalPath);
  const packageIdentity = packageRoot ? readPackageIdentity(packageRoot) : undefined;
  if (packageRoot && packageIdentity) {
    const packageRelativePath = normalizeSlashes(path.relative(packageRoot, physicalPath));
    const identity = `${packageIdentity.name}@${packageIdentity.version}`;
    return {
      id: `npm:${identity}:${packageRelativePath}`,
      kind: 'npm-package',
      packageName: packageIdentity.name,
      packageVersion: packageIdentity.version,
      path: packageRelativePath,
      sha256: sha256(bytes),
      size: bytes.byteLength,
    };
  }
  const repositoryRelativePath = normalizeRelativePath(repositoryRoot, physicalPath);
  if (repositoryRelativePath) {
    return {
      id: `workspace:${repositoryRelativePath}`,
      kind: 'workspace-source',
      path: repositoryRelativePath,
      sha256: sha256(bytes),
      size: bytes.byteLength,
    };
  }
  return {
    id: `external:${path.basename(physicalPath)}:${sha256(bytes)}`,
    kind: 'external-source',
    path: path.basename(physicalPath),
    sha256: sha256(bytes),
    size: bytes.byteLength,
  };
}

function normalizeTraceRoot(repositoryRoot, environment) {
  const configuredRoot = environment[BUNDLE_TRACE_ROOT_ENV];
  if (!configuredRoot) return undefined;
  const traceRoot = path.resolve(repositoryRoot, configuredRoot);
  for (const packagedRoot of ['dist', 'dist_build', 'extraResources']) {
    const absolutePackagedRoot = path.join(repositoryRoot, packagedRoot);
    if (isPathInside(absolutePackagedRoot, traceRoot)) {
      throw new Error(`${BUNDLE_TRACE_ROOT_ENV} 不能位于会进入发布制品的目录：${packagedRoot}`);
    }
  }
  return traceRoot;
}

function assertSafeBuildTarget(buildTarget) {
  if (!/^[a-z0-9][a-z0-9._/-]*$/u.test(buildTarget) || buildTarget.includes('..')) {
    throw new Error(`bundle trace build target 无效：${buildTarget}`);
  }
}

function traceFileName(buildTarget) {
  return `${buildTarget.replaceAll('/', '__')}.bundle-trace.json`;
}

function writeTrace({ trace, repositoryRoot, environment }) {
  const traceRoot = normalizeTraceRoot(repositoryRoot, environment);
  if (!traceRoot) return undefined;
  assertSafeBuildTarget(trace.buildTarget);
  fs.mkdirSync(traceRoot, { recursive: true });
  const outputPath = path.join(traceRoot, traceFileName(trace.buildTarget));
  fs.writeFileSync(outputPath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  return outputPath;
}

function createBuildInputs(moduleIds, repositoryRoot, workingDirectory) {
  const inputsById = new Map();
  for (const moduleId of [...moduleIds].sort(sortStrings)) {
    const input = createTraceInput({ moduleId, repositoryRoot, workingDirectory });
    inputsById.set(input.id, input);
  }
  return [...inputsById.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeExternalImport(importRecord, repositoryRoot, workingDirectory) {
  const importPath = importRecord.path;
  if (path.isAbsolute(importPath)) {
    return {
      kind: importRecord.kind,
      path: normalizeRelativePath(repositoryRoot, importPath) ?? path.basename(importPath),
    };
  }
  const absoluteCandidate = path.resolve(workingDirectory, importPath);
  return {
    kind: importRecord.kind,
    path: normalizeRelativePath(repositoryRoot, absoluteCandidate) ?? normalizeSlashes(importPath),
  };
}

function normalizeOutputPath(outputPath, repositoryRoot, workingDirectory) {
  const absoluteOutput = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(workingDirectory, outputPath);
  const relative = normalizeRelativePath(repositoryRoot, absoluteOutput);
  if (!relative) throw new Error(`bundle output 位于仓库之外：${path.basename(outputPath)}`);
  return { absoluteOutput, relative };
}

function normalizeEntryPoint(entryPoint, repositoryRoot, workingDirectory) {
  if (!entryPoint) return undefined;
  const strippedEntryPoint = stripModuleDecorators(entryPoint);
  const absoluteEntry = path.isAbsolute(strippedEntryPoint)
    ? strippedEntryPoint
    : path.resolve(workingDirectory, strippedEntryPoint);
  return normalizeRelativePath(repositoryRoot, absoluteEntry)
    ?? `<external-entry>/${path.basename(strippedEntryPoint)}`;
}

export function isBundleTraceEnabled(environment = process.env) {
  return typeof environment[BUNDLE_TRACE_ROOT_ENV] === 'string'
    && environment[BUNDLE_TRACE_ROOT_ENV].length > 0;
}

export function writeEsbuildBundleTrace({
  buildTarget,
  engineVersion,
  environment = process.env,
  inputAttribution = 'module-contribution',
  metafile,
  repositoryRoot,
  toolName = 'esbuild',
  toolVersion,
  workingDirectory,
}) {
  if (!isBundleTraceEnabled(environment)) return undefined;
  const buildInputs = createBuildInputs(Object.keys(metafile.inputs), repositoryRoot, workingDirectory);
  const inputIdsByModuleId = new Map(
    Object.keys(metafile.inputs).map(moduleId => {
      const input = createTraceInput({ moduleId, repositoryRoot, workingDirectory });
      return [moduleId, input.id];
    }),
  );
  const outputs = Object.entries(metafile.outputs)
    .map(([outputPath, output]) => {
      const normalizedOutput = normalizeOutputPath(outputPath, repositoryRoot, workingDirectory);
      const bytes = fs.readFileSync(normalizedOutput.absoluteOutput);
      if (inputAttribution === 'module-contribution' && bytes.byteLength !== output.bytes) {
        throw new Error(`esbuild metafile 与输出大小不一致：${normalizedOutput.relative}`);
      }
      return {
        type: 'chunk',
        path: normalizedOutput.relative,
        size: bytes.byteLength,
        sha256: sha256(bytes),
        entryPoint: normalizeEntryPoint(output.entryPoint, repositoryRoot, workingDirectory),
        inputAttribution,
        inputs: Object.entries(output.inputs)
          .map(([moduleId, contribution]) => ({
            inputId: inputIdsByModuleId.get(moduleId),
            bytesInOutput: contribution.bytesInOutput,
          }))
          .filter(contribution => typeof contribution.inputId === 'string')
          .sort((left, right) => left.inputId.localeCompare(right.inputId)),
        externalImports: output.imports
          .filter(importRecord => importRecord.external === true)
          .map(importRecord => normalizeExternalImport(importRecord, repositoryRoot, workingDirectory))
          .sort((left, right) => `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`)),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const trace = {
    schemaVersion: 1,
    kind: 'linnya-bundle-build-trace',
    buildTarget,
    tool: toolName === 'tsup'
      ? {
          name: 'tsup',
          version: toolVersion,
          engine: { name: 'esbuild', version: engineVersion },
        }
      : { name: 'esbuild', version: toolVersion },
    workingDirectory: normalizeRelativePath(repositoryRoot, workingDirectory) ?? '.',
    buildInputs,
    outputs,
  };
  return writeTrace({ trace, repositoryRoot, environment });
}

function outputBytes(output) {
  if (output.type === 'chunk' && typeof output.code === 'string') return Buffer.from(output.code);
  if (output.type === 'asset' && typeof output.source === 'string') return Buffer.from(output.source);
  if (output.type === 'asset' && output.source instanceof Uint8Array) return Buffer.from(output.source);
  throw new Error(`Vite output 缺少可 hash 内容：${output.fileName}`);
}

export function writeViteBundleTrace({
  buildInputs: moduleIds,
  buildTarget,
  environment = process.env,
  outputDirectory,
  outputs: outputBundle,
  repositoryRoot,
  toolVersion,
  workingDirectory,
}) {
  if (!isBundleTraceEnabled(environment)) return undefined;
  const buildInputs = createBuildInputs(moduleIds, repositoryRoot, workingDirectory);
  const inputByModuleId = new Map(
    moduleIds.map(moduleId => {
      const input = createTraceInput({ moduleId, repositoryRoot, workingDirectory });
      return [moduleId, input.id];
    }),
  );
  const outputs = Object.values(outputBundle)
    .map(output => {
      const bytes = outputBytes(output);
      const normalizedOutput = normalizeOutputPath(
        path.join(outputDirectory, output.fileName),
        repositoryRoot,
        workingDirectory,
      );
      const writtenBytes = fs.readFileSync(normalizedOutput.absoluteOutput);
      if (!writtenBytes.equals(bytes)) {
        throw new Error(`Vite writeBundle 内容与磁盘输出不一致：${normalizedOutput.relative}`);
      }
      const moduleEntries = output.type === 'chunk' && output.modules
        ? Object.entries(output.modules)
        : [];
      const inputContributions = output.type === 'asset'
        ? buildInputs.map(input => ({ inputId: input.id }))
        : moduleEntries
            .map(([moduleId, contribution]) => ({
              inputId: inputByModuleId.get(moduleId),
              bytesInOutput: contribution.renderedLength,
            }))
            .filter(contribution => typeof contribution.inputId === 'string');
      const imports = output.type === 'chunk'
        ? [...(output.imports ?? []), ...(output.dynamicImports ?? [])]
        : [];
      return {
        type: output.type,
        path: normalizedOutput.relative,
        size: writtenBytes.byteLength,
        sha256: sha256(writtenBytes),
        entryPoint: normalizeEntryPoint(output.facadeModuleId ?? undefined, repositoryRoot, workingDirectory),
        inputAttribution: output.type === 'chunk' ? 'module-contribution' : 'build-wide',
        inputs: inputContributions.sort((left, right) => left.inputId.localeCompare(right.inputId)),
        externalImports: imports
          .map(importPath => ({ kind: 'import-statement', path: normalizeSlashes(importPath) }))
          .sort((left, right) => left.path.localeCompare(right.path)),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const trace = {
    schemaVersion: 1,
    kind: 'linnya-bundle-build-trace',
    buildTarget,
    tool: { name: 'vite-rollup', version: toolVersion },
    workingDirectory: normalizeRelativePath(repositoryRoot, workingDirectory) ?? '.',
    buildInputs,
    outputs,
  };
  return writeTrace({ trace, repositoryRoot, environment });
}

export function writeDerivedBundleTrace({
  buildTarget,
  environment = process.env,
  inputPath,
  outputPath,
  repositoryRoot,
  toolName,
  toolVersion,
}) {
  if (!isBundleTraceEnabled(environment)) return undefined;
  const normalizedInput = normalizeOutputPath(inputPath, repositoryRoot, repositoryRoot);
  const normalizedOutput = normalizeOutputPath(outputPath, repositoryRoot, repositoryRoot);
  const inputBytes = fs.readFileSync(normalizedInput.absoluteOutput);
  const outputBytes = fs.readFileSync(normalizedOutput.absoluteOutput);
  const inputId = `bundle-output:${normalizedInput.relative}:${sha256(inputBytes)}`;
  const trace = {
    schemaVersion: 1,
    kind: 'linnya-bundle-build-trace',
    buildTarget,
    tool: { name: toolName, version: toolVersion },
    workingDirectory: '.',
    buildInputs: [{
      id: inputId,
      kind: 'bundle-output',
      path: normalizedInput.relative,
      sha256: sha256(inputBytes),
      size: inputBytes.byteLength,
    }],
    outputs: [{
      type: 'chunk',
      path: normalizedOutput.relative,
      size: outputBytes.byteLength,
      sha256: sha256(outputBytes),
      inputAttribution: 'derived-output',
      inputs: [{ inputId }],
      externalImports: [],
    }],
  };
  return writeTrace({ trace, repositoryRoot, environment });
}
