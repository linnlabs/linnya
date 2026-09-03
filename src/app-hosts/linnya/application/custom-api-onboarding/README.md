# Custom API Onboarding Use Case

本 use case 拥有“用户按 URL、API
Key、API 格式和模型资料注册自定义语言模型”的跨 domain 顺序。它不是 Provider
onboarding，不创建 `ProviderDefinition`、`ProviderAccount` 或模型 `provider`
字段。

## 公开用例

`registerModel` 只接收用户能理解的三种格式之一、HTTP/HTTPS
URL、可选 Key、endpoint model id、展示名、容量和图片输入开关。HTTP
adapter 用共享 strict schema 先完成字段准入与 URL 规范化。

内部 route profile、auth profile、endpoint identity 和 capability
id 只由本 use case 的 `customApiRuntimeBindingRegistry` 决定，不进入 Renderer
command。

## 固定流程

```text
解析 CustomApiModelRegistrationCommand
  -> 读取该 API 格式的 Host runtime binding
  -> 创建或复用内部 InferenceEndpoint
  -> 投影 User ModelConfig 与 typed route
  -> Model Catalog 原子保存 endpoint、credential 与 model
```

显式提交新 Key 表示创建新的 credential
boundary；未提交 Key 时只复用格式、URL、认证完全一致且凭据可用的自定义 endpoint。正式 Provider
endpoint 即使 URL 相同也不会被本流程复用。
