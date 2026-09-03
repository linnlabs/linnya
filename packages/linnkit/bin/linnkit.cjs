#!/usr/bin/env node

const { runCli } = require('../dist/cli.cjs');

void runCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
