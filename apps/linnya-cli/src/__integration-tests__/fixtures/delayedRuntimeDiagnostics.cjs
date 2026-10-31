const path = require('node:path');
const { Writable } = require('node:stream');

exports.LINNYA_CLI_RUNTIME_HOST_CONTRACT_VERSION = 1;

/** @param {import('../../../../../src/app-hosts/linnya/cli-runtime').CliRuntimeHostInput} input */
exports.runCliRuntimeHost = input => {
  const runtime = require(path.join(input.developmentRoot, 'dist/main/linnya-cli-runtime.cjs'));
  const stderrSink = new Writable({
    write(chunk, _encoding, callback) {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (text.includes('App Server Backend 已关停')) {
        // 暂停真实 parent 的事件循环，让最后的诊断 response 晚于 child 的 shutdown ACK。
        // 仅控制外部调度，不替换成品 Backend、RPC 或关停实现。
        input.stderrSink.write('fixture-delayed-shutdown-diagnostic\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
      input.stderrSink.write(chunk, callback);
    },
  });
  return runtime.runCliRuntimeHost({ ...input, stderrSink });
};
