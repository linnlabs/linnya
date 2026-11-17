# Custom API Onboarding Use Case

本 use case 拥有“用户按 URL、API
Key、API 格式和模型资料注册自定义模型”的跨 domain 顺序。它不是 Provider
onboarding，不创建 `ProviderDefinition`、`ProviderAccount` 或模型 `provider`
字段。

## 公开用例

HTTP adapter 接收用户能理解的三种格式之一、HTTP/HTTPS
URL、可选 Key，以及单个模型字段或批量模型列表。共享 strict schema 先完成字段准入与 URL
规范化，再把两种 wire request 收敛成带非空 `models` 列表和明确 `provider_name` 的 Host
command；`registerModel` 只接收这份已准入命令。纯域名会按所选 API
格式补全默认 `/v1` 基线路径；只要用户填写了路径，就保留该显式网关路径，不再猜测或改写。

内部 route profile、auth profile、endpoint identity 和 capability
id 只由本 use case 的 `customApiRuntimeBindingRegistry` 决定，不进入 Renderer
command。

## 固定流程

```text
解析 CustomApiModelRegistrationRequest
  -> 归一化为 CustomApiModelRegistrationCommand
  -> 读取该 API 格式的 Host runtime binding
  -> 创建或复用内部 InferenceEndpoint
  -> 投影 User ModelConfig 与 typed route
  -> 按本地 model_config_id 持久化显式 picker_enabled 偏好
  -> Model Catalog 原子保存 endpoint、credential 与 model
```

显式提交新 Key 表示创建新的 credential
boundary；未提交 Key 时仅在格式、URL、认证完全一致且凭据可用的自定义 endpoint 唯一时复用；多个匹配连接可能属于不同账号，要求显式填写 Key。正式 Provider
endpoint 即使 URL 相同也不会被本流程复用。

发现列表中的开关表示快捷选择器可见性，关闭的模型仍会注册到目录。显式提交的
`picker_enabled` 由本 use case 通过窄 port 写入 Model Picker Preferences，不写进
ModelConfig；未提交时保留 picker 的默认规则，不生成偏好记录。

整批先提交偏好，再通过 `registerCustomApiModels` 一次发布目录，避免偏好写入失败后出现默认开启的模型，
也不会因后续模型出错而只保存半批。目录保存失败时，新 ID 的孤儿偏好由启动 identity reconcile 清理，
不会进入模型列表。偏好与目录属于不同持久化 owner，这不是跨文件事务；顺序保证失败残留不可见且可清理。

## 已保存分组刷新

`POST /api/v1/custom-api-onboarding/providers/refresh` 只接收 `provider_name`。Host 根据独立分组引用的
endpoint 取得 API 格式、地址与凭据，通过同一 Model Discovery 能力重新查询；Renderer 不读取密钥，
也不能覆盖刷新目标地址。首次添加的 `/discover` 仍使用表单中单向提交的 Key，两者不能混用。

分组可能包含多个连接，必须在第一次网络等待前同步固定整组的地址、协议与明文凭据快照，
避免并发编辑后将新 Key 发往旧地址。逐连接使用各自凭据，并以 endpoint 身份与 typed route 的
`endpoint_model_id` 判断已有模型，不能使用正式 Provider 的 `provider_model_id` 或显示名。已有模型的
本地 ID、用户编辑和选择偏好保持不变；新模型复用发现它的准确 endpoint，默认关闭，等待用户显式启用。
刷新是完整快照同步：远端已不存在的模型从当前分组移除，不能继续显示成已发现或可选模型。
Anthropic 列表按正式游标读取到最后一页；后页失败、循环游标或不完整分页均使本次发现失败。
无分页标记的兼容列表按其非分页合同接纳；OpenAI 兼容接口明确声明未完分页但没有已接入的分页合同则拒绝。
所有连接的完整发现成功后，新增和删除通过 `applyCustomApiGroupModelDiff` 在同一目录版本中提交；
鉴权、网络、解析或目录提交失败保留旧目录，不能先删除再新增。远端错误正文不得回传给 Renderer。

完整空列表同步为零模型，但保留独立 `CustomApiGroup` 的连接引用和 Key，后续仍可刷新、编辑或显式删除。
新增 ID 的关闭偏好先保存；目录提交后再清理已删除 ID 的偏好，清理失败返回
`model_picker_preference_recovery_pending` 并由启动 reconcile 收口，不把已提交的同步谎报为失败。

