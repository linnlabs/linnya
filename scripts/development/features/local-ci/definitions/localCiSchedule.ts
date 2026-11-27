/**
 * 本地 CI 的调度类别。所有任务共用同一份检出，GitHub 上每个任务各有一台干净机器，
 * 所以并行前要先说清每一步会不会改共享产物、读不读产物、怕不怕负载。
 *
 * - `static`：只读受 Git 跟踪的源码（tsc/vue-tsc 工程、带 dist 忽略的 eslint、按 Git 清单或源码根目录走的门禁、
 *   脚本单元测试）。在 GitHub 上它们都排在本任务任何构建之前，因此不可能依赖构建产物；可以和构建同时跑。
 * - `build`：写共享产物（node_modules、各包 dist、parser-wasm/pkg、插件打包产物）。一次只跑一个，
 *   运行期间不跑任何 `test`，避免测试读到写了一半的文件。
 * - `test`：运行时读取构建产物（Host 集成测试加载真实 Worker、CLI 对 bridge 验证）。构建都完成后才开始，
 *   彼此可以并行；合并后的测试分片单独占用测试资源（见 heavy）。
 * - `loadSensitive`：测量绘制计数、像素、帧或真实进程生命周期的步骤，必须在没有其他步骤运行时单独执行。
 *   负载下偶发失败比慢更糟。
 */
export type LocalCiStepKind = 'static' | 'build' | 'test' | 'loadSensitive';

export const LOCAL_CI_STEP_KIND_REASON: Readonly<Record<LocalCiStepKind, string>> = {
  static: '只读源码，可与构建并行',
  build: '写共享构建产物，单独串行',
  test: '读取构建产物，构建完成后并行',
  loadSensitive: '对负载敏感，单独执行',
};

/** 工作流里出现、但这里没有声明的步骤：不猜，按最保守的方式单独执行，并在输出里提示补声明。 */
export const LOCAL_CI_UNDECLARED_STEP_KIND: LocalCiStepKind = 'loadSensitive';

/** 「工作流文件 → 任务 id → 步骤名 → 类别」。 */
export type LocalCiSchedule = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, LocalCiStepKind>>>>>>;

/**
 * 按「工作流文件 → 任务 id → 步骤名」声明调度类别。`uses:` 外部 action 本地不执行，不需要声明。
 * 工作流增删步骤时同步这里；`localCiSchedule.test.ts` 会对照真实工作流检查没有遗漏或过期的条目。
 */
export const LOCAL_CI_STEP_SCHEDULE: LocalCiSchedule = {
  'canvas-regression.yml': {
    deterministic: {
      'Install dependencies': 'build',
      // 以下 Linux 步骤在 macOS 上按条件跳过；声明只为表格完整。
      'Resolve Linux drawing font': 'build',
      'Prepare Linux offscreen display': 'build',
      'Prepare Linux Electron sandbox helper': 'build',
      'Typecheck Canvas': 'static',
      'Check Canvas architecture and frame closure': 'static',
      'Lint Canvas production code': 'static',
      'Verify source formatting guard rejects compressed statements': 'static',
      'Build schemas for browser subpath imports': 'build',
      'Build the actual computation worker': 'build',
      'Run Canvas business cases': 'test',
      'Run actual Host persistence and restoration cases': 'test',
      // 绘制计数、DOM/位图与像素比对、隔离产物冒烟都在真实 Electron 里测量绘制与帧，负载会改变结果。
      // 计数校验只读探针结果、耗时为零，和探针放在同一段独占时间里，不与其他步骤交错。
      'Check drawing workload on Linux': 'loadSensitive',
      'Check drawing workload on macOS and Windows': 'loadSensitive',
      'Verify software drawing counts and bounded resources on Linux': 'loadSensitive',
      'Verify drawing counts and bounded resources on macOS and Windows': 'loadSensitive',
      'Compare DOM and bitmap content on Linux': 'loadSensitive',
      'Compare DOM and bitmap content on macOS and Windows': 'loadSensitive',
      'Verify identity and overview label pixels on Linux': 'loadSensitive',
      'Verify identity and overview label pixels on macOS and Windows': 'loadSensitive',
      'Diagnose Linux large-cluster paint lifecycle independently': 'loadSensitive',
      // 专项冒烟运行真实 Electron，独占执行；单独运行时还会构建 schemas 和 Canvas 制品。
      'Verify isolated Canvas artifact on Linux': 'loadSensitive',
      'Verify isolated Canvas artifact on macOS and Windows': 'loadSensitive',
    },
  },
  'ci.yml': {
    architecture: {
      'Install dependencies': 'build',
      'Lint code': 'static',
      // GitHub 上这个任务不做任何构建；门禁按 Git 清单、tsconfig 或固定源码根目录读取文件，跳过 dist/node_modules。
      'Run public architecture gates': 'static',
    },
    packages: {
      'Install dependencies': 'build',
      // schemas / provider 包的 pack-smoke 会 rimraf 并重建各自 dist；Canvas Backend 运行时从 dist 解析 @app/schemas，
      // 所以它和测试不能重叠。
      'Verify public packages': 'build',
      'Run Canvas business cases': 'test',
    },
    'test-shards': {
      'Install dependencies': 'build',
      'Build WASM': 'build',
      'Build Backend and its workspace dependencies': 'build',
      'Build Canvas worker for Host integration tests': 'build',
      'Build Electron Main': 'build',
      // 本地把全部分片合并为一次运行（见 buildLocalCiLanes），合并后的运行不与其他测试重叠。
      'Run tests without external credentials': 'test',
    },
    tests: {
      'Require every test shard to pass': 'test',
    },
  },
  'platform-build.yml': {
    'source-build': {
      'Install dependencies': 'build',
      'Verify native packaging command entry': 'static',
      'Verify artifact evidence on the target platform': 'static',
      'Package and verify official plugin lifecycles from a clean checkout': 'build',
      'Build WASM': 'build',
      'Build Renderer': 'build',
      'Build Electron Main': 'build',
      'Build Preload': 'build',
      'Build Backend': 'build',
      'Build CLI': 'build',
      'Verify built CLI against bridge': 'test',
      'Prepare Runtime assets and build Worker on macOS': 'build',
      // 真实进程的启动、审批与退出有时限，构建结束后仍需独占运行。
      'Verify real Runtime lifecycle and approval on macOS': 'loadSensitive',
    },
  },
};

/** 合并测试分片时默认给其他并行步骤和系统留出的核数。 */
export const LOCAL_CI_TEST_WORKER_HEADROOM = 6;
/** 同时运行的步骤上限（含合并后的测试运行）。 */
export const LOCAL_CI_DEFAULT_CONCURRENCY = 4;
