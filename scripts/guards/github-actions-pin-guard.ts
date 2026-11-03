/**
 * GitHub Actions 外部依赖固定门禁。
 *
 * Workflow 会在仓库权限范围内执行第三方代码。tag 和 branch 都是可移动引用，
 * 因此外部 Action 与可复用 workflow 必须固定到完整 commit SHA；仓库内本地 Action
 * 不经过外部下载，可以继续使用相对路径。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface GitHubActionPinViolation {
  readonly file: string;
  readonly line: number;
  readonly reference: string;
  readonly reason: 'external-action-not-pinned' | 'docker-image-not-pinned';
}

const EXTERNAL_ACTION_SHA_PATTERN = /^[^/@\s]+\/[^@\s]+@[0-9a-f]{40}$/u;
const DOCKER_DIGEST_PATTERN = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/u;
const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml']);

function readUsesReference(line: string): string | undefined {
  const match = line.match(/^\s*-?\s*uses:\s*(.+?)\s*$/u);
  const scalar = match?.[1]?.trim();
  if (!scalar) return undefined;

  const quoted = scalar.match(/^(?:"([^"]+)"|'([^']+)')\s*(?:#.*)?$/u);
  if (quoted) return quoted[1] ?? quoted[2];

  return scalar.replace(/\s+#.*$/u, '').trim();
}

export function analyzeGitHubWorkflowActionPins(
  relativePath: string,
  content: string
): GitHubActionPinViolation[] {
  const violations: GitHubActionPinViolation[] = [];

  for (const [lineIndex, line] of content.split(/\r?\n/u).entries()) {
    const reference = readUsesReference(line);
    if (!reference || reference.startsWith('./')) continue;

    if (reference.startsWith('docker://')) {
      if (!DOCKER_DIGEST_PATTERN.test(reference)) {
        violations.push({
          file: relativePath,
          line: lineIndex + 1,
          reference,
          reason: 'docker-image-not-pinned',
        });
      }
      continue;
    }

    if (!EXTERNAL_ACTION_SHA_PATTERN.test(reference)) {
      violations.push({
        file: relativePath,
        line: lineIndex + 1,
        reference,
        reason: 'external-action-not-pinned',
      });
    }
  }

  return violations;
}

export function runGitHubActionsPinGuard(repoRoot = process.cwd()): GitHubActionPinViolation[] {
  // 本地复合 Action 仍可执行外部依赖，必须与调用它的 workflow 一起检查。
  const inspectDirectory = (directory: string): GitHubActionPinViolation[] => {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return inspectDirectory(file);
      if (!entry.isFile() || !WORKFLOW_EXTENSIONS.has(path.extname(entry.name))) return [];
      const relativePath = path.relative(repoRoot, file).split(path.sep).join('/');
      return analyzeGitHubWorkflowActionPins(relativePath, fs.readFileSync(file, 'utf8'));
    });
  };
  return ['workflows', 'actions'].flatMap(name => inspectDirectory(path.join(repoRoot, '.github', name)));
}

function main(): void {
  const violations = runGitHubActionsPinGuard();
  if (violations.length === 0) {
    console.log('GitHub Actions pin guard passed');
    return;
  }

  console.error('GitHub workflow 存在未固定到不可变摘要的外部执行依赖：');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line} ${violation.reference}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
