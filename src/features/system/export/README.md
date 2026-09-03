# System Export

本 feature 统一管理桌面端“把派生文件交付给用户”的 Host 能力，不拥有 Markdown、Slides 或其它业务格式的生成规则。

## 保存目标

Renderer 先请求系统保存框。Host 只返回一次性 token 和展示文件名，不向插件暴露本机路径。Backend 提交 artifact 时必须携带同一个插件身份、扩展名和 MIME；Host 复核后在目标目录写入 staging 文件，再原子发布。token 有效期十五分钟且只能成功发起一次提交。

保存目标 registry 只属于 Electron Main。App Server 中的插件通过严格 `ExportArtifactCommitPort` 提交，二进制先写入 AppData 私有 mailbox，反向 RPC 只传 operation id、随机 token 和校验事实；Desktop 取回 bytes 后才消费一次性保存 token。不能把 registry 复制到 App Server，也不能把真实路径或大文件改成 RPC 内联 base64。

因此，插件只负责生成完整 bytes，保存目录、覆盖确认、路径保密和最终发布规则只有一个 owner。当前接口接收完整 `Uint8Array`。Slides 的真实 30 页 4K 图片导出已完成验收：全进程 working set 峰值相对基线增加约 529 MB，当前无需扩展为分块 writer。只有新的真实数据证明该基线不可接受时才重新评估接口，不能因理论担忧提前扩大 Host 合同。

## PDF runtime

PDF 业务 facade 与 Chromium Desktop adapter 分开：Backend 先校验有序 PNG 页面与物理尺寸，
再调用 `DesktopRasterPdfDocumentPort`；Electron adapter 只拥有隐藏窗口安全配置、临时页面、加载超时、
打印和 `finally` 销毁窗口。App Server cutover 后该 port 由有界 reverse capability 实现，插件 SDK 不加载 Electron。

边界规则如下：

- Editor adapter 继续拥有 Tiptap HTML、CSS、纸张和边距规则；
- 插件 facade 只接受有序 PNG 页面和物理页尺寸，不能提交任意 HTML 或 BrowserWindow 参数；
- Slides 的页面视觉事实仍由 Slides renderer 生成，Host 不解释 Slides DSL、RenderModel 或节点。

Backend facade 与 Desktop adapter 都执行同一份 raster 入站校验。前者阻断错误业务请求，后者在未来跨进程
reverse capability 入站时不盲目信任对端；两处复用同一个纯函数，不维护两套规则。

隐藏窗口固定关闭 JavaScript、Node integration 和新窗口，并启用 sandbox、context isolation 与 web security。栅格 PDF 的临时页面目录无论成功失败都会清理。

## 维护规则

- 新格式不应在 IPC handler 中复制保存框、路径和写文件流程，应消费 export artifact facade。
- 新业务不得把本机路径塞入 token DTO、插件 IPC、日志或错误正文。
- 只有 HTML 文档 owner 可以使用内部 HTML adapter；插件公开面始终保持 raster-pages 合同。
- 修改 Host facade 时同步 `plugin-host-contract`、`plugin-sdk`、磁盘插件 resolver、renderer host shim 和 preload 类型。

开发态内存诊断报告复用 Host 的 UTF-8 文本导出入口，并使用 `json` 文件类型。该入口只负责保存已经生成的报告文本；采样、会话与报告结构仍归 `system/process-memory`，不能把诊断业务塞入导出 handler。
