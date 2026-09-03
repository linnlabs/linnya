import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LINNKIT_SOURCE_PROVENANCE_FILE,
  type LinnkitProjectionEntry,
} from '../definitions/linnkitProjection';
import {
  createLinnkitSourceProvenance,
  shouldExportLinnkitPath,
} from '../functions/linnkitProjection';

const releaseDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(releaseDirectory, '..', '..', '..');
const TARGET_OWNED_PATHS = new Set(['.gitignore']);
const TARGET_OWNED_PREFIXES = ['.git/', '.github/'] as const;
// 独立发布仓需要先安装、构建和测试，再允许重复校验同一投影。
// 这些路径由本地命令生成且已被发布仓 .gitignore 排除，不属于源码投影内容。
const TARGET_LOCAL_ARTIFACT_DIRECTORY_NAMES = new Set(['node_modules', 'dist', 'coverage']);

interface PackageManifest {
  readonly name: string;
  readonly version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runGit(repositoryRoot: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8' }).trim();
}

function readPackageManifest(filePath: string): PackageManifest {
  const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!isRecord(value)) throw new Error('Linnkit package.json 不是对象。');
  if (typeof value.name !== 'string' || typeof value.version !== 'string') {
    throw new Error('Linnkit package.json 缺少 name 或 version。');
  }
  return { name: value.name, version: value.version };
}

function assertEmptyTarget(targetRoot: string): void {
  if (!fs.existsSync(targetRoot)) {
    fs.mkdirSync(targetRoot, { recursive: true });
    return;
  }
  if (!fs.statSync(targetRoot).isDirectory()) throw new Error(`目标不是目录：${targetRoot}`);
  if (fs.readdirSync(targetRoot).length > 0) throw new Error(`目标目录必须为空：${targetRoot}`);
}

function removeExcludedProjectionPaths(root: string): void {
  const visit = (currentRoot: string): void => {
    for (const item of fs.readdirSync(currentRoot, { withFileTypes: true })) {
      const absolutePath = path.join(currentRoot, item.name);
      const projectedPath = path.relative(root, absolutePath).split(path.sep).join('/');
      if (!shouldExportLinnkitPath(projectedPath)) {
        fs.rmSync(absolutePath, { recursive: true, force: true });
      } else if (item.isDirectory()) {
        visit(absolutePath);
        if (fs.readdirSync(absolutePath).length === 0) fs.rmdirSync(absolutePath);
      }
    }
  };
  visit(root);
}

