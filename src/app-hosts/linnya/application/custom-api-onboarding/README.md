# Custom API Onboarding Use Case

本 use case 拥有“用户按 URL、API
Key、API 格式和模型资料注册自定义语言模型”的跨 domain 顺序。它不是 Provider
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

整批先提交偏好，再通过 `registerUserModels` 一次发布目录，避免偏好写入失败后出现默认开启的模型，
也不会因后续模型出错而只保存半批。目录保存失败时，新 ID 的孤儿偏好由启动 identity reconcile 清理，
不会进入模型列表。偏好与目录属于不同持久化 owner，这不是跨文件事务；顺序保证失败残留不可见且可清理。

## 已保存分组刷新

`POST /api/v1/custom-api-onboarding/providers/refresh` 只接收 `provider_name`。Host 根据分组的现存
模型和 endpoint 取得 API 格式、地址与凭据，通过同一 Model Discovery 能力重新查询；Renderer 不读取密钥，
也不能覆盖刷新目标地址。首次添加的 `/discover` 仍使用表单中单向提交的 Key，两者不能混用。

分组可能包含多个连接，必须在第一次网络等待前同步固定整组的地址、协议与明文凭据快照，
避免并发编辑后将新 Key 发往旧地址。逐连接使用各自凭据，并以 endpoint 身份与 typed route 的
`endpoint_model_id` 判断已有模型，不能使用正式 Provider 的 `provider_model_id` 或显示名。已有模型的
本地 ID、用户编辑和选择偏好保持不变；新模型复用发现它的准确 endpoint，默认关闭，等待用户显式启用。
重复刷新不重复注册；远端空列表不删除本地模型。所有连接发现成功后才开始注册，鉴权、网络或解析失败
保留旧目录。全部新增项共享一次目录事务；远端错误正文不得回传给 Renderer。

发现前记录用户目录版本，提交时在 Catalog 串行事务内校验。并发刷新或期间发生连接编辑、换 Key、删除，
过期提交返回 `configuration_changed` / HTTP 409，用户重读后重新操作；不自动重试可能改变含义的写入。
版本属于进程中的用户目录与凭据，Cloud/account 目录投影不会制造冲突。

刷新后的 Renderer 跨 feature 编排同时重读 Model Catalog 和 Model Picker，保证新增模型可立即查看详情。

## 分组连接编辑

模型管理把自定义模型按 `custom_provider_name` 投影为分组（未命名的历史模型归入默认分组），分组身份规则由
`readCustomApiProviderName` 唯一提供，Model Picker 投影与本流程共用。分组只是显示与编辑范围，不是 Provider
实体；正式 Provider（含 Ollama 本地）的模型即使同为用户目录条目，也按 Provider Configuration 归属排除在外。

`updateProvider` 接收 `current_provider_name` 与整体替换的名称、格式、URL 和可选 Key。共享 strict schema 复用
注册时的 URL 规范化；改名到另一个已存在的分组名称会被拒绝，不做隐式合并。endpoint 选择规则固定为：

- 地址、格式均未变化，且分组只引用一个 endpoint：保留原 endpoint；提交 Key 时只有该 endpoint 由本分组独占才在原
  credential boundary 内替换，否则为本分组新建 endpoint，避免影响共用同一 endpoint 的其他分组；
- 地址或格式变化：总是新建 endpoint；未提交 Key 时仅当分组所有 endpoint 共享同一份可用凭据才沿用该凭据，否则
  返回 `credential_required`；
- 原凭据缺失或不可解密时，任何不提交 Key 的编辑都返回 `credential_required`。

模型 route 只替换连接事实（endpoint identity、base URL、auth 与 profile），模型 ID、容量、视觉声明以及
usage/continuation 保持原值；图片来源仍按新格式的 profile 重新投影。全部模型通过 Model Catalog
`rebindUserModels` 一次事务改绑，旧 endpoint 在没有引用后与其独占密文同事务清理；写盘失败时撤销本次凭据变更，
use case 只返回稳定错误码。编辑同样使用目录版本检查，避免覆盖交错提交的模型资料。

## 分组删除与提交边界

`DELETE /api/v1/custom-api-onboarding/providers` 只接收分组名称，由 Host 解析当前全部归属（排除正式 Provider），
通过带版本检查的 Catalog `applyDiff` 一次删除。最后一个引用消失时，endpoint 和独占凭据按 Catalog 的统一生命周期清理。
偏好清理失败不谎报删除失败，响应返回 `model_picker_preference_recovery_pending`，启动 reconcile 收口。
Renderer 按响应中的真实已删除 ID 清理用途绑定；投影读取失败与删除失败分别显示。

## 职责与安全约束

- factory 只装配注册、刷新、编辑和删除编排；分组归属、连接决策、模型投影由 `functions/` 拥有。
- URL 准入允许内网 HTTP 和 HTTPS，但拒绝 userinfo、query、fragment，凭据只能走独立 Key 字段。
- 发现请求不跟随重定向，避免将认证头传到另一地址；15 秒超时覆盖 headers 和响应体读取。
- 列表结构错误不能被解释为“没有模型”；能力推断只在 Model Discovery 中执行并标注 confidence。
- 凭据持久化和目录文件仍是两个物理落点，异常时执行回滚，但不声称拥有跨文件的进程崩溃事务。
  本次不新增 Provider 实体或存储迁移；分组仍以名称表达，重命名冲突由用例拒绝。