发现前记录用户目录版本，提交时在 Catalog 串行事务内校验。并发刷新或期间发生连接编辑、换 Key、删除，
过期提交返回 `configuration_changed` / HTTP 409，用户重读后重新操作；不自动重试可能改变含义的写入。
版本属于进程中的用户目录与凭据，Cloud/account 目录投影不会制造冲突。

刷新响应明确包含新增与已删除的本地模型 ID。Renderer 先接纳已提交的删除事实、清理用途绑定，再重读
Model Catalog 和 Model Picker；后续读取失败明确显示“已刷新，但列表同步失败”，不得继续选择已删除模型。

## 分组连接编辑

Model Catalog 在用户目录中独立保存 `CustomApiGroup` 的名称和 endpoint 引用。分组不是正式 Provider，
不依赖模型数量存在；Model Picker 从分组投影空列表，连接事实仍由 endpoint 拥有。
存量明确命名的 v4 配置在严格准入后迁移到 v5；正式 Provider 归属恢复完成后，初始化编排再根据真实
membership 规范化未命名的历史自定义模型。不能凭 URL 或 route 猜正式归属，也不在运行读取时双读旧合同。
`readCustomApiProviderName` 保持历史默认名称的唯一规则。

`updateProvider` 接收 `current_provider_name` 与整体替换的名称、格式、URL 和可选 Key。共享 strict schema 复用
注册时的 URL 规范化；改名到另一个已存在的分组名称会被拒绝，不做隐式合并。endpoint 选择规则固定为：

- 地址、格式均未变化，且分组只引用一个 endpoint：保留原 endpoint；提交 Key 时只有该 endpoint 由本分组独占、且其凭据未被其他 endpoint 引用时才在原
  credential boundary 内替换，否则为本分组新建 endpoint，避免影响共用同一 endpoint 的其他分组（包括空分组）；
- 地址或格式变化：总是新建 endpoint；未提交 Key 时仅当分组所有 endpoint 共享同一份可用凭据才沿用该凭据，否则
  返回 `credential_required`；
- 原凭据缺失或不可解密时，任何不提交 Key 的编辑都返回 `credential_required`。

模型 route 只替换连接事实（endpoint identity、base URL、auth 与 profile），模型 ID、容量、视觉声明以及
usage/continuation 保持原值；图片来源仍按新格式的 profile 重新投影。全部模型通过 Model Catalog
`rebindCustomApiGroup` 一次事务改绑，旧 endpoint 在没有模型或分组引用后与其独占凭据同事务清理；写盘失败时撤销本次凭据变更，
use case 只返回稳定错误码。编辑同样使用目录版本检查，避免覆盖交错提交的模型资料。

## 分组删除与提交边界

`DELETE /api/v1/custom-api-onboarding/providers` 只接收分组名称，由 Host 解析当前全部归属（排除正式 Provider），
通过带版本检查的 Catalog `removeCustomApiGroup` 一次删除分组与模型。最后一个模型或分组引用消失时，endpoint 和独占凭据按 Catalog 的统一生命周期清理。
偏好清理失败不谎报删除失败，响应返回 `model_picker_preference_recovery_pending`，启动 reconcile 收口。
Renderer 按响应中的真实已删除 ID 清理用途绑定；投影读取失败与删除失败分别显示。

## 职责与安全约束

- factory 只装配注册、刷新、编辑和删除编排；分组归属、连接决策、模型投影由 `functions/` 拥有。
- URL 准入允许内网 HTTP 和 HTTPS，但拒绝 userinfo、query、fragment，凭据只能走独立 Key 字段。
- 发现请求不跟随重定向，避免将认证头传到另一地址；15 秒超时覆盖 headers 和响应体读取。
- 列表结构错误不能被解释为“没有模型”；能力推断只在 Model Discovery 中执行并标注 confidence。
- 凭据持久化和目录文件仍是两个物理落点，异常时执行回滚，但不声称拥有跨文件的进程崩溃事务。
  自定义分组仍以名称表达，重命名冲突由用例拒绝；独立连接引用与模型在同一目录文件原子保存。


## 非对话能力模型

