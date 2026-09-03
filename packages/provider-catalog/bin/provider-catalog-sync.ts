#!/usr/bin/env node

import { syncProviderCatalog } from '../src/features/upstream-sync/syncProviderCatalog';

const argumentsList = process.argv.slice(2);
if (argumentsList.some(argument => argument !== '--check')) {
  process.stderr.write('用法: pnpm --filter @linnya/provider-catalog sync [--check]\n');
  process.exitCode = 1;
} else {
  syncProviderCatalog({ mode: argumentsList.includes('--check') ? 'check' : 'write' })
    .then(report => {
      process.stdout.write(`${report}\n`);
    })
    .catch(error => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
