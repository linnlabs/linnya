/* global process, require */

const readline = require('node:readline');

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: true,
});

process.stdout.write(`LINNYA_PTY_READY:${process.stdin.isTTY === true}\r\n`);

input.on('line', line => {
  if (line.startsWith('WRITE:')) {
    process.stdout.write(`LINNYA_PTY_WRITE:${line.slice('WRITE:'.length)}\r\n`);
    return;
  }
  if (line === 'SIZE') {
    process.stdout.write(`LINNYA_PTY_SIZE:${process.stdout.columns}x${process.stdout.rows}\r\n`);
    return;
  }
  if (line.startsWith('EXIT:')) {
    process.exit(Number.parseInt(line.slice('EXIT:'.length), 10));
  }
});
