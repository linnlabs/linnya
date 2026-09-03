/* global Buffer, __dirname, performance, require, setTimeout */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const moduleRoot = process.env.LINNYA_PTY_VALIDATION_MODULE_ROOT;
const resultPath = process.env.LINNYA_PTY_VALIDATION_RESULT_PATH;
const runtimeKind = process.env.LINNYA_PTY_VALIDATION_RUNTIME_KIND ?? 'node';
const fixtureRoot = __dirname;
const MAX_CAPTURED_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

if (!moduleRoot || !path.isAbsolute(moduleRoot)) {
  throw new Error('LINNYA_PTY_VALIDATION_MODULE_ROOT must be an absolute path');
}
if (!resultPath || !path.isAbsolute(resultPath)) {
  throw new Error('LINNYA_PTY_VALIDATION_RESULT_PATH must be an absolute path');
}

const nodePty = require(path.join(moduleRoot, 'node-pty'));
const { Terminal } = require(path.join(moduleRoot, '@xterm/headless'));
const nodePtyPackage = require(path.join(moduleRoot, 'node-pty/package.json'));
const xtermPackage = require(path.join(moduleRoot, '@xterm/headless/package.json'));
const nodeAddonApiPackage = require(path.join(moduleRoot, 'node-addon-api/package.json'));

assert.equal(nodePtyPackage.version, '1.2.0-beta.14');
assert.equal(xtermPackage.version, '6.0.0');
assert.equal(nodeAddonApiPackage.version, '7.1.1');

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function writeTerminal(terminal, data) {
  return new Promise(resolve => terminal.write(data, resolve));
}

function waitForCondition(label, readValue, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const inspect = () => {
      const value = readValue();
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(inspect, 10);
    };
    inspect();
  });
}

function createPtyObservation(pty) {
  const chunks = [];
  let capturedBytes = 0;
  const dataDisposable = pty.onData(data => {
    if (capturedBytes >= MAX_CAPTURED_TRANSCRIPT_BYTES) return;
    const byteLength = Buffer.isBuffer(data)
      ? data.byteLength
      : Buffer.byteLength(data, 'utf8');
    capturedBytes += byteLength;
    if (capturedBytes <= MAX_CAPTURED_TRANSCRIPT_BYTES) chunks.push(data);
  });
  const exit = new Promise(resolve => {
    pty.onExit(event => resolve(event));
  });
  return {
    chunks,
    exit,
    text() {
      return chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk).join('');
    },
    dispose() {
      dataDisposable.dispose();
    },
  };
}

async function waitForExit(pty, observation, timeoutMs = 10_000) {
  const timeout = delay(timeoutMs).then(() => {
    throw new Error(`PTY ${pty.pid} did not exit within ${timeoutMs}ms`);
  });
  return Promise.race([observation.exit, timeout]);
}

function spawnFixture(fileName, options = {}) {
  return nodePty.spawn(process.execPath, [path.join(fixtureRoot, fileName)], {
    cols: 40,
    rows: 10,
    cwd: fixtureRoot,
    env: { ...process.env, NO_COLOR: '1', TERM: 'xterm-256color' },
    encoding: null,
    ...options,
  });
}

