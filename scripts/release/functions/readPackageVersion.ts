import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ReleasePackageInfo } from '../definitions/releaseManifest';

interface PackageJsonShape {
  readonly version: string;
  readonly build?: {
    readonly productName?: string;
    readonly publish?: {
      readonly url?: string;
    };
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

export function readReleasePackageInfo(rootDir: string): ReleasePackageInfo {
  const packagePath = path.join(rootDir, 'package.json');
  const packageJson = readJsonFile<PackageJsonShape>(packagePath);
  const productName = packageJson.build?.productName;
  const publishUrl = packageJson.build?.publish?.url;

  if (!packageJson.version) {
    throw new Error('package.json 缺少 version 字段。');
  }

  if (!productName) {
    throw new Error('package.json 缺少 build.productName 字段。');
  }

  if (!publishUrl) {
    throw new Error('package.json 缺少 build.publish.url 字段。');
  }

  return {
    version: packageJson.version,
    productName,
    publishUrl,
  };
}
