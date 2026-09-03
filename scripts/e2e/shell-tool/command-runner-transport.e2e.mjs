import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import console from 'node:console';
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const REPLY_TIMEOUT_MS = 10_000;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function inspectBytes(value) {
  return {
    is_uint8_array: value instanceof Uint8Array,
    is_buffer: Buffer.isBuffer(value),
    byte_length: value instanceof Uint8Array ? value.byteLength : undefined,
    sha256: value instanceof Uint8Array ? sha256(value) : undefined,
  };
}

if (process.argv[2] === '--child') {
  process.once('message', message => {
    process.send?.({
      type: 'transport_probe_reply',
      message_id: message.message_id,
      identity: message.identity,
      sequence: message.sequence,
      bytes: inspectBytes(message.bytes),
      buffer: inspectBytes(message.buffer),
    }, error => {
      if (error) throw error;
      process.disconnect();
    });
  });
} else {
  function runProbe(serialization, payload) {
    const child = fork(currentFilePath, ['--child'], {
      serialization,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-32_768);
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settle(reject, new Error(
          `runner transport ${serialization} reply timed out; stderr=${stderr}`,
        ));
      }, REPLY_TIMEOUT_MS);

      function settle(callback, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (child.connected) child.disconnect();
        if (child.exitCode === null && child.signalCode === null) child.kill();
        callback(value);
      }

      child.once('error', error => settle(reject, error));
      child.once('exit', (code, signal) => {
        if (!settled) {
          settle(reject, new Error(
            `runner transport ${serialization} exited before reply: `
              + `code=${code} signal=${signal ?? 'none'} stderr=${stderr}`,
          ));
        }
      });
      child.once('message', message => settle(resolve, message));
      child.send(payload, error => {
        if (error) settle(reject, error);
      });
    });
  }

  function createPayload() {
    const bytes = Uint8Array.from([
      0x00, 0xff, 0x7f, 0x80, 0xe4, 0xb8, 0xad, 0x0a,
    ]);
    return {
      message_id: randomUUID(),
      identity: {
        command_execution_id: `command_execution_${randomUUID()}`,
        owner_generation_id: `command_owner_${randomUUID()}`,
        created_at_ms: Date.now(),
      },
      sequence: Number.MAX_SAFE_INTEGER - 1,
      bytes,
      buffer: Buffer.from(bytes),
    };
  }

  async function main() {
    const jsonPayload = createPayload();
    const jsonReply = await runProbe('json', jsonPayload);
    assert.equal(jsonReply.type, 'transport_probe_reply');
    assert.equal(jsonReply.bytes.is_uint8_array, false);
    assert.equal(jsonReply.buffer.is_uint8_array, false);

    const advancedPayload = createPayload();
    const advancedReply = await runProbe('advanced', advancedPayload);
    assert.equal(advancedReply.type, 'transport_probe_reply');
    assert.equal(advancedReply.message_id, advancedPayload.message_id);
    assert.deepEqual(advancedReply.identity, advancedPayload.identity);
    assert.equal(advancedReply.sequence, advancedPayload.sequence);
    assert.deepEqual(advancedReply.bytes, {
      is_uint8_array: true,
      is_buffer: false,
      byte_length: advancedPayload.bytes.byteLength,
      sha256: sha256(advancedPayload.bytes),
    });
    assert.deepEqual(advancedReply.buffer, {
      is_uint8_array: true,
      is_buffer: true,
      byte_length: advancedPayload.buffer.byteLength,
      sha256: sha256(advancedPayload.buffer),
    });

    console.log(JSON.stringify({
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      assertions: 3,
      status: 'passed',
    }));
  }

  await main();
}
