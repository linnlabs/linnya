/* global Buffer, __filename, clearInterval, process, require, setInterval, setTimeout */

const { spawn } = require('node:child_process');

const scenario = process.argv[2];

function startDescendant(descendantScenario) {
  const child = spawn(process.execPath, [__filename, descendantScenario], {
    detached: true,
    stdio: ['ignore', process.stdout, process.stderr],
    windowsHide: true,
  });
  child.unref();
}

switch (scenario) {
  case 'exit-zero':
    break;
  case 'binary-nonzero':
    process.stdout.write(Buffer.from([0x00, 0xe4, 0xb8, 0xad, 0xff, 0x0a]));
    process.stderr.write(Buffer.from([0x65, 0x72, 0x72, 0x00, 0x80, 0x0a]));
    process.exitCode = 7;
    break;
  case 'chunk-boundary':
    process.stdout.write(Buffer.alloc(64 * 1024, 0x61));
    process.stdout.write(Buffer.from([0x62]));
    break;
  case 'fast-tail':
    process.stdout.write(Buffer.from('fast-tail-中文\n', 'utf8'));
    break;
  case 'poll-stream':
    process.stdout.write(Buffer.from('poll-first-中文\n', 'utf8'));
    setTimeout(() => {
      process.stderr.write(Buffer.from('poll-second-stderr\n', 'utf8'));
      process.stdout.write(Buffer.from('poll-final\n', 'utf8'));
    }, 150);
    break;
  case 'descendant-output':
    startDescendant('descendant-writer');
    break;
  case 'descendant-writer': {
    let emitted = 0;
    const timer = setInterval(() => {
      emitted += 1;
      process.stdout.write(`descendant-tail-${emitted}\n`);
      if (emitted === 5) clearInterval(timer);
    }, 40);
    break;
  }
  case 'quiet-descendant':
    startDescendant('quiet-holder');
    break;
  case 'quiet-holder':
    setTimeout(() => {}, 350);
    break;
  case 'hang':
    setInterval(() => {}, 1_000);
    break;
  case 'pid-hang':
    process.stdout.write(`${process.pid}\n`);
    setInterval(() => {}, 1_000);
    break;
  default:
    process.stderr.write('unknown ordinary-pipe fixture scenario\n');
    process.exitCode = 64;
}
