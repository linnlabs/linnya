# Model Request Auth

本目录是 Linnya Host 发起模型 HTTP 请求时的统一认证材料解析边界。它连接 Model Catalog 中的窄 `CredentialReference`、本机凭据/环境变量与 Provider Account，但不拥有 Provider 协议、模型目录或业务重试。

## 边界

- `definitions/` 只定义一次模型请求需要的 secret、认证 profile 和 credential 附属请求头。
- `orchestration/` 按模型 ID 解析当前 credential：Provider Account 取短期 token 与附属请求头，其余从本机凭据或环境变量取 secret；缺失时抛出凭据错误，不换用其他凭据。
- Language inference、图片生成与 remote token count 依赖本目录公开入口，不能各自读取凭据或 ModelConfig 通用 header map。
- Provider 主认证头仍由对应协议 capability 根据 `profile + secret` 生成；本模块不拼 `Authorization`、`x-api-key` 或厂商版本头。
- Web Search / Web Read 不是模型请求，不依赖此模块；它们由 Web domain 自己拥有服务认证合同。

新增 credential 类型时，必须先扩展 Model Catalog 的严格 `CredentialReference` 联合类型，再在本边界实现唯一解析规则与业务测试。禁止恢复任意 header 配置、按 URL/模型名猜认证或在请求失败后切换凭据。

客户端不再内置 Linnya Cloud 模型接入（目录、宿主管理凭据、设备标识与发行开关已整体删除）。将来 Cloud 重新向客户端提供模型时，按账号登录与服务端 entitlement 重新设计，再从这里接入，不恢复旧的匿名设备标识方案。

OAuth/device-flow Provider 落地时，本目录仍是请求时解析的唯一入口：InferenceEndpoint 只保存稳定的 `provider_account` credential reference，本目录调用 Provider Account 的窄 credential port 完成过期检查、单飞刷新和短期 token/必要 header 解析，再返回与静态 Key 相同的 attempt-scoped DTO。access/refresh token 不进入 Model Catalog、ConfiguredProvider、Linnkit 或 Renderer；授权刷新也不占用 Linnkit inference retry budget。
