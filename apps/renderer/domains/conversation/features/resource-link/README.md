# Conversation Resource Link

本 feature 只负责 Conversation 回答中标准 Markdown 文件链接的识别、展示状态和窄 port。它接纳
`workspace:`、`conversation:`、`file:` 三类 canonical locator，不解析裸路径，也不承担 Web 外链、Citation、
`#ref` 或插件内部元素引用。

`functions/` 负责把统一 Markdown parser 给出的 href 规范化一次，并投影物理文件标题与后缀；`ui/` 只消费
消息所属的不可变 conversation scope 和公开 port。Workspace、文件系统、Electron IPC 与插件 registry 的
跨域编排位于 `apps/renderer/app/workflows/conversation-resource-link/`，不得反向塞进 Conversation domain。

Workspace 的 authored label 只在解析中使用，ready 后展示 owner 真实标题和 registry 图标。Conversation 与
Host 没有业务标题，展示 authored title 和 locator 后缀。组件不永久缓存 missing；目标移动、改名或删除后，
重新挂载会按旧 path 得到明确失效状态。

业务测试覆盖 href 编码边界、标题投影、Workspace 显式导航身份和物理文件 reveal DTO。真实 preload、IPC、
Electron shell 与 Workspace 打开链由 `pnpm run test:conversation-resource-link:electron` 验证。
