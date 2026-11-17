# Host 固定模块解析

`functions/createScopedHostModuleResolution.ts` 是 CLI 与受管 Worker 共用的技术边界：Host 冻结模块锚点、artifact 目录与精确 specifier 集合，只有真实调用文件属于该目录才从 Host 安装树解析。传递依赖仍归原模块目录；不是插件权限注册表，也不是 Node 沙箱。不存在的 parent 保持 Node createRequire 的标准绝对文件锚点语义。

Commands 保留原 CJS `_load` / `_resolveFilename` 接线和原名单。Worker 随 Host 发布的启动器先安装 Node 同线程 `registerHooks({resolve})`，再求值已准入 artifact；CJS、createRequire 与动态 ESM 走同一解析规则。命中返回正式 file URL，不设置 format/load、不自行加载 native 字节，未命中交还 Node。

本产品运行时要求 Node >=24.18 <25；同步 hooks 在该版本已可用（见 [Node 官方文档](https://nodejs.org/docs/latest-v24.x/api/module.html#moduleregisterhooksoptions)）。这里不为较旧 Node 增设第二套加载分支。
