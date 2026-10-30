import fs from 'node:fs';

import {
  trustedDesktopDistributionKeys,
  verifyDesktopDistributionManifest,
} from '../../../src/electron-main/distribution';
import { readReleasePackageInfo } from '../functions/readPackageVersion';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('缺少 Desktop 发行清单路径');
const identity = verifyDesktopDistributionManifest({
  manifestText: fs.readFileSync(manifestPath, 'utf8'),
  applicationVersion: readReleasePackageInfo(process.cwd()).version,
  trustedKeys: trustedDesktopDistributionKeys,
});
console.log(JSON.stringify(identity));
