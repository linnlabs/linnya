import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { hasCurrentSlidesCliBuild, recordSlidesCliBuild, slidesCliInputHash } from './build/slidesCliBuildCache.mjs';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve('.');
const repoRoot = path.resolve('../../..');
const packageManagerPath = process.env.npm_execpath;

if (!packageManagerPath) {
  throw new Error('Slides CLI launcher requires npm_execpath from pnpm');
}

const inputHash = await slidesCliInputHash(repoRoot);
if (!await hasCurrentSlidesCliBuild(packageRoot, inputHash)) {
for (const scriptName of ['build:raster-worker', 'build:raster-preload', 'build:cli']) {
  const build = spawnSync(process.execPath, [packageManagerPath, 'run', scriptName], {
    cwd: packageRoot,
    stdio: ['inherit', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (build.status !== 0) {
    process.stderr.write(build.stdout ?? '');
    process.stderr.write(build.stderr ?? '');
    process.exitCode = build.status ?? 1;
    process.exit();
  }
}

await recordSlidesCliBuild(packageRoot, inputHash);
}

const forwardedArgs = process.argv.slice(2);
while (forwardedArgs[0] === '--') {
  forwardedArgs.shift();
}
const electronPath = require('electron');
const cliEntry = path.join(packageRoot, 'dist/cli/slides-cli.cjs');
const cli = spawnSync(electronPath, [cliEntry, ...forwardedArgs], {
  cwd: repoRoot,
  env: {
    ...process.env,
    LINNYA_DEV_MODE: process.env.LINNYA_DEV_MODE ?? 'true',
  },
  stdio: 'inherit',
});
process.exitCode = cli.status ?? 1;