async function validateInteraction() {
  const pty = process.platform === 'win32'
    ? nodePty.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit'], {
      cols: 40,
      rows: 10,
      cwd: fixtureRoot,
      env: { ...process.env, NO_COLOR: '1', TERM: 'xterm-256color' },
      encoding: null,
    })
    : spawnFixture('interactive-child.cjs');
  const observation = createPtyObservation(pty);
  try {
    if (process.platform === 'win32') {
      pty.write("[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\r");
      pty.write("Write-Output ('LINNYA_PTY_' + 'READY:true')\r");
    }
    await waitForCondition('interactive ready marker', () => (
      observation.text().includes('LINNYA_PTY_READY:true')
    ));
    if (process.platform === 'win32') {
      pty.write(`Write-Output ('LINNYA_PTY_' + 'WRITE:中文-${process.platform}')\r`);
    } else {
      pty.write(`WRITE:中文-${process.platform}\r`);
    }
    await waitForCondition('interactive write marker', () => (
      observation.text().includes(`LINNYA_PTY_WRITE:中文-${process.platform}`)
    ));
    pty.resize(100, 30);
    if (process.platform === 'win32') {
      pty.write(
        "Write-Output ('LINNYA_PTY_SIZE:{0}x{1}' -f [Console]::WindowWidth, [Console]::WindowHeight)\r",
      );
    } else {
      pty.write('SIZE\r');
    }
    await waitForCondition('PTY resize marker', () => (
      observation.text().includes('LINNYA_PTY_SIZE:100x30')
    ));
    pty.write(process.platform === 'win32' ? 'exit 23\r' : 'EXIT:23\r');
    const exit = await waitForExit(pty, observation);
    assert.equal(exit.exitCode, 23);
    return {
      exitCode: exit.exitCode,
      signal: exit.signal,
      chunkKinds: [...new Set(observation.chunks.map(chunk => (
        Buffer.isBuffer(chunk) ? 'buffer' : typeof chunk
      )))],
      resizedTo: { columns: 100, rows: 30 },
      unicodeRoundTrip: true,
    };
  } finally {
    observation.dispose();
  }
}

async function validateTranscriptSemantics() {
  const pty = spawnFixture('raw-output-child.cjs');
  const observation = createPtyObservation(pty);
  try {
    const exit = await waitForExit(pty, observation);
    assert.equal(exit.exitCode, 0);
    const chunkKinds = [...new Set(observation.chunks.map(chunk => (
      Buffer.isBuffer(chunk) ? 'buffer' : typeof chunk
    )))];
    const deliveredBytes = Buffer.concat(observation.chunks.map(chunk => (
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8')
    )));
    const exactPayload = Buffer.from([
      0x4c, 0x49, 0x4e, 0x4e, 0x59, 0x41, 0x5f, 0x52, 0x41, 0x57, 0x5f, 0x42, 0x45, 0x47, 0x49, 0x4e,
      0x41, 0xff, 0xfe, 0xc3, 0x28, 0x00, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x42,
      0x4c, 0x49, 0x4e, 0x4e, 0x59, 0x41, 0x5f, 0x52, 0x41, 0x57, 0x5f, 0x45, 0x4e, 0x44,
    ]);
    const exactPayloadPreserved = deliveredBytes.includes(exactPayload);
    const replacementCharacterCount = (observation.text().match(/\ufffd/gu) ?? []).length;
    const questionMarkCount = (observation.text().match(/\?/gu) ?? []).length;
    if (process.platform === 'darwin') {
      assert.deepEqual(chunkKinds, ['buffer']);
      assert.equal(exactPayloadPreserved, true);
    } else if (process.platform === 'win32') {
      assert.deepEqual(chunkKinds, ['string']);
      assert.equal(exactPayloadPreserved, false);
      assert.equal(deliveredBytes.includes(0), false);
    }
    return {
      backendDeliveryKind: chunkKinds[0],
      exactPayloadPreserved,
      replacementCharacterCount,
      questionMarkCount,
      nulDeliveredAfterUtf8Normalization: deliveredBytes.includes(0),
      deliveredSha256: require('node:crypto').createHash('sha256').update(deliveredBytes).digest('hex'),
      deliveredBytes: deliveredBytes.byteLength,
    };
  } finally {
    observation.dispose();
  }
}

