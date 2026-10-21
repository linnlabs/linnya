# Web 原文件取得

这项能力只取得原件、登记来源并把原始字节物化到当前 Conversation 的物理工作目录。
它不提取 PDF 页面、不解释表格，不调用知识库 ingestion/OCR，不安装解析库。

## 边界与调用链

`localHttpFetch` 保留安全 GET 的原始字节 → `LocalHttpProvider` 检查文件类型 →
`readWebPage` 调用 `WebFileStore` → Host adapter 在既有 conversation lifecycle admission 内
调用物理存储 adapter → Web 写正式 Citation/Evidence 回执。

- `definitions/webFileAcquisition.ts`：Web 拥有的窄物化 port 与调用期字节合同。
- `functions/validateWebFile.ts`：文件白名单和有界容器检查。
- `functions/describeWebFile.ts`：可随 Citation 持久化的文件身份说明，不是原文摘录。
- Host：`src/app-hosts/linnya/adapters/tools/createWebFileStore.ts`，绑定当前会话，子任务继承。
- 文件 IO：`src/infra/adapters/web-files/conversationWebFileStore.ts`。Web 不计算会话根目录。

## 取得合同

PDF、`text/csv` / `application/csv`、XLSX 使用独立的 30 MiB 单文件响应预算；网页和错误页仍为 5 MiB。
在原 GET 收到成功响应头时按 MIME 选择预算，不增加 HEAD 或第二次下载；每跳重定向仍重新检查。
响应头只决定接收预算，不证明类型可信；类型校验通过后才保存。上限按实际解压后字节执行，
不信任 Content-Length，压缩响应和无长度的流同样受限。原有总超时及取消规则不变。
PDF 检查版本签名；XLSX 检查 ZIP 目录、workbook 和内容类型声明，拒绝宏、加密容器、
重复项和超预算容器（4096 项、声明展开总量 50 MiB、内容类型声明 64 KiB）。
CSV 没有魔数：按响应编码检查文本，拒绝二进制和 HTML 伪装，不执行公式。
声明未知 MIME 的文件不按扩展名猜测类型。类型检查不是完整文件有效性或无恶意内容认证。

CSV 同时返回既有文本视图；`max_chars` 只裁剪文本，不裁剪保存的字节。
PDF/XLSX 的 `charCount=0`、`extractor=file_download`，模型通过 Shell 解析。
超限、403、验证码和不支持的类型保持显式失败，不额外下载、不绕过访问限制。

原件保存为 `web-downloads/<sha256>.<format>`（相对于当前会话 Shell cwd），模式 0600。
不采用远程文件名，不自动预览/打开。下载区总量 50 MiB，Host 同目录写入串行计量；
写完整后才发布 hash 路径。同 hash 复用前校验实际字节；原件被改动则明确拒绝，
不把旧 hash 套到新内容上。回执明确要求解析文本、表格和脚本放在 `web-downloads/` 之外；Shell 的明确写权限不在此变更。
配额只计量存储层受管命名候选 `<64位小写sha256>.pdf|csv|xlsx` 的普通文件；解析产物、
无关名称、目录和 symlink 不算受管原件，也不会仅因它们存在而阻断取得。受管候选若变成目录或
symlink 则明确拒绝，不沿链接统计；同 hash 目标复用仍执行实际类型、字节长度和 hash 校验，
文件名本身不证明来源身份。配额拒绝报告 `used/incoming/max` 字节数。当前 50 MiB 是受管
Web 原件配额，不是整个会话目录的总磁盘配额；Shell 产物由 Commands 原有权限/生命周期管理。
`web-downloads/` 根目录仍须是当前会话内真实目录；此目录不是针对恶意同权限进程的 OS 沙箱。

文件不进入公共页面文本缓存，返回 `cacheStatus=bypass`（并发 GET 合并仍可为 `coalesced`）。
重复读取可以重新请求 URL，但同内容不重复保存；不增加第一次读取的网络请求。
会话清理会移除原文件；Citation 的来源身份快照与取得轨迹保持各自原有生命周期。

## 引用与信任

回执记录请求/最终 URL、取得时间、MIME、大小、SHA-256 和相对路径。
仍使用 Web canonical URL 分配 `[@ref]`，不引入第二套引用语法。
Citation snippet 明确为文件身份说明；Evidence `web_file` 保存该说明与实际取得 URL，
CSV 可另附捕获文本。相同 ref 的不同版本由每次回执与精确 bundle 保留，不能把 ref
误当文件版本号。Markdown 保存当次选定的来源快照，跨会话仍能重读身份说明。
作者可在正文注明“第 N 页/表 X”，系统不据此生成已验证页级原文。

文件回执和工具说明标明不可信外部文件。Commands 自己在 Shell/process 模型输出层
统一包裹不可信数据边界，控制首行保留在外；它不识别 curl、不依赖 Web 目录。
这些边界帮助模型区分数据和指令，不是提示注入免疫保证，也不是解析器资源隔离。

## 验证

`src/tools/web/__tests__/webFileAcquisition.integration.test.ts` 使用 localhost 合成文件，覆盖
真实 GET、重定向、字节 hash、CSV 预览、类型拒绝、大小限制、会话隔离、复用/篡改、
配额/取消、Evidence 回放与 Markdown 来源持久化。无私有报告和外部站点依赖。
完整/紧凑卡片和深搜组装各自复用 strict schema，文件不能升级成正文取得。
