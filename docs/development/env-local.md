# `.env.local` 开发配置

在项目根目录手动创建 `.env.local`，并只填写当前开发机需要的配置。该文件已被 Git 忽略，禁止提交真实凭据。

发布包不会读取启动 cwd 或仓库中的 dotenv 文件；本指南只服务开发环境。返回[开发指南总览](./README.md)。

## 推荐配置（开发机）

```ini
# 开发模式：只影响路径、热加载和诊断等源码开发行为，不代表官方发行身份
LINNYA_DEV_MODE=true

# 可选：自定义工作区根目录（默认开发模式为 `<项目根>/_dev_data`）
# LINNYA_WORKSPACE_DIR=/Users/you/Documents/Linnya

# ========== 知识图谱调试 ==========
# 开启：把图谱抽取的 LLM 原始输出 + 解析后的 JSON dump 到本地文件
LINNYA_KG_DUMP_JSON=1

# ========== 统一审计 ==========
# 可选启动默认档位；临时排障优先用 pnpm linnya:cli audit level behavior，无需改文件或重启。
# 低体积行为审计：Agent/run 身份、工具/命令行为、授权/拒绝和终态。
# LINNYA_AUDIT_LEVEL=behavior
#
# 需要上游响应摘要时使用 response；需要 canonical 文本/推理/工具参数等流式片段时使用 stream。
# 两者都会把安全投影后的证据写入同一个 workspace.sqlite，stream 还有单 run 256 片段 / 16 MiB 上限。
# LINNYA_AUDIT_LEVEL=response
# LINNYA_AUDIT_LEVEL=stream
# 排查完成后恢复 off，避免高体积审计长期运行。

# ========== API Keys（按你实际用到的填） ==========
# OPENAI_API_KEY=sk-...
# DEEPSEEK_API_KEY=...
#
# OpenRouter 可选 header
# OPENROUTER_HTTP_REFERER=...
# OPENROUTER_X_TITLE=...

# ========== Vite / 前端（只影响开发态） ==========
# dev:electron 由 Vite 绑定可用 Renderer 端口，OS 分配 Backend API 和 Qdrant HTTP 端口。
# VITE_DEV_SERVER_URL 是启动编排内部的进程协作变量，不需要写入 .env.local。
# 如需固定 Backend API 端口，可设置 LINNYA_API_PORT；各实例必须使用不同端口。
```

## 生效位置说明

- **Desktop / CLI Runtime 的 Backend 与 worker**：开发态启动时由 Host 共用的 `src/infra/adapters/development-environment/functions/bootstrapDevEnv.ts` 加载并传递；发布包明确跳过 dotenv 文件。
- **前端（Vite）**：Vite 会自动加载 `.env.local`，但只有 `VITE_` 前缀会暴露给 renderer 侧代码。
- **发行身份**：不从 `.env.local` 推导。未打包运行固定为 `source`，未通过受信发行清单验签的安装包固定为 `community`。

## 多工作目录并行开发

每个 clone/worktree 独立安装依赖后，在各自目录运行相同的 `pnpm run dev:electron` 即可并行启动。
源码 Desktop 在申请单实例锁之前，把 Electron profile 与 session 存储隔离到当前真实目录的
`_dev_electron/`；业务数据仍使用原来的 `_dev_data/`。两者分开，避免 profile 的创建让空业务目录
被误判为缺少 epoch marker 的旧数据。首次使用独立 profile 时，浏览器本地偏好会重新初始化，
用户安装的插件也改用各自 profile 下的 `plugins/`；旧 profile 内的插件需在新实例重新安装。
仓库内的官方插件仍从本工作目录加载。不复制旧的全局 Electron profile，不迁移或删除数据库、凭据与文档。

同一目录仍只允许一个 Desktop owner；若显式让多个目录共用 `LINNYA_WORKSPACE_DIR`，Backend 的
Workspace 排他锁仍会拒绝第二个 owner。不要共享数据库来规避这条约束。测试显式传入的
Electron `--user-data-dir` 优先于默认 profile，打包应用继续使用原有生产路径。

Renderer 由 Vite 从 5173 起直接绑定可用端口（不再限制到 5174）；API 使用 OS 分配的回环端口。
Backend 只接纳当前 Host 传入的精确开发页面 origin，
不开放任意 localhost origin。开发 Qdrant 同样直接绑定随机 HTTP 端口，关闭没有消费者的 gRPC
监听；实际端口由所持有进程的监听事实返回，摄入与图谱 Worker 都使用同一地址。
窗口标题包含工作目录名称，DevTools 快捷键只作用于当前窗口；日志记录 profile、Renderer URL 与实际 API 端口。

开发实例的 CLI 连接文件默认位于 `_dev_electron/runtime/conversation-control-v1.json`，不会覆盖
用户级默认连接。`pnpm linnya:cli` 默认读取自身源码目录的该文件，不需要设置环境变量；
`pnpm linnya:runtime` 启动的无界面实例也使用该位置。实例未运行时直接报错，不回退到安装版。
显式设置 `LINNYA_CLI_CONNECTION_FILE` 仍优先，但握手必须核对双方真实源码根；不一致时拒绝并显示两边目录。
符号链接归一后比较，分支仅用于显示。多个实例须指向不同文件。覆盖路径须放在专用运行目录中，不要把连接文件直接放在个人主目录或项目根目录。连接文件按当前用户权限保存，但不提供 Agent 读取隔离。App 启动的命令继承当前实例的连接路径。

升级到该机制后，需要正常退出旧开发会话，再在各目录重新启动；源码合并不会自动替换正在运行的 Backend。

## 运行中切换审计

使用 `pnpm linnya:cli audit level behavior`，可选 `off / behavior / response / stream`；不传档位显示当前值。
`doctor` 显示所连目录、分支和当前档位。错误中的 `connection` 保留已知身份，未连上时实例与档位未知。

开关只影响所连源码 Host 的新 run，不影响其他分支、已开始的 run、其 child、暂停/HITL 继续或延迟 Shell 终态。
同一会话之后的新 run 使用新档位。读取仍用 `audit <会话ID> --run <runID>`；关闭后可读历史，开启前的记录不会补回来。

Desktop 和 Runtime 共用 dotenv 加载：显式进程环境优先，其次 `.env.local`、`.env`，都只补齐未设置的变量。
CLI 切档不写文件；重启恢复启动配置，没设就是 `off`。若希望每次启动自动打开，继续在 `.env.local` 设置
`LINNYA_AUDIT_LEVEL`。生产 Host 一律拒绝审计，提示“生产环境不提供审计”。
