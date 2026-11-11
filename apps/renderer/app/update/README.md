# Renderer 应用更新

Main 持有更新状态与下载/安装流程，合同见 `src/shared/update/definitions/updateMessage.ts`。`runtime.ts` 按 Pinia 实例连接 Main、订阅完整快照和转发命令；`store/updateStore.ts` 仅镜像状态、保存重启确认列表并暴露同步 action。

确认重启时传回上次展示的 activity key；若期间出现新任务，Main 再次要求确认，Renderer 保持既有确认交互。下载、退出和安装都由 Main 决定，Renderer 不复制规则。
