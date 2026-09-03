import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const packageRoot = path.resolve('.');
const repoRoot = path.resolve('../../..');
const packageManagerPath = process.env.npm_execpath;

if (!packageManagerPath) {
  throw new Error('Slides CLI launcher requires npm_execpath from pnpm');
}

for (const scriptName of ['build:raster-worker', 'build:raster-preload', 'build:cli']) {
  const build = spawnSync(process.execPath, [packageManagerPath, 'run', scriptName], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    process.exitCode = build.status ?? 1;
    process.exit();
  }
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
