import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { generateSourceDependencyBom } from './generateSourceDependencyBom';

export function generateAiSdkThirdPartyNotice(rootDir: string): void {
  // 中文说明：根 NOTICE 必须覆盖完整生产依赖图；这里只保留旧命令名作为发布入口，
  // 不能再用 AI SDK 子集覆盖完整 NOTICE。
  generateSourceDependencyBom(rootDir, { writeRootNotice: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateAiSdkThirdPartyNotice(path.resolve(process.cwd()));
}