async function validatePublicWriteBackpressure() {
  const pty = spawnFixture('blocked-input-child.cjs');
  const observation = createPtyObservation(pty);
  const backendErrors = [];
  const windowsInputSocket = pty._agent?.inSocket;
  const observeBackendError = error => {
    backendErrors.push({ code: error?.code ?? null, message: error?.message ?? String(error) });
  };
  windowsInputSocket?.on('error', observeBackendError);
  try {
    await waitForCondition('blocked input ready marker', () => (
      observation.text().includes('LINNYA_PTY_BLOCKED_READY')
    ));
    const chunk = 'x'.repeat(64 * 1024);
    const beforeArrayBuffers = process.memoryUsage().arrayBuffers;
    const startedAt = performance.now();
    let undefinedReturnCount = 0;
    const budgetSnapshots = [];
    for (let index = 0; index < 1024; index += 1) {
      if (pty.write(chunk) === undefined) undefinedReturnCount += 1;
      const submittedChunks = index + 1;
      if ([16, 64, 256, 1024].includes(submittedChunks)) {
        budgetSnapshots.push({
          submittedBytes: submittedChunks * Buffer.byteLength(chunk, 'utf8'),
          unixPrivateQueueLength: Array.isArray(pty._writeStream?._writeQueue)
            ? pty._writeStream._writeQueue.length
            : null,
          windowsPrivateWritableLength: Number.isSafeInteger(
            pty._agent?.inSocket?.writableLength,
          ) ? pty._agent.inSocket.writableLength : null,
        });
      }
    }
    const enqueueMilliseconds = performance.now() - startedAt;
    const afterArrayBuffers = process.memoryUsage().arrayBuffers;
    await delay(50);
    const unixQueueLength = Array.isArray(pty._writeStream?._writeQueue)
      ? pty._writeStream._writeQueue.length
      : null;
    const windowsWritableLength = Number.isSafeInteger(pty._agent?.inSocket?.writableLength)
      ? pty._agent.inSocket.writableLength
      : null;
    assert.equal(undefinedReturnCount, 1024);
    if (process.platform === 'darwin') assert(unixQueueLength > 0);
    if (process.platform === 'win32') assert(windowsWritableLength > 0);
    pty.kill();
    await waitForExit(pty, observation);
    await delay(20);
    return {
      submittedBytes: 64 * 1024 * 1024,
      publicWriteReturn: 'void',
      undefinedReturnCount,
      enqueueMilliseconds: Math.round(enqueueMilliseconds * 100) / 100,
      arrayBufferGrowthBytes: Math.max(0, afterArrayBuffers - beforeArrayBuffers),
      unixPrivateQueueLength: unixQueueLength,
      windowsPrivateWritableLength: windowsWritableLength,
      budgetSnapshots,
      backendErrorsAfterCancel: backendErrors,
      childReadInput: false,
    };
  } finally {
    observation.dispose();
  }
}

function cellToData(cell) {
  return {
    chars: cell.getChars(),
    width: cell.getWidth(),
    bold: cell.isBold(),
    italic: cell.isItalic(),
    underline: cell.isUnderline(),
    inverse: cell.isInverse(),
    foreground: cell.getFgColor(),
    background: cell.getBgColor(),
  };
}

function snapshotScreen(terminal) {
  const lines = [];
  for (let row = 0; row < terminal.rows; row += 1) {
    const line = terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row);
    if (!line) continue;
    const cells = [];
    for (let column = 0; column < terminal.cols; column += 1) {
      const cell = line.getCell(column);
      if (cell && (cell.getChars() !== '' || cell.getWidth() !== 1)) cells.push(cellToData(cell));
    }
    lines.push({ text: line.translateToString(true), cells });
  }
  return {
    cursor: { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY },
    lines,
  };
}

