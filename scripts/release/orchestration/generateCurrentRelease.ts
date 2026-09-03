import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildCurrentReleaseModule, readReleaseNotes } from '../functions/parseReleaseNotes';

export function generateCurrentRelease(rootDir: string): string {
  const notes = readReleaseNotes(rootDir);
  const outputPath = path.join(rootDir, 'apps/renderer/domains/settings/definitions/currentRelease.generated.ts');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buildCurrentReleaseModule(notes), 'utf-8');
  return outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootDir = path.resolve(process.cwd());
  const outputPath = generateCurrentRelease(rootDir);
  console.log(`已生成关于页发布数据: ${path.relative(rootDir, outputPath)}`);
}
