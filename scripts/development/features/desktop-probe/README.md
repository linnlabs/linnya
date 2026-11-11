# Desktop 开发探针

前端调试与本机界面验收优先用 `pnpm -s probe`。探针运行当前 checkout 的真实 Electron、Preload、App Server 和 Vite。默认窗口隐藏，使用独立的临时 profile、Workspace、插件目录、CLI 连接文件、端口和 Vite 缓存。可以和同一目录的 `dev:electron` 同时运行。

需要 macOS、Node 24 和已安装的工作区依赖。`up` / `restart` 启动前比对 Main、Preload、Backend 产物与会进入这些产物的源码，任一产物过期就先运行 `pnpm run dev:electron --build-only`，结果的 `build` 报告是否重建、原因与耗时，构建输出写入当前 worktree 探针临时目录的 `build.log`。同一 worktree 的多个实例同时启动只构建一次。Renderer、样式和测试文件不触发重建，由 Vite 热更新。用 `--no-build` 改为报 `BUILD_STALE`。复用已运行的实例时只提示 `buildStale`，用 `restart` 载入新构建。Renderer 与 Backend 产物不同步导致 RPC 被拒时，启动立即失败为 `BUILD_MISMATCH`，不等超时。重启保留 Workspace 和 profile，并优先复用 Renderer 端口。端口被其他进程占用时 Vite 会选新端口，依赖 origin 的界面偏好会按新页面初始化。

## 从快照到回归

1. `pnpm -s probe up --size 1400x900` 启动或复用当前 worktree 的 `default` 实例。就绪以首屏出现且 Renderer 插件加载结束为准，加载失败时结果带 `pluginLoad: "failed"`。用 `--name <实例>` 并行验证其他场景。结果中的 `viewport` 是启动时实测的内容区尺寸。如果窗口最小尺寸等约束调整了请求值，`sizeAdjusted` 为 `true`，原请求保存在 `options`。
2. 已知 ID 时用 `pnpm -s probe open <ID>` 直接打开对话、文档或项目，省去在界面里逐层寻找。`pnpm -s probe snapshot --grep 设置` 只看相关几行；知道文字时目标直接写 `text=设置`。按返回的 `@n…` 执行 `click`、`hover`，或用 `shot @n… --pad 8` 截取局部。页面刷新后重新取引用。
3. `pnpm -s probe wait --selector '.project-overview' --state visible` 等业务条件成立。看动画结束画面用 `wait --settle`，看过程用 `record`。
4. 拖动验收用 `drag --by 80,0 --steps 8 --sample '<求值表达式>' --expect-follow x`。表达式返回分隔线或目标的 CSS 像素坐标，探针比较每一步的值与指针位移。
5. `pnpm -s probe logs --level error` 查看 Renderer 报错。验证完成用 `stop` 保留日志和截图，或用 `stop --clean` 回收整个探针实例。

`pnpm -s probe` 每次输出一行 JSON。失败返回非零退出码与 `error.code`、`message`、必要时的 `hint`；命令或选项写错时 `hint` 给出最接近的写法（如 `list` → `status --all`、`screenshot` → `shot`）。截图、完整快照和录制数据用 `artifacts[].path` 打开。短命令可直接用 `node scripts/development/features/desktop-probe/bin/probe.mjs`，省去 pnpm 启动时间。

## 命令

