import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

interface MutablePackageJson {
  version?: string;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function replaceReleaseNotesVersion(content: string, version: string): string {
  const lines = content.split(/\r?\n/);
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLine === -1) {
    return `测试版 v${version}\n`;
  }

  lines[firstContentLine] = `测试版 v${version}`;
  return lines.join('\n');
}

export function bumpReleaseVersion(rootDir: string, version: string): void {
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`版本号必须是 X.Y.Z 格式，收到: ${version}`);
  }

  const packagePath = path.join(rootDir, 'package.json');
  const releaseNotesPath = path.join(rootDir, 'release-notes.md');

  const packageJson = readJson<MutablePackageJson>(packagePath);
  packageJson.version = version;
  writeJson(packagePath, packageJson);

  const releaseNotesContent = fs.existsSync(releaseNotesPath)
    ? fs.readFileSync(releaseNotesPath, 'utf-8')
    : '';
  fs.writeFileSync(releaseNotesPath, replaceReleaseNotesVersion(releaseNotesContent, version), 'utf-8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error('用法: pnpm run release:bump 0.0.36');
    process.exit(1);
  }

  try {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    bumpReleaseVersion(rootDir, version);
    console.log(`已更新发布版本到 ${version}。请继续编辑 release-notes.md 正文，并运行 pnpm run release:generate && pnpm run release:verify。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
