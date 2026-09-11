const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const packageRoot = path.resolve(__dirname, '..');
// 只清理本 package 的生成物，消费者必须等待两种模块格式的首次成功事件。
fs.rmSync(path.join(packageRoot, 'dist'), { recursive: true, force: true });
const watchers = [];
const ready = new Set();
const reportDiagnostic = ts.createDiagnosticReporter(ts.sys, true);
const reportStatus = ts.createWatchStatusReporter(ts.sys, true);

for (const configuration of ['tsconfig.json', 'tsconfig.esm.json']) {
  const host = ts.createWatchCompilerHost(
    path.join(packageRoot, configuration),
    { noEmitOnError: true, preserveWatchOutput: true },
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    reportDiagnostic,
    reportStatus,
  );
  const afterProgramCreate = host.afterProgramCreate;
  host.afterProgramCreate = program => {
    afterProgramCreate(program);
    if (ts.getPreEmitDiagnostics(program.getProgram()).some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
      ready.delete(configuration);
      process.send?.({ type: 'build-error' });
      return;
    }
    if (configuration === 'tsconfig.esm.json') {
      // ESM 的 Node specifier 修正和 package identity 也属于本轮编译完成事实。
      fs.mkdirSync(path.join(packageRoot, 'dist/esm'), { recursive: true });
      fs.writeFileSync(path.join(packageRoot, 'dist/esm/package.json'), '{"type":"module"}\n');
      execFileSync(process.execPath, [path.join(__dirname, 'fix-esm-specifiers.cjs')], { stdio: 'inherit' });
    }
    ready.add(configuration);
    if (ready.size === 2) {
      execFileSync(process.execPath, [path.join(__dirname, 'verify-runtime-exports.cjs')], { stdio: 'inherit' });
      process.send?.({ type: 'build-ready' });
    }
  };
  watchers.push(ts.createWatchProgram(host));
}

function stop() {
  for (const watcher of watchers) watcher.close();
  process.exit(0);
}
process.on('message', message => { if (message?.type === 'stop') stop(); });
process.on('disconnect', stop);
