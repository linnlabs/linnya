/**
 * 安装包里真正要以 node_modules 形式存在的根依赖。
 *
 * Main、App Server、Worker 和 Renderer 的 npm 依赖绝大多数已经被打进各自的 bundle，
 * 再装一份只会让安装包多出一百多 MiB 没人加载的文件。所以生产安装清单只留这里列出的包，
 * 它们的传递依赖由 npm 按冻结 lock 装齐。
 *
 * 名单不靠人记：`guard:production-runtime-dependencies` 会扫描成品里每个 Node 侧脚本实际 import 的包，
 * 漏登记（成品要用但装不到）和多登记（列了却没人用）都会让打包失败。
 * 新增一个不能内联的依赖（原生模块、按包目录找资源的包）时，同时改 bundler 的 external 和这里。
 */

/** 成品脚本里有静态 require/import 的包；门禁能从构建产物里直接看到。 */
export const staticallyLoadedProductionDependencies = Object.freeze([
  '@app/schemas',
  '@napi-rs/canvas',
  '@node-rs/jieba',
  'better-sqlite3',
  'fontkit',
  'harfbuzzjs',
  'node-pty',
  'pdfjs-dist',
  'prism-media',
  'sharp',
  'tiktoken',
  'wave-resampler',
  'yoga-layout',
]);

/** 运行时才拼出加载调用、静态扫描看不到的包；每条写明谁在加载，门禁只能核对它们确实装上了。 */
export const dynamicallyLoadedProductionDependencies = Object.freeze({
  // prism-media 按名字探测 Opus 实现（它的可选 peer），音频 Worker 解码录音靠它。
  '@discordjs/opus': 'prism-media 的 Opus 解码器探测',
  // deviceId.ts 用 createRequire 加载，bundler 不会内联。
  'node-machine-id': 'Cloud 模型目录的设备标识',
});

/**
 * 成品脚本里出现、但本来就不从安装包 node_modules 解析的引用。
 * 插件 artifact 自带 node_modules 里能找到的包不算在内，门禁按脚本所在目录先行解析。
 * 不在这里的包名一旦解析不到就是漏依赖。
 */
export const productionImportsResolvedElsewhere = Object.freeze({
  electron: 'Electron 运行时内建',
  '@plugin/backend': '插件后端加载时由 Host 在内存里提供（backendHostModuleResolver）',
  canvas: 'linkedom 的可选增强，找不到时用自带 shim',
  'livekit-client': 'AI SDK 的 Mistral 实时语音可选依赖，产品未使用',
});

export const productionRuntimeDependencyNames = Object.freeze([
  ...staticallyLoadedProductionDependencies,
  ...Object.keys(dynamicallyLoadedProductionDependencies),
].sort());
