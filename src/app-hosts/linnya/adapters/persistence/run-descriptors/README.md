# RunDescriptor SQLite adapter

`agent_run_descriptors` 与 runs、events、engine_checkpoints 同在 Workspace SQLite。它实现
[运行恢复](../../../application/run-resumption/README.md) 的输入保存端口，不是审计表。

每个 run 只插入一份原输入；不提供 UPSERT 或以最新配置覆盖的 API。读取通过版本化 schema
校验，并核对行身份。描述只有在 admission 完整提交且所引用事实存在时才可用于恢复。
外键随 run 删除级联清理；终态释放由应用用例显式调用，不能使用 Audit / Telemetry TTL。

该表使用 create-only schema provider，不修改原表，不提高 Host schema 版本。
