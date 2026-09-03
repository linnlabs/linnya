import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { validateAiSdkThirdPartyNotice } from '../functions/aiSdkThirdPartyNotice';

export function verifyAiSdkThirdPartyNotice(rootDir: string): void {
  const problems = validateAiSdkThirdPartyNotice(rootDir);
  if (problems.length === 0) {
    console.log('AI SDK 依赖、外部目录数据、移植源码 NOTICE 与安装包资源声明检查通过。');
    return;
  }
  console.error('第三方发布 NOTICE 检查失败：');
  for (const problem of problems) console.error(`- ${problem.path}: ${problem.message}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyAiSdkThirdPartyNotice(path.resolve(process.cwd()));
}
