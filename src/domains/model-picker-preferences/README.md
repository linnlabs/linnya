# Model Picker Preferences

本 domain 只拥有模型选择投影的用户可见性偏好，不拥有 Provider 授权、模型运行开关、模型用途绑定或当前主模型。对话和图片生成共用来源分组，但按各自 capability 过滤候选。

## 稳定合同

- `provider_preferences` 按 `configured_provider_id` 索引；
- `model_preferences` 按本地 `model_config_id` 索引；
- 文件是稀疏快照，只记录用户明确修改过的开关；
- 关闭 Provider 不改写子模型偏好，重新打开时自然恢复；
- 启动时按 ConfiguredProvider 和 Model Catalog 的稳定 ID 清理已经失效的记录；
- 偏好文件与 Workspace 模型目录同作用域，secret 仍只属于 endpoint credential
  store。

默认可见性和“当前模型例外”不属于本 domain。它们由 Linnya app-level
`model-picker` workflow 结合 Provider Catalog、ConfiguredProvider、Model
Catalog 和运行可用性统一投影，避免任一 catalog 反向依赖本 domain。

## 并发与批量写入

Registry 按实例串行执行“读取当前快照 → 变换 → 保存 → 提交内存”，不能在等待前基于旧快照计算结果。
批量接入通过 `setModelVisibilities` 一次保存，分组删除通过 `removeModelPreferences` 一次清理；单模型 API 复用同一路径。
一次保存失败不改变当前快照，也不阻断后续任务。文件 repository 的临时文件不会被同一 Registry 的并发写入争用。
