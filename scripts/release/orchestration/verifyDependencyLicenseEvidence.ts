import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT_DEPENDENCY_LICENSE_EVIDENCE } from '../definitions/dependencyLicenseEvidence';
import { validateDependencyLicenseEvidence } from '../functions/dependencyLicenseEvidence';

export function verifyDependencyLicenseEvidence(rootDir: string, publicCandidate: boolean): void {
  const reportText = execFileSync(
    'pnpm',
    ['--filter', 'linnya', 'licenses', 'list', '--prod', '--json'],
    { cwd: rootDir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  const report: unknown = JSON.parse(reportText);
  const result = validateDependencyLicenseEvidence({
    rootDir,
    report,
    lockfile: fs.readFileSync(path.join(rootDir, 'pnpm-lock.yaml'), 'utf8'),
    evidence: ROOT_DEPENDENCY_LICENSE_EVIDENCE,
    publicCandidate,
  });

  if (result.problems.length > 0) {
    console.error('依赖许可证 evidence 检查失败：');
    for (const problem of result.problems) {
      console.error(`- ${problem.packageName}: ${problem.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const mode = publicCandidate ? '公开候选' : '开源准备期';
  console.log(
    `${mode}依赖许可证 evidence 通过：${result.resolvedUnknowns.length} 个 manifest 漏标已核权，${result.publicBlockers.length} 个公开阻断项保持精确基线。`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyDependencyLicenseEvidence(
    path.resolve(process.cwd()),
    process.argv.includes('--public-candidate')
  );
}
