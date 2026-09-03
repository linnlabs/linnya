#!/usr/bin/env node

/**
 * 使用 Electron 的 Node.js 运行测试脚本
 * 
 * 用法：
 * node scripts/test-runner/run-test-with-electron.cjs <测试脚本路径> [参数...]
 * 
 * 示例：
 * node scripts/test-runner/run-test-with-electron.cjs scripts/diagnostics/workspace/workspace-explorer.ts list-projects
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptPath = process.argv[2];
if (!scriptPath) {
  console.error('用法: node scripts/test-runner/run-test-with-electron.cjs <测试脚本路径> [参数...]');
  process.exit(1);
}

if (!fs.existsSync(scriptPath)) {
  console.error(`错误: 文件不存在: ${scriptPath}`);
  process.exit(1);
}

// 获取 tsx 路径
// tsx@4 通过 exports 暴露子路径：`tsx/cli`（而非历史上的 `tsx/cli.js`）
const tsxPath = require.resolve('tsx/cli');
const forwardedArgs = process.argv.slice(3);
// pnpm run <script> -- <args> 在当前工具链会保留一个字面量分隔符；
// runner 统一消费它，业务脚本只接收自己的参数合同。
const args = forwardedArgs[0] === '--' ? forwardedArgs.slice(1) : forwardedArgs;

console.log(`🚀 使用 Electron 的 Node.js 运行: ${scriptPath}`);

// 使用 electron 命令，设置 ELECTRON_RUN_AS_NODE=1 让它像普通 Node.js 一样运行
// 然后通过 tsx 来执行 TypeScript 文件
const child = spawn('npx', ['electron', tsxPath, scriptPath, ...args], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1'
  }
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
