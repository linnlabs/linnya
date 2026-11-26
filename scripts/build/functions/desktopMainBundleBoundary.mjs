/**
 * Electron Main 只做窗口、IPC 转发和 App Server 进程管理，业务 Backend 在独立 Node 进程里另有一份 bundle。
 * Main 一旦经某个聚合入口引用到 Backend 的装配代码，esbuild 会把整张 Backend 模块图再内联一遍
 * （曾让主进程包从约 4 MiB 涨到 21 MiB），启动要多解析一份、安装包也多带一份，所以在构建时直接拦下。
 */

/** 当前约 3.7 MiB；留出正常增长空间，但远低于“带入整个 Backend”时的体积。 */
export const DESKTOP_MAIN_BUNDLE_BYTE_LIMIT = 6 * 1024 * 1024;

/** 只在 App Server 进程里运行的装配入口与第三方运行时；出现在 Main 的输入里就说明边界被打穿。 */
const APP_SERVER_ONLY_INPUTS = [
  /^src\/app-hosts\/linnya\/adapters\/backend-renderer-requests\/app-server\.ts$/u,
  /^src\/app-hosts\/linnya\/adapters\/backend-renderer-requests\/orchestration\/register[^/]*\.ts$/u,
  /^src\/app-hosts\/linnya\/plugin-registry\//u,
  /^src\/app-hosts\/linnya\/backend-runtime\/orchestration\//u,
  // 该目录里也有 Main 启动 App Server 进程用的解析函数，所以只点名进程内的组合根。
  /^src\/app-hosts\/linnya\/app-server-runtime\/orchestration\/(?:runLinnyaAppServerProcess|createHeadlessAppServerBackendComposition)\.ts$/u,
  /\/node_modules\/(?:express|ai|@ai-sdk\/[^/]+|linkedom|xlsx)\//u,
];

/**
 * @param {{ inputs: Readonly<Record<string, { bytesInOutput: number }>> }} output esbuild metafile 中主进程包的 output 条目
 * @returns {string[]}
 */
export function findDesktopMainBundleViolations(output) {
  // 不用 output.bytes：开发构建带内联 sourcemap，会把体积撑大十几倍。
  const contributions = Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0);
  const violations = contributions
    .filter(([inputPath]) => APP_SERVER_ONLY_INPUTS.some(pattern => pattern.test(inputPath)))
    .map(([inputPath]) => `主进程包不得内联只属于 App Server 的模块：${inputPath}`);
  const codeBytes = contributions.reduce((total, [, input]) => total + input.bytesInOutput, 0);
  if (codeBytes > DESKTOP_MAIN_BUNDLE_BYTE_LIMIT) {
    violations.push(
      `主进程包代码 ${(codeBytes / 1024 / 1024).toFixed(2)} MiB，超过 ${DESKTOP_MAIN_BUNDLE_BYTE_LIMIT / 1024 / 1024} MiB 上限，可能把 Backend 模块图打进了 Main`,
    );
  }
  return violations;
}
