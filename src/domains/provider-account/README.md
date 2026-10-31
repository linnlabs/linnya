# Provider Account

`provider-account`
拥有用户对正式模型供应商完成授权后形成的账号，以及该账号凭据的生命周期。它与 Model
Catalog 的职责不同：目录描述模型和推理端点，账号描述 OAuth、套餐或设备授权身份。

## 边界

- OAuth access token、refresh token、ID token、过期时间和供应商账号 ID 进入
  `provider-accounts` namespace，由 App Server 注入的 `CredentialStoragePort` 持久化；
- 账号元数据与 token 一次原子提交，和模型、插件共用 profile 下的 `AIService/config/credentials.json`。
  不依赖系统钥匙串，不迁移旧账号凭据；文件损坏或读取失败保留原件并阻止保存。
  文件权限和并发规则见[文件凭据存储](../../infra/adapters/credential-storage/file/README.md)；
- Renderer、Provider Catalog、Model Catalog 和日志只允许看到不含凭据的
  `ProviderAccount`；
- ProviderAccount 只引用账号型 `provider_connection_definition_id`，不引用品牌 ID；
- 模型请求通过窄 credential resolver 引用 account ID，不自行刷新或解析 OAuth
  token；
- credential resolver 只附加账号身份头；`OpenAI-Beta`
  等协议头由具体请求 profile 拥有，不能随账号凭据传播到模型发现或图片生成；
- 模型选择工作流只通过窄 `hasCredential(accountId)`
  port 读取账号当前是否有可用凭据；退出登录保留 ConfiguredProvider 和已添加模型，但它们立即变为不可用，重新授权后自动恢复；
- 浏览器打开、loopback callback、token HTTP
  exchange 属于授权 workflow，不进入 registry。

本 domain 还拥有“使用账号短期凭据读取该账号可见模型”的窄能力，但不保存第二份模型目录。ChatGPT 在授权后请求官方
`GET /backend-api/codex/models?client_version=...`，只投影 picker 可见模型、窗口、有效输入比例和输入模态；响应正文、模型指令和 token 均不进入日志或 Renderer。

这里的 `client_version` 是 Codex 目录兼容版本，由 `chatgpt-model-discovery/definitions` 独立维护；
Linnya 的产品版本只进入 `User-Agent`，不能用于上游模型可见性筛选。当前兼容基线为 `0.165.0`，
已验证目录解析与可见模型投影；后续调整须复验目录合同，不读取本机 Codex 安装版本，也不依赖 Codex SDK。
空目录仍明确失败，不能用本地静态模型填充或删除账号原有模型。

授权成功后的模型目录落地不属于本 domain。App-level 授权 workflow 在凭据安全落盘后调用 Provider
Onboarding 的窄同步端口；同步从上述账户目录注册新模型，原位刷新已存在模型的名称、容量和能力，并通过统一 durable 删除用例退出当前账号已不可见的历史模型，幂等复用同一 ConfiguredProvider、InferenceEndpoint 与 account
reference。可用的已有凭据在本地启动恢复完成后沿同一用例后台补同步，远端目录不属于 App Server ready 的前置条件；因此进程中断、上游容量变化或历史静态目录数据都无需用户重新登录、也无需手动删除重加；
凭据文件无法读取时不能当作登出或删除账号；修复文件并重启后恢复读取。

模型发现接收调用方的取消信号，与自身 HTTP 超时共同约束目录请求。凭据 resolver 的 OAuth refresh 可能被推理
共享，不能随单个目录请求一起取消；取消发生在共享 refresh 期间时，等待 refresh 收口后立即停止目录请求。
授权 workflow 在登出或替换凭据前等待旧同步结束，避免旧刷新重新写回已退出的账号。

账号还可能拥有不属于 `/models` 语言目录的产品能力。当前 App-level
`provider-account-model-projection` 在 ChatGPT 凭据落盘或启动恢复后，把
`gpt-image-2` 作为 `catalog_source: account` 的图片模型投影到进程内 Model
Catalog；退出登录时同步移除。该投影不持久化、不复制 token，也不把图片模型伪装成可发现的对话模型。图片执行复用同一个 request
credential resolver，直接进入独立的 Image Generation Host adapter。
账号能力模型的 UI 名称直接使用 Provider 模型 ID；连接来源由模型选择器单独表达，不维护容易随上游更新而失效的本地美化别名。

静态 Key 型订阅产品不进入本 domain。Kimi Code 与 GLM Coding
Plan 的 Key、endpoint 和模型归属分别由 Provider Configuration、Model
Catalog 与 Provider
onboarding 拥有；“订阅”只是产品额度语义，不能据此创建 OAuth 账号或与普通 API
connection 共用凭据。

ChatGPT loopback 是一次性 HTTP 能力：回调页必须声明
`Connection: close`，workflow 关闭监听时必须同时终止既有连接，不能等待浏览器自行释放 keep-alive
socket。凭据落盘成功后，回调服务器清理不得把授权成功响应永久阻塞；授权阶段日志只记录流程节点和稳定错误码，禁止记录 authorization
code、state、PKCE verifier 或 token。
浏览器回调页只确认授权回调已收到，最终账号连接和模型同步结果在 Linnya 中展示。