async function validateHeadlessScreen() {
  const terminal = new Terminal({
    allowProposedApi: true,
    cols: 24,
    rows: 5,
    scrollback: 100,
  });
  let bellEvents = 0;
  let titleEvents = 0;
  let inputEvents = 0;
  const disposables = [
    terminal.onBell(() => { bellEvents += 1; }),
    terminal.onTitleChange(() => { titleEvents += 1; }),
    terminal.onData(() => { inputEvents += 1; }),
  ];
  try {
    const unicode = Buffer.from('跨块中文', 'utf8');
    await writeTerminal(terminal, unicode.subarray(0, 5));
    await writeTerminal(terminal, unicode.subarray(5));
    await writeTerminal(terminal, '\r\nplain\rprogress-1\rprogress-2');
    await writeTerminal(terminal, '\r\n\x1b[31;1mRED\x1b[0m');
    await writeTerminal(terminal, '\x1b]0;linnya-validation-title\x07');
    await writeTerminal(terminal, '\x1b]52;c;U0VDUkVU\x07');
    await writeTerminal(terminal, '\x1b]8;;https://invalid.example\x1b\\LINK\x1b]8;;\x1b\\');
    await writeTerminal(terminal, '\x1bP1;2;3+qignored\x1b\\\x07');
    const mainScreenBeforeAlternate = snapshotScreen(terminal);
    await writeTerminal(terminal, '\x1b[?1049hALTERNATE');
    const alternateScreen = snapshotScreen(terminal);
    await writeTerminal(terminal, '\x1b[?1049l');
    const restoredScreen = snapshotScreen(terminal);
    assert(alternateScreen.lines.some(line => line.text.includes('ALTERNATE')));
    assert.deepEqual(restoredScreen, mainScreenBeforeAlternate);
    terminal.resize(40, 8);
    for (let index = 0; index < 500; index += 1) {
      await writeTerminal(terminal, `\r\nSCROLL-${index}`);
    }
    const finalScreen = snapshotScreen(terminal);
    assert(finalScreen.lines.some(line => line.text.includes('SCROLL-499')));
    assert(terminal.buffer.active.length <= terminal.rows + terminal.options.scrollback);
    assert.equal(inputEvents, 0);
    assert(titleEvents >= 1);
    assert(bellEvents >= 1);
    return {
      parserInputKinds: ['string', 'Uint8Array'],
      crossChunkUtf8: true,
      carriageReturnReplacement: mainScreenBeforeAlternate.lines.some(line => (
        line.text.includes('progress-2') && !line.text.includes('progress-1')
      )),
      alternateScreenRestored: true,
      resizedTo: { columns: terminal.cols, rows: terminal.rows },
      scrollbackLines: terminal.buffer.active.length,
      scrollbackLimit: terminal.options.scrollback,
      titleEvents,
      bellEvents,
      inputEvents,
      loadedAddons: [],
      dtoIsPlainData: JSON.parse(JSON.stringify(finalScreen)).lines.length === finalScreen.lines.length,
    };
  } finally {
    for (const disposable of disposables) disposable.dispose();
    terminal.dispose();
  }
}

async function main() {
  // node-pty 官方声明不是线程安全库；同一 runner 内按顺序验证，避免压力场景污染交互结论。
  const interaction = await validateInteraction();
  const transcript = await validateTranscriptSemantics();
  const publicWriteBackpressure = await validatePublicWriteBackpressure();
  const headlessScreen = await validateHeadlessScreen();
  await delay(50);
  const activeHandleKinds = [...new Set(process._getActiveHandles().map(handle => (
    handle?.constructor?.name ?? 'Unknown'
  )))].sort();
  const result = {
    success: true,
    runtime: {
      kind: runtimeKind,
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      modules: process.versions.modules,
      napi: process.versions.napi,
      platform: process.platform,
      architecture: process.arch,
      user: process.env.USERNAME ?? process.env.USER ?? null,
    },
    dependencies: {
      nodePty: nodePtyPackage.version,
      xtermHeadless: xtermPackage.version,
      nodeAddonApi: nodeAddonApiPackage.version,
    },
    interaction,
    transcript,
    publicWriteBackpressure,
    headlessScreen,
    activeHandleKindsAfterNaturalExit: activeHandleKinds,
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().then(
  () => process.exit(0),
  error => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exit(1);
  },
);