添加页按显式模型类型注册 embedding、rerank、document OCR 和 image generation。继续复用正式 Host
推理 adapters、Model Catalog endpoint/credential 事务、能力筛选和用途绑定；不引入新 Provider SDK、
Python 网关或知识库私有模型目录。模型名称不用于猜类型，非对话连接的协议不能在编辑时切成另一能力。

| 用户选择 | API 地址语义 | 鉴权与响应 |
| --- | --- | --- |
| OpenAI Embeddings | 基础地址，纯域名补 `/v1`，请求追加 `/embeddings` | 可选 Bearer；`data[].embedding` |
| Cohere Rerank | 基础地址，纯域名补 `/v2`，追加 `/rerank`；网关显式 `/v1` 原样保留 | Bearer；`results[].index/relevance_score` |
| OpenAI Images | 基础地址，纯域名补 `/v1`，追加 `/images/generations` | 可选 Bearer；要求 `b64_json`，目前每次一张 |
| Paddle Layout Parsing | 完整 endpoint，不追加路径 | `token`；layoutParsingResults 的 Markdown |
| Paddle OCR Jobs | 服务基础地址，追加 `/api/v2/ocr/jobs` | Bearer 上传，轮询 job，下载 JSONL 不透传 Key |

`POST /capabilities/models` 注册单个手填模型 ID；`POST /capabilities/test` 使用同一份严格命令进行一次
合成文本/图片/PDF调用，最长 120 秒，可取消，不保存目录、凭据或用途。图片测试也可能产生供应商费用，
UI 在按钮旁明确提示。取消会中止本地请求、轮询与后续调用，保留草稿；Paddle Jobs 已受理任务没有本轮接入的远端撤销端口，不能承诺停止供应商处理或费用。成功仅证明这次协议调用可解码，不代表模型质量、额度或配置已保存。
`PUT /capabilities/providers` 原子更新连接名称、地址和可选新 Key；改地址时按原 endpoint 规则重新绑定，
同一连接内各个模型本地 ID 保持不变。该类模型不使用 `/models` 发现；刷新被明确拒绝，手填列表不被清空。

名称/Key 变更不改变 embedding 向量空间；地址或上游模型 ID 变化由实际请求的 `spaceId` 识别，
详见 [Embedding 合同](../../../../domains/model-inference/README.md)。设置页通过窄 metadata port 列出
受影响知识库，提示使用“重建检索索引”并保留原文与关联，绝不以清空原文代替重建；插件不可用时明确未知影响。
模型目录与来源合同本身不拥有索引迁移，调用方必须持久化并传回 expectedSpaceId 才构成完整保护。

Paddle Layout Parsing 的部署模型由 endpoint 决定，其手填 ID 仅是本地身份标签，不向 payload 增加不存在的 `model` 参数。

本轮不接 Mistral `/ocr`、任意重排格式、URL-only 生图返回或新的本地网关进程。视觉对话仍使用既有
`image_vision` 用途，不冒充 PDF OCR。用户自建的 LiteLLM/兼容网关只在其实际协议符合上表时使用。

### 协议验收资料

协议 fixture 通过本机 TCP + 正式 adapters/已安装 SDK 验证请求路径、认证、payload、响应解码、鉴权/格式错误，
不是供应商真实连通或质量认证；fixture 只处理合成输入。官方合同来源：

- [OpenAI Embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create)
- [OpenAI Images](https://developers.openai.com/api/reference/resources/images)
- [Cohere Rerank](https://docs.cohere.com/reference/rerank)
- [OpenAI Chat Completions/SSE](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)：跨平台插件验收复用同一本机协议 fixture，场景自行提供合成正文；不模拟供应商模型质量。
- [PaddleOCR-VL 服务](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/PaddleOCR-VL.html)
- [Paddle OCR Jobs](https://ai.baidu.com/ai-doc/AISTUDIO/Mml7n69e7)
- [AI SDK OpenAI-compatible Provider](https://ai-sdk.dev/providers/openai-compatible-providers)

定向协议和重启持久化回归在相邻 `orchestration/customCapability*.integration.test.ts`；错误回显不包含原始
远端正文或 secret。Desktop 验收复用同一个本地 fixture，覆盖测试/保存分离、手填列表和用途配置。
