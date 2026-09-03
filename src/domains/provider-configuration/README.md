# Provider Configuration Domain

`provider-configuration` 是正式 Provider
connection 本地配置身份与模型归属的唯一 owner。它回答“用户已经配置了供应商品牌下的哪条接入方式、哪些本地 ModelConfig 来自该 connection”，但不保存 Provider 展示资料、secret、endpoint、route 或模型能力。

## 边界

- `ProviderDefinition` 与 `ProviderModelDefinition` 仍属于 `provider-catalog`；
- `ModelConfig`、`InferenceEndpoint` 与 credential 密文仍属于 `model-catalog`；
- 本 domain 只保存 `ConfiguredProvider`
  对 ProviderDefinition/ProviderConnectionDefinition 的稳定引用，以及
  `ConfiguredProviderModel` 归属；唯一性按 connection
  ID 约束，同一品牌的 API 与订阅/Coding Plan 可以同时存在；每个模型使用的
  `InferenceEndpoint` 只由 `ModelConfig` 引用；
- Custom API 不创建 ConfiguredProvider，不能把 URL
  host、连接名称或模型名当成 Provider；
- Agent loop、AI SDK、推理请求、retry 和 Renderer 状态不属于这里。

API-Key Coding Plan 与普通 API
Provider 使用同一套 ConfiguredProvider 合同。OpenCode Go/Zen、Kimi Code、GLM
Coding Plan、Alibaba Coding
Plan 等产品即使按月订阅，只要客户端最终拿到的是静态 API
Key，就不需要 ProviderAccount，也不在本 domain 增加套餐、额度或 entitlement 字段。

未来 OAuth/device-flow Provider 接入后，账户身份与 token 刷新由独立 Provider
Account 边界拥有；本 domain 仍只保存 ProviderDefinition 和 ModelConfig 的稳定关联。ConfiguredProvider 不保存 endpoint、account、access
token、refresh token 或授权状态镜像，InferenceEndpoint 通过窄 credential
reference 连接请求时认证解析器。

## 持久化与跨文件事务

配置写入 Workspace Models 目录的 `provider_configurations.json`，当前版本为
`3.0.0`。Repository 会把 `1.0.0` 中重复保存的 Provider 顶层 endpoint 和 `2.0.0`
的单层 Provider ID 精确迁移到当前 connection
identity，并立即覆盖写回。`openai/chatgpt/moonshot/zai`
使用冻结映射，既有 endpoint、Key、ModelConfig 和模型归属不重写；除此之外，未知版本、未知字段、文件损坏和重复 connection 直接失败，不保留运行时双读。

Provider 归属与 `user_models.json` 分属两个 domain，注册/删除必须先写 durable
intent，再修改 Model Catalog，最后提交归属：

```text
persist intent -> mutate Model Catalog -> commit association
```

进程若在中间退出，启动恢复只按 intent 中已经保存的 `model_config_id` 与
`inference_endpoint_id`
完成或撤销，不读取 URL、模型名前缀或 Provider 文案猜测。`inference_endpoint_id`
只存在于事务 intent，提交后的归属不重复保存它。普通失败由 application use
case 取消 intent；domain registry 不反向调用 Model Catalog。

## 目录

```text
provider-configuration/
├── definitions/                 # 公共实体、snapshot、repository port
├── features/
│   └── configuration-persistence/ # 单版本 JSON codec 与文件 adapter
├── registry/                    # 唯一内存索引、intent 状态机、启动恢复
├── index.ts                     # 跨 domain 唯一入口
└── README.md
```

跨 domain 只能依赖根 `index.ts`。Provider
onboarding、删除和一次性开发数据迁移属于 application use
case；它们通过本 domain 的窄命令与 Model Catalog 协作。
