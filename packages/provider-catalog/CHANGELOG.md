# Changelog

## 0.1.0

- 建立私有 workspace package、公开目录出口、Host-only runtime binding 出口和独立构建边界。
- 迁入 Provider Catalog、runtime binding 与上游同步实现，增加双投影一致性和同步检查门禁。
- 用业务测试锁定同步 no-op 不写盘、非法上游输入在写盘前失败，以及新增/删除/容量/runtime binding 差异摘要。
- Electron Backend 构建链显式先构建本 package；打包 smoke 真实加载 ESM/CJS 制品并校验双投影 generation，避免源码 schema 与陈旧 `dist` 混用导致启动失败。
