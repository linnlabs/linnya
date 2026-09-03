import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateReleaseState } from '../functions/validateReleaseState';
import { validateAiSdkThirdPartyNotice } from '../functions/aiSdkThirdPartyNotice';

export function verifyRelease(rootDir: string): void {
  const result = validateReleaseState(rootDir);
  const noticeProblems = validateAiSdkThirdPartyNotice(rootDir);
  if (result.ok && noticeProblems.length === 0) {
    console.log(`发布状态检查通过，当前版本 ${result.version}。`);
    return;
  }

  console.error(`发布状态检查失败，当前版本 ${result.version}：`);
  for (const problem of result.problems) {
    console.error(`- ${problem.path}: ${problem.message}`);
  }
  for (const problem of noticeProblems) {
    console.error(`- ${problem.path}: ${problem.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRelease(path.resolve(process.cwd()));
}
