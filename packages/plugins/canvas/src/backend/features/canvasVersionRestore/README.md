# Canvas 完整版本恢复

公开 `planCanvasVersionRestoration({ state, targetSnapshot, actor, claims, origin, now })` 返回同一正式提交合同的 `CanvasCommitPlan`。仅用户恢复入口消费；目标来自已验证版本预览，计划再次接纳完整图及实体唯一身份。提交仍经共同正文、资产和引用参与者验证，恢复不是 SQL 覆盖。

只比较真实内容字段；历史 revision/updatedAt/updatedBy 不引发无效写入。目标中的稳定 ID、createdBy、坐标与图关系精确恢复，当前分配计数不回退。当前仍存在的元素按自身 revision+1；缺失元素按文档 `maximumRevision` 与目标修订的较大值+1。所有实际恢复字段获得本次用户写入来源与新字段版本，旧 Agent 写入不能因历史复活重新获准。

有其他视图编辑声明命中实际差异时整批 `version_conflict`；无关字段声明不阻断。计划保留目标全部元素作为可信历史引用凭据。用户 transition 将整批计入发起视图的撤销栈，Agent 组不清空。完整恢复直接构造最终目标集合，不用选择性撤回的空位避让。

文档标量由同一内容事务只增维护，不保留永久实体墓碑；活动撤销/组退出后删除 guard 仍照常清理。迁移只从开发期仍可读取的当前、guard 与版本 BLOB 提取已知修订事实，未知格式和损坏原始数据保留，由正式只读/版本准入处理，不臆造旧格式转换。
