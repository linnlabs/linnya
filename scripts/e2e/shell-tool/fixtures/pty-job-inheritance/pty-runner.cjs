/* global require, setInterval, setTimeout */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const [moduleRoot, fixtureRoot, scenarioRoot, mode, token] = process.argv.slice(2);
const gatePath = path.join(scenarioRoot, 'assigned-to-job.gate');
const readyPath = path.join(scenarioRoot, 'runner-ready.json');
const commandPath = path.join(scenarioRoot, 'runner-command.txt');

function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const inspect = () => {
      if (fs.existsSync(filePath)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${filePath}`));
        return;
      }
      setTimeout(inspect, 10);
    };
    inspect();
  });
}

function writeJsonAtomically(filePath, value) {
  fs.writeFileSync(`${filePath}.pending`, JSON.stringify(value));
  fs.renameSync(`${filePath}.pending`, filePath);
}

async function main() {
  await waitForFile(gatePath, 15_000);
  const nodePty = require(path.join(moduleRoot, 'node-pty'));
  const pty = nodePty.spawn(
    process.execPath,
    [path.join(fixtureRoot, 'pty-child.cjs'), mode, scenarioRoot, token],
    {
      cols: 80,
      rows: 24,
      cwd: scenarioRoot,
      env: { ...process.env, NO_COLOR: '1', TERM: 'xterm-256color' },
    },
  );
  pty.onData(() => undefined);
  pty.on('error', error => {
    fs.writeFileSync(path.join(scenarioRoot, 'backend-error.txt'), String(error));
  });

  let exitEvent;
  pty.onExit(event => {
    exitEvent = event;
  });

  if (mode === 'quick') {
    const deadline = Date.now() + 15_000;
    while (!exitEvent && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!exitEvent) throw new Error('quick PTY root did not exit');
    process.exit(0);
  }

  await Promise.all([
    waitForFile(path.join(scenarioRoot, 'pty-root.json'), 15_000),
    waitForFile(path.join(scenarioRoot, 'background-identity.json'), 15_000),
  ]);
  if (mode === 'natural') {
    const deadline = Date.now() + 15_000;
    while (!exitEvent && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!exitEvent) throw new Error('natural PTY root did not exit');
  }

  const ptyRoot = JSON.parse(fs.readFileSync(path.join(scenarioRoot, 'pty-root.json'), 'utf8'));
  const background = JSON.parse(
    fs.readFileSync(path.join(scenarioRoot, 'background-identity.json'), 'utf8'),
  );
  writeJsonAtomically(readyPath, {
    version: 1,
    token,
    mode,
    runnerProcessId: process.pid,
    ptyProcessId: pty.pid,
    ptyRootProcessId: ptyRoot.processId,
    backgroundProcessId: background.processId,
    ptyExit: exitEvent ?? null,
  });

  if (mode === 'natural') {
    await waitForFile(commandPath, 30_000);
    const command = fs.readFileSync(commandPath, 'utf8').trim();
    if (command !== 'exit') throw new Error(`unexpected runner command: ${command}`);
    process.exit(0);
  }

  setInterval(() => undefined, 1000);
}

main().catch(error => {
  fs.writeFileSync(path.join(scenarioRoot, 'runner-error.txt'), String(error?.stack ?? error));
  process.exit(1);
});
