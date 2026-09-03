import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

async function main() {
  const appOutDir = process.argv[2];
  if (!appOutDir || !path.isAbsolute(appOutDir)) {
    throw new Error('afterSign validation requires an absolute app output directory');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(
    appOutDir,
    'resources/command-runtime/windows/x64/linnyaCommandProcessOwner.manifest.json',
  ), 'utf8'));
  if (typeof manifest.application_version !== 'string') {
    throw new Error('afterSign validation manifest has no application version');
  }
  const hook = require('./after-sign-runtime-assets.cjs');
  await hook({
    electronPlatformName: 'win32',
    appOutDir,
    packager: { appInfo: { version: manifest.application_version } },
  });
  process.stdout.write(`${JSON.stringify({ success: true })}\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.stack ?? String(error)}\n`);
  process.exitCode = 1;
});