| 命令 | 用法 |
| --- | --- |
| `up` / `restart` | `--name <实例>`、`--window hidden\|inactive\|visible`、`--mode dev\|bundled`、`--size 1400x900`、`--fresh`、`--no-build`。默认 `dev` 加载当前工作区的开发插件。仅在停止后用 `up --fresh` 清空隔离数据。用 `restart` 应用新启动选项。 |
| `up --clone-data <目录>` | 停止状态下把一份 Linnya 数据目录（含 `workspace/workspace.sqlite`，如 `_dev_data`）以 APFS 写时复制克隆进实例，替换实例原有 Workspace。同卷克隆瞬时完成，几乎不占空间。只读源目录，不打开源库。跳过基准结果、对话工作目录、日志、缓存与运行锁。模型凭据在 Electron profile 里，不随数据克隆，克隆实例里用户配置的模型显示缺少凭据；需要真实模型的 Agent 试跑在日常开发实例里做。源库正在写入时在副本上做 `quick_check`，不一致则报 `CLONE_INCONSISTENT`。 |
| `open` | `open <ID>` 只读查询实例数据库，识别对话、文档或项目，再通过 Vite 取 Renderer 正在使用的导航端口打开，与用户点击走同一条链。`open assistant` 回到 Linnya 助手，`open <ID> --overview` 打开该对象所在项目的概览。仅 `--mode dev`。 |
| `status` / `stop` | `status --all` 列出当前 worktree 的实例。状态含 CDP、Vite、API 端口、日志位置和 `workspaceDb`（实例 Workspace 数据库，只读核对数据时用；`up` 结果里也有）。停止会先关 Desktop 再关 Vite。 |
| `snapshot` / `shot` | `snapshot --within @n25 --all --max-lines 100 --json`。`--grep <文字>` 按名称和值过滤（不分大小写，含正文），`--role button,link` 按角色过滤，两者只保留命中项及其祖先链。截图接受引用、`--selector <css>` 或 `--clip x,y,w,h`，支持 `--pad`、`--device`、`--jpeg`。默认 1× CSS 像素。`timing` 分别报告等待画面稳定和 CDP 抓取的耗时。 |
| `fonts` | `fonts @n25 text=workspace` 返回每个目标的声明字体栈、字号字重与 Chromium 实际排版字体（`CSS.getPlatformFontsForNode`）。首个具名字体未生效时 `firstDeclaredUsed` 为 `false`，常见于字体名写错或系统匹配不到。 |
| `click` / `dblclick` / `hover` | 目标为 `@n25`、`text=<文字>`、`--selector <css>` 或 `--at x,y`。`text=` 取直接含该文字的可见元素，文字被拆成多段时取包含它的最内层可见元素；多个命中时依次优先文字完全相同的、指针点得到的、弹出层（菜单、列表框、对话框、fixed 层）里的。仍分不出就报 `AMBIGUOUS_TARGET`，`hint` 列出候选的 `@n` 引用，不静默挑第一个。选择器和引用会检查可见性、位置稳定和命中。坐标用于明确指定像素位置。 |
| `type` / `press` | `type '中文' [@n25]`，`press Meta+A`、`press Escape`。macOS 编辑快捷键支持 `Meta+A/C/X/V/Z` 和 `Shift+Meta+Z`。复制、剪切和粘贴使用系统剪贴板。 |
| `drag` / `scroll` | `drag <目标> --by=80,0` 或 `--to <目标>`。支持 `--sample`、`--expect-follow x\|y`、`--tolerance 2`。`scroll <目标> --dy 400`。 |
| `wait` / `eval` / `reload` | `wait --selector <css> --state attached\|visible\|hidden\|detached`，或 `--text`、`--expr`、`--settle`。`eval` 的表达式在 Renderer 执行，返回 JSON 值。 |
| `logs` | `--source renderer\|desktop\|vite\|supervisor`、`--level error\|warn`、`--since <cursor>`、`--grep <文字>`、`--limit 50`。资源加载失败的日志附带 URL。重启会开启新日志，旧 cursor 需重置。 |
| `record curve` | `record curve --target '.menu' --props opacity,width --duration 800 -- click @n25`。逐帧取计算样式及包围盒，曲线时间从开始采样算起，数字属性附时长、进度、超调与单调性。 |
| `record frames` | `record frames --target '.menu' --at 0,40,80,160,300 -- click @n25`。动作完成后逐帧等候 CSS/WAAPI 动效，最多 300 ms。捕获后暂停、按时间拼图，再恢复。动作后才挂载的菜单用 CSS 选择器。JS 驱动的变化用曲线。 |
| `fixture project-overview` | 通过该实例的开发 CLI 生成独立项目、嵌套文件夹、Markdown 和 Slides。返回项目 ID，验证时打开该项目的概览。 |

`--name` 适用于每条命令。负数参数使用等号，如 `--by=-60,0`。默认隐藏模式仍使用真实页面绘制和 CDP 可信输入。探针主窗口禁用 Electron 后台绘制节流，保证长时间隐藏后仍能快速抓图。隐藏和 `inactive` 模式会模拟应用收到的窗口焦点通知，悬停提示可用，系统前台应用保持不变。`--window inactive` 适合人眼旁观，`visible` 允许正常激活窗口。系统菜单、原生对话框、输入法候选窗和系统拖放需走对应的桌面验收。

## 归属与测试

常驻看管进程保存状态、Renderer 日志和进程身份，CLI 每次临时连入。Vite 单独运行，因为它的信号处理会结束所在进程。Desktop 以本次启动的就绪日志为准，CDP 只开放本机回环。停止只向探针记录且身份匹配的进程发送信号。Desktop 收到停止信号后先把 localStorage 等写盘，再按正常退出流程关闭，重启后界面偏好仍在。30 分钟没有命令时实例自动退出。临时目录只对当前用户开放，CDP 可被同一台机器上的其他进程访问，应用仅供开发验证。

看管器意外退出后，`stop` 会清理身份匹配的 Electron、Vite 和已记录的子进程，`up` 也可清理后复用原隔离数据。启动和停止由 Node 内置 SQLite 的文件锁互斥，持锁命令退出后由系统释放。旁边的 `*.lock/owner.json` 记录持锁 PID 与启动时间，强制退出留下的记录会在下次接管时更新。

- `pnpm run test:desktop-probe` 运行输入合同和隔离边界检查，再跑玩具 Electron。验收含可信点击、中文输入、编辑快捷键、逐步拖动、延迟两帧的过渡、定格一致性、看管器强杀及锁接管。
- `pnpm run test:desktop-probe:real` 在真实 Linnya 验证知识库跳转、项目夹具、真实筛选菜单定格、隐藏及 inactive 的设置提示、逐步列宽、Slides、实际窗口尺寸和异常退出后的进程清理。
- `pnpm run test:desktop-probe:idle` 让真实隐藏实例空闲 10 分钟，验证帧率、定时器和截图。
- 场景脚本复用 CDP 与动作模块。交互回归继续走真实应用的正式导航、读写和持久化合同。

探针位于开发脚本层，产品代码与安装包不依赖它。Electron 升级时先跑玩具验收检查窗口拦截、调试协议与截图行为。
