# Text Measurement Core

该 package 保存无 Electron、无 DOM、无文件系统依赖的确定性文本测量原语。平台
`src/features/text-measurement` 负责环境装配，可信 compute Worker 可直接打包本 package；
二者必须复用同一 heuristic 规则，禁止各业务复制字符宽度或换行算法。

这里允许：测量 DTO、单位换算、输入规范化、heuristic adapter 与同步 service。
浏览器 Pretext、系统字体发现、HarfBuzz 装配、Worker 生命周期和 Slides 业务规则都不属于本 package。
