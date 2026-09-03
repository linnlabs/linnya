import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AI_SDK_NOTICE_FILE_NAME,
  createAiSdkThirdPartyNotice,
} from '../functions/aiSdkThirdPartyNotice';

export function generateAiSdkThirdPartyNotice(rootDir: string): void {
  const targetPath = path.join(rootDir, AI_SDK_NOTICE_FILE_NAME);
  fs.writeFileSync(targetPath, createAiSdkThirdPartyNotice(rootDir), 'utf8');
  console.log(`已生成 ${targetPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateAiSdkThirdPartyNotice(path.resolve(process.cwd()));
}
