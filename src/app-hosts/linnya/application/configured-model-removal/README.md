# Configured Model Removal Use Case

这是删除用户模型的 application use case。所有用户模型都要同步删除 Model Picker 的稀疏偏好；正式
Provider 模型还要删除 Provider Configuration 中的稳定归属。

跨文件顺序固定为 `persist removal intent -> remove Model Catalog -> remove picker preference -> commit
association removal`。若模型目录写入失败，撤销 intent；若模型已经删除但偏好或最后一次归属提交失败，
接口仍报告删除成功，并用独立 recovery 标志记录启动清理。偏好由 Model Picker 启动身份 reconcile 清理，
正式 Provider 归属由 durable intent 收口。这样不会出现 UI 说删除失败、用户重试后实际模型早已不存在的假象。
