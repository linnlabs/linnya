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
boundary；未提交 Key 时只复用格式、URL、认证完全一致且凭据可用的自定义 endpoint。正式 Provider
endpoint 即使 URL 相同也不会被本流程复用。

发现列表中的开关表示快捷选择器可见性，关闭的模型仍会注册到目录。显式提交的
`picker_enabled` 由本 use case 通过窄 port 写入 Model Picker Preferences，不写进
ModelConfig；未提交时保留 picker 的默认规则，不生成偏好记录。

每个模型先提交偏好，再保存目录，避免偏好写入失败后出现默认开启的模型。目录保存失败时，
该新 ID 的孤儿偏好由现有启动 identity reconcile 清理，不会进入模型列表。批量注册仍逐模型
提交，并非整个批次的原子事务；中途失败时，之前成功的模型及其偏好保留。

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
use case 只返回稳定错误码。删除分组不经过本用例：Renderer 逐个复用正式模型删除流程，最后一个引用模型删除时
endpoint 与密文由 Model Catalog 自动收口。
