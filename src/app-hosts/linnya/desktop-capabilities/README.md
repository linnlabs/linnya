# Desktop Capabilities

这里定义 App Server 可以向 Electron Desktop Host 请求的窄能力，不暴露 `app`、`BrowserWindow`、`ipcMain`、
`shell` 或任意方法调用。每个 capability 必须有 data-only 合同、唯一 composition owner 和独立安全边界。

当前 credential protection 在初始化/写入时异步调用系统安全存储；Provider Account 与 Model Catalog 完成初始化后，
只在 App Server 内存中持有解密缓存，推理热路径不会跨进程等待。密文仍由各业务 domain 自己持久化，Desktop Host
不拥有账号或模型目录。reverse RPC 只注册 `encrypt/decrypt` 两个严格字符串 DTO 方法；App Server 业务层仍只取得
`DesktopCredentialProtectionPort`，不会接触 method name 或 raw RPC peer。

Backend renderer integration 只发布已有 Model Catalog、Ingestion/任务队列、知识图谱、转录进度、Workspace mutation 和已校验的插件 push
事实，并拥有 Model Catalog 订阅的释放函数。Backend 不读取 BrowserWindow；迁移前由 Electron adapter 投影到原
IPC，迁移后由 App Server reverse RPC 投影，Renderer channel、payload 和 UI 行为保持不变。通用 task-queue、
Transcription、Knowledge Graph、Workspace feature 与插件 SDK 都只看到自己的窄数据合同。插件是否启用与 channel
声明仍在 Backend 内校验；Desktop adapter 只负责把已通过校验的 envelope 发到既有 `plugin:push` channel。
Model Catalog bridge 会等待 Desktop 订阅安装完成后才允许 Backend 启动继续；其它已有事实通过逐类严格 DTO 的
单向 publish RPC 投影，Backend 不能提交任意 Renderer channel 名。

Backend hidden worker runtime 保留已有插件 `hiddenWorkers` contribution、worker id、codec、同步 registry 与调用语义。
`createBackendHiddenWorkerRuntime` 在 Backend 内把请求、取消和响应编解码，Desktop 的
`DesktopHiddenWorkerHostPort` 只接收 worker descriptor 与已经编码的原始 envelope，不接收 codec function、插件实例或
Electron 对象。当前 Electron adapter 继续拥有隐藏 `BrowserWindow`/`ipcMain`、超时、空闲回收与窗口销毁；Backend 插件
注册表和插件 SDK 不再 import `electron-main`。迁移到 App Server 后由 reverse Desktop RPC 实现同一个 data-only host
port，不新增插件接口，也不改变 Renderer 的 Slides raster 等交互。正式 RPC server 还必须对 HTML/preload artifact
路径做 admission，不能把任意路径加载能力开放给 Backend 请求。
Hidden Worker 的 register/touch/invalidate 使用严格小 DTO；ready 与 invoke 使用带随机 operation/token 的 AppData
私有 mailbox，因此 Slides 请求和 PNG 结果不会进入 1 MiB JSON frame。Desktop handler 由 composition 注入
artifact path admission，Backend 不能借 worker descriptor 加载任意 HTML 或 preload。

Browser Pretext 文本测量也沿同一宿主边界拆分，但不并入插件 hidden worker 接口：Backend 继续拥有
`MeasurementClient`、LRU cache、异步 prewarm 与同步 cache read/fallback 语义；Desktop Host 只拥有不可见
`BrowserWindow`、IPC 和空闲回收，并通过批量 data-only DTO 端口完成测量。当前 Electron composition 直接注入该端口；
App Server cutover 后改由 reverse Desktop RPC 实现相同合同。该迁移不会新增窗口、Dock App、前端状态或插件能力。
批量文本或 cluster request 同样通过私有 mailbox，worker availability 则在 bootstrap 时冻结，保持同步读取语义。

External authorization browser 只允许 Provider Account OAuth 请求 Main 打开已经由应用用例构造并校验的 URL。
Backend 不直接 import Electron `shell`，该能力也不会开放给 Shell、Profiled Code Sandbox 或插件。reverse RPC client
与 Desktop handler 都只接受 HTTPS URL；这是用户主动发起 OAuth 时的系统浏览器能力，与禁止 Shell 启动 GUI 是两条授权边界。

Desktop raster PDF capability 只接受有序 PNG bytes 与物理页面尺寸。Backend 插件 SDK 不取得 HTML、路径或
BrowserWindow 参数；Electron adapter 负责临时文件、无脚本 Chromium 窗口、打印、超时和清理。该边界为未来
App Server reverse RPC 保留同一合同，不把 Chromium runtime 打进 headless Backend。
PNG pages 与 PDF bytes 通过同一受管 mailbox 往返，RPC frame 只携带不可猜测引用；Desktop 入站仍复核页面尺寸、
非空 PNG bytes 与返回值，不把临时路径或 HTML 暴露给 Backend。

Web Read 的 Chromium fallback 同样由 Desktop Host 拥有隐藏页面与隔离 session。Backend 只取得原
`WebPageRenderer` port；URL、墙钟上限与渲染结果使用严格 DTO，取消沿 RPC signal 传到 BrowserWindow owner。
最终 DOM 允许达到既有 5 MiB 上限，因此请求与结果统一走私有 mailbox，不进入 1 MiB JSON frame；远程错误会还原为
原 `WebPageRenderError` kind，网页读取的 policy、timeout 与失败映射不因进程迁移改变。
