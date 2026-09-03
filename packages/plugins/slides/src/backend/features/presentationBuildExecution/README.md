# Presentation build execution

该 feature 是 Slides 可信构建工作负载的物理执行边界。它不拥有 presentation、revision、draft、Workspace 或数据库事实；只接收严格 DTO，执行 CPU 工作并返回严格结果。

## 当前范围

当前已把 `deck.js` TypeScript typecheck、Flex/Yoga compose/layout 与 PptxGenJS/JSZip PPTX 物化从 App Server / Electron Main 调用线程迁入单一长期 `worker_threads` Worker。生产 coordinator 只能通过 `PresentationBuildExecutionPort` 请求可信构建；CLI 和直接构造的测试 coordinator 可显式使用 in-process adapter，因为它们不和桌面 UI 共用事件循环。

作者 `deck.js` 仍由 Profiled Code Sandbox 执行；它产生的严格 JSON compose DTO 才进入可信构建 Worker。Worker 不执行作者代码。Direct compose 在 Worker 校验后保持公开输入形态；Flex compose 在 Worker 完成 Yoga 编译，App Server 通过专用可信结果读取器复验并保留 text wrap、SVG 中间态和 generated layout constraint evidence。普通 deck.js 输入不能伪造这些内部编译事实。

PPTX 物化前的数据库、Workspace、图片授权、本地图片读取与 SVG hidden-renderer fallback 仍由 coordinator 所在的 Host 侧准备；准备层只生成自包含内存 DTO。Worker 不接触路径 resolver、数据库或浏览器能力，只执行 PptxGenJS、OOXML 清理与 ZIP 编解码，并通过 transferable `ArrayBuffer` 返回结果。旧 `EngineExecutionAdapter` 仍是业务调用边界，但生产注入的 `DeckAssemblerPort` 已由本 feature 实现，不存在自动回退到 in-process PPTX 的第二条生产路径。

## 目录与责任

- `definitions/`：port、稳定内部错误和 protocol DTO。
- `functions/`：compose/layout 纯计算、request/response codec 与 artifact 路径纯函数。
- `infrastructure/`：Node Worker transport、worker entry 和测试/CLI 使用的 in-process adapter。
- `orchestration/`：单 Worker 生命周期、串行 dispatch、feature-local 有界等待和共享 runtime 装配。

## 生命周期与容量

- Worker 在第一次 typecheck、compose/layout 或 PPTX materialize 时惰性启动；同一 Slides runtime 只创建一个。
- 同时只执行 1 个请求，最多等待 2 个；满额立即产生 `slides.environment.build_executor_busy`，不建立全局队列。
- startup deadline 为 10 秒；typecheck 与 compose/layout deadline 为 15 秒，PPTX materialize deadline 为 60 秒。超时或 crash 会失败当前和已接纳的等待请求，不透明重放；之后新的用户请求可创建新 generation。
- 插件停用和 App shutdown 必须等待 `close()` 终止 Worker。Worker 不打开数据库、不写 Workspace，也不创建 GUI、BrowserWindow 或 App identity。

## 协议与制品

协议版本、request id、source/payload byte limit、严格 JSON 值与全部结果字段都经过 codec 校验。Flex 编译结果只有在 Worker 内通过 compiled compose 语义复验后才能返回成功；非法自定义几何等源码问题返回 `compose_contract` 及具体字段路径，不能伪装成 Worker 或协议故障。App Server 仍会在消费端复验同一结果，形成跨进程边界的双向合同。PPTX 输入额外限制 slide、element、SVG 数量以及 JSON/二进制总字节，拒绝任何未物化的文件路径；公式 element 与 inline formula run 必须通过 `shared/mathFormula` 的 canonical admission，不能在 Worker codec 另建一套公式定义。结果必须是 64 MiB 内的 ZIP，并以 transferable `ArrayBuffer` 返回。领域对象里的 `undefined` 可选字段在 Worker 边界统一投影为真实 JSON，诊断条数和文本长度也在出口截断，避免极端输入把大结果解析成本重新带回 UI 共享进程。

Host 发送前发现的 materialization DTO admission 失败属于确定性的 `contract` 错误，并投影为 `slides.materialization.contract_invalid`。它表示内部 DeckSpec 与 Worker 合同失配，Agent 不应重试或改稿。Worker 内的 `MathFormulaError` 通过独立 `formula` failure 保留稳定 code：作者可修正的 LaTeX、宽度和行高问题只失败当前请求且继续使用健康 Worker；公式投影或 PPTX patch 缺陷则交由 build-failure 策略阻止随机改稿。只有 Worker 启动、协议响应、超时、未知执行异常或 crash 才属于 `build_executor_unavailable`。这三类语义会直接影响 Agent 的恢复动作，禁止重新合并。

发布制品固定为 `dist/backend/presentation-build-worker.cjs`。backend build 会用真实 Worker 验证合法/非法 TypeScript、从发布目录加载 Yoga 完成一次 Flex 编译，先确认不支持的 LaTeX 返回稳定公式 code，再实际生成、解压一份包含 block/inline 原生公式的 PPTX，确认同一 Worker 可继续工作、OMML 存在且 placeholder 已清零；同时把 Worker 限制在 1.6 MiB、完整 backend 限制在 16 MiB。生产缺少 Worker、Yoga helper、PptxGenJS/JSZip 或 runtime 制品时 fail closed，不回退到 App Server 内执行。

开发态 `pnpm run dev:electron` 同样先执行 Slides 正式 backend build，并在启动 Electron 前等待该 Worker 制品存在。不能只构建 inline App Server backend：inline bundle 负责插件源码入口，不会替代插件自有的 Worker 与运行时资源。

Flex 的同步文本估算复用 `@linnya/text-measurement-core`。该 portable package 与宿主共享同一 deterministic heuristic，Worker 不反向加载 Plugin SDK、Electron 或 Main 的文本测量装配。
