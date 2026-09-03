/**
 * 公共仓文档边界门禁。
 *
 * 内部 Proposal、调研和阶段记录存放在独立私有仓。这里仅按仓库相对路径判断，
 * 不记录私有仓位置、维护者用户名或本机目录。
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PRIVATE_PROCESS_DOCUMENT_PREFIX = 'docs/proposals/';

export function listTrackedPrivateProcessDocuments(repoRoot = process.cwd()): string[] {
  return execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(file => file.startsWith(PRIVATE_PROCESS_DOCUMENT_PREFIX))
    .sort((left, right) => left.localeCompare(right));
}

function main(): void {
  const violations = listTrackedPrivateProcessDocuments();
  if (violations.length === 0) {
    console.log('Public document boundary guard passed');
    return;
  }

  console.error('公共仓不能跟踪内部过程文档：');
  for (const file of violations) console.error(`  ${file}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