function readProjectionEntries(
  root: string,
  options: { readonly ignoreTargetLocalArtifacts?: boolean } = {}
): readonly LinnkitProjectionEntry[] {
  const entries: LinnkitProjectionEntry[] = [];
  const visit = (currentRoot: string): void => {
    for (const item of fs.readdirSync(currentRoot, { withFileTypes: true })) {
      const absolutePath = path.join(currentRoot, item.name);
      const projectedPath = path.relative(root, absolutePath).split(path.sep).join('/');
      if (projectedPath === LINNKIT_SOURCE_PROVENANCE_FILE) continue;
      if (TARGET_OWNED_PATHS.has(projectedPath)) continue;
      if (TARGET_OWNED_PREFIXES.some(prefix => `${projectedPath}/`.startsWith(prefix))) continue;
      if (
        options.ignoreTargetLocalArtifacts &&
        projectedPath.split('/').some(segment => TARGET_LOCAL_ARTIFACT_DIRECTORY_NAMES.has(segment))
      ) {
        continue;
      }
      if (item.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!item.isFile()) throw new Error(`投影中不允许符号链接或特殊文件：${projectedPath}`);
      entries.push({
        path: projectedPath,
        mode: (fs.statSync(absolutePath).mode & 0o111) !== 0 ? '100755' : '100644',
        content: fs.readFileSync(absolutePath),
      });
    }
  };
  visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function resolveSourceRepository(repositoryRoot: string, explicit?: string): string {
  return explicit || runGit(repositoryRoot, ['config', '--get', 'remote.origin.url']);
}

function exportProjection(input: {
  readonly targetRoot: string;
  readonly repositoryRoot: string;
  readonly sourceRef: string;
  readonly sourceRepository?: string;
}): void {
  assertEmptyTarget(input.targetRoot);
  const sourceCommit = runGit(input.repositoryRoot, ['rev-parse', `${input.sourceRef}^{commit}`]);
  const archive = execFileSync(
    'git',
    ['-C', input.repositoryRoot, 'archive', '--format=tar', sourceCommit, 'packages/linnkit'],
    { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 }
  );
  execFileSync('tar', ['-xf', '-', '-C', input.targetRoot, '--strip-components=2'], {
    input: archive,
  });
  removeExcludedProjectionPaths(input.targetRoot);

  const entries = readProjectionEntries(input.targetRoot);
  const manifest = readPackageManifest(path.join(input.targetRoot, 'package.json'));
  const provenance = createLinnkitSourceProvenance({
    sourceRepository: resolveSourceRepository(input.repositoryRoot, input.sourceRepository),
    sourceCommit,
    packageName: manifest.name,
    packageVersion: manifest.version,
    entries,
  });
  fs.writeFileSync(
    path.join(input.targetRoot, LINNKIT_SOURCE_PROVENANCE_FILE),
    `${JSON.stringify(provenance, null, 2)}\n`
  );
}

function compareProjectionDirectories(expectedRoot: string, actualRoot: string): void {
  const expectedEntries = readProjectionEntries(expectedRoot);
  const actualEntries = readProjectionEntries(actualRoot, { ignoreTargetLocalArtifacts: true });
  if (expectedEntries.length !== actualEntries.length) {
    throw new Error(
      `Linnkit 投影文件数漂移：expected=${expectedEntries.length}, actual=${actualEntries.length}`
    );
  }
  for (let index = 0; index < expectedEntries.length; index += 1) {
    const expected = expectedEntries[index];
    const actual = actualEntries[index];
    if (
      expected.path !== actual.path ||
      expected.mode !== actual.mode ||
      !expected.content.equals(actual.content)
    ) {
      throw new Error(`Linnkit 投影内容漂移：expected=${expected.path}, actual=${actual.path}`);
    }
  }
  const expectedProvenance = fs.readFileSync(
    path.join(expectedRoot, LINNKIT_SOURCE_PROVENANCE_FILE),
    'utf8'
  );
  const actualProvenance = fs.readFileSync(
    path.join(actualRoot, LINNKIT_SOURCE_PROVENANCE_FILE),
    'utf8'
  );
  if (expectedProvenance !== actualProvenance) throw new Error('Linnkit 来源 provenance 漂移。');
}

function withTemporaryRoot(run: (temporaryRoot: string) => void): void {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnkit-projection-'));
  try {
    run(temporaryRoot);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function verifyProjection(input: {
  readonly targetRoot: string;
  readonly repositoryRoot: string;
  readonly sourceRef: string;
  readonly sourceRepository?: string;
}): void {
  withTemporaryRoot(temporaryRoot => {
    const expectedRoot = path.join(temporaryRoot, 'expected');
    exportProjection({ ...input, targetRoot: expectedRoot });
    compareProjectionDirectories(expectedRoot, input.targetRoot);
  });
}

function runSmoke(repositoryRoot: string): void {
  withTemporaryRoot(temporaryRoot => {
    const firstRoot = path.join(temporaryRoot, 'first');
    const secondRoot = path.join(temporaryRoot, 'second');
    exportProjection({ targetRoot: firstRoot, repositoryRoot, sourceRef: 'HEAD' });
    exportProjection({ targetRoot: secondRoot, repositoryRoot, sourceRef: 'HEAD' });
    compareProjectionDirectories(firstRoot, secondRoot);
    verifyProjection({ targetRoot: firstRoot, repositoryRoot, sourceRef: 'HEAD' });

    fs.mkdirSync(path.join(firstRoot, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(firstRoot, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    fs.writeFileSync(path.join(firstRoot, '.gitignore'), 'node_modules/\n');
    verifyProjection({ targetRoot: firstRoot, repositoryRoot, sourceRef: 'HEAD' });

    for (const localArtifactPath of [
      'node_modules/dependency/package.json',
      'dist/index.js',
      'coverage/index.html',
      'packages/legacy/node_modules/dependency/package.json',
      'packages/legacy/dist/index.js',
    ]) {
      const absolutePath = path.join(firstRoot, localArtifactPath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, 'local only\n');
    }
    verifyProjection({ targetRoot: firstRoot, repositoryRoot, sourceRef: 'HEAD' });

    fs.appendFileSync(path.join(firstRoot, 'README.md'), '\nmanual drift\n');
    let rejectedSourceDrift = false;
    try {
      verifyProjection({ targetRoot: firstRoot, repositoryRoot, sourceRef: 'HEAD' });
    } catch {
      rejectedSourceDrift = true;
    }
    if (!rejectedSourceDrift) throw new Error('Linnkit projection verify 未拒绝手工源码漂移。');
    console.log(
      `Linnkit release projection smoke passed: ${fs.readFileSync(path.join(secondRoot, LINNKIT_SOURCE_PROVENANCE_FILE), 'utf8').trim()}`
    );
  });
}

function printUsage(): void {
  console.log(`Usage:
  manageLinnkitProjection.ts export <target-dir> [source-root] [source-ref] [source-repository]
  manageLinnkitProjection.ts verify <target-dir> [source-root] [source-ref] [source-repository]
  manageLinnkitProjection.ts smoke [source-root]`);
}

export function main(args: readonly string[]): void {
  const [command, targetArg, sourceRootArg, sourceRef = 'HEAD', sourceRepository] = args;
  if (command === 'smoke') {
    runSmoke(path.resolve(targetArg ?? defaultRepositoryRoot));
    return;
  }
  if ((command !== 'export' && command !== 'verify') || !targetArg) {
    printUsage();
    process.exitCode = 2;
    return;
  }
  const input = {
    targetRoot: path.resolve(targetArg),
    repositoryRoot: path.resolve(sourceRootArg ?? defaultRepositoryRoot),
    sourceRef,
    sourceRepository,
  };
  if (command === 'export') exportProjection(input);
  else verifyProjection(input);
  console.log(`Linnkit projection ${command} passed: ${input.targetRoot}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
