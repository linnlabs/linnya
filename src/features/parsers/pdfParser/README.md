# PDF解析器模块

## 📁 目录结构

这个模块采用分层架构，将原本900+行的单一文件拆分为多个专门的模块：

```
src/features/parsers/pdfParser/
├── 📄 PdfParser.ts          # 主解析器类，协调三层策略
├── 📄 types.ts              # 核心类型定义
├── 📄 factory.ts            # 工厂函数，创建不同配置的解析器
├── 📄 index.ts              # 模块导出文件
├── 📁 strategies/           # 三层处理策略
│   ├── TextExtractionStrategy.ts      # Layer 1: 快速文本提取
│   ├── GeometricAnalysisStrategy.ts   # Layer 2: 几何分栏算法
│   ├── VisionRecognitionStrategy.ts   # Layer 3: AI视觉识别
│   └── index.ts
├── 📁 layout/               # 布局分析算法
│   ├── LayoutAnalyzer.ts              # 页面布局分析器
│   ├── PeakDetector.ts                # x坐标峰值检测
│   ├── XYCutAlgorithm.ts              # XY-Cut分栏算法
│   └── index.ts
├── 📁 adapters/             # 跨平台库适配器
│   ├── PdfParseAdapter.ts             # pdf-parse库适配器
│   ├── PdfjsAdapter.ts                # pdfjs-dist库适配器
│   ├── PdfToImgAdapter.ts             # pdf-to-img + sharp适配器
│   └── index.ts
└── 📁 utils/                # 工具函数
    ├── textProcessing.ts              # 文本处理工具
    ├── imageProcessing.ts             # 图像处理工具
    ├── dataConverters.ts             # 数据转换工具
    ├── mathUtils.ts                   # 数学计算工具
    └── index.ts
```

## 🎯 核心特性

### 三层智能处理策略

1. **Layer 1: 快速文本提取** (70%文档，极低成本)
   - 使用 `pdf-parse-debugging-disabled` 库直接提取文本
   - 适用于简单的纯文本PDF
   - 性能最优，几乎无额外成本

2. **Layer 2: 几何分栏算法** (20%文档，中等成本)
   - 使用 `pdfjs-dist` 获取详细坐标信息
   - 实现 XY-Cut 算法处理多栏布局
   - 支持复杂的学术论文格式

3. **Layer 3: AI视觉识别** (10%文档，高成本但高准确率)
   - 支持两种方案（按模型配置自动选择）：
     - **方案 A：专用 OCR（原始文档直传）**（对 PDF 效果最好，通常也更快）
       - 通过显式注入的 `DocumentOcrPort` 把原始 PDF（或图片）上传给 OCR/Doc
         Parser 服务端点做文档级版面解析
       - 不需要 `pdftocairo`，跳过 “PDF→图片” 的本地渲染成本
       - 输出通常更稳定（表格/公式/阅读顺序）
       - 对 PDF 文件效果最好，对图片文件效果一般
     - **方案 B：通用视觉 VL（逐页转图）**（兼容性最好，但最慢）
       - 使用 `pdftocairo` 将 PDF 逐页转换为高质量 JPEG 图像
       - 使用 `sharp` 进行图像后处理和压缩优化
       - 使用通用视觉模型（GPT-4o/Qwen2.5-VL 等）逐页 OCR
       - 适用于需要兼容“任意图片输入/任意 OpenAI-compat 视觉模型”的场景
       - 对图片文件效果很好

> ✅ 选择建议：
>
> - **优先选方案 A**：你有“专用 OCR/Doc
>   Parser 服务”且目标是 PDF 解析质量（尤其表格/公式/版面）
> - **兜底用方案 B**：你只有通用 VL 模型，或需要处理各种图片输入/上游端点不支持直传文档

### 页级诊断与续跑契约

- PDF parser 需要输出页级诊断，用于知识库侧持久化到
  `Document.parseDiagnostics`。
- 通用视觉逐页路径支持
  `processPdfPagesWithVisionDiagnostics(...)`，供知识库 partial 文档只重跑失败页。
- parser 侧可以使用 `source_info.page_number`
  表示原始页码；进入知识库后处理后必须统一归一化为 `source_info.page_num`。
- Qdrant payload 对外检索字段仍使用 `page_number`，来源必须是归一化后的
  `source_info.page_num`。
- 页码字段是 load-bearing 数据：分片偏移、失败页定位、续跑、搜索引用都会依赖它，新增策略时必须补页码归一化测试。

失败处理约束：

- 页级失败应返回明确
  `errorKind`、`retryable`、`shouldReduceConcurrency`、`shouldSplitSmaller`，不要只返回一段不可分类的字符串。
- partial 成功必须保留已成功页的 blocks；全部页失败才作为整体失败处理。
- 继续解析失败页不应走全量摄入清理逻辑，增量提交/回滚由知识库 orchestration 负责。

### 精细化进度更新机制 🆕

```javascript
// 🎯 用户友好的进度体验设计
Layer 1 快速提取: 0% → 成功立即100%      (快速成功路径)
Layer 2 几何分析: 2% → 5%               (快速尝试)
Layer 3 AI识别:   5% → 90%              (主要耗时，逐页细化)
    ├─ 准备阶段: 5%
    ├─ 逐页处理: 5% + (页码/总页数) * 85%
    └─ 结果整理: 90% → 100%

// 🔄 用户看到的完整流程
前端进度: 12% → 15% → 25% → 45% → 65% → 75% → 85%
显示消息: 始终显示"解析中"，进度数值体现细节
```

## 使用方法与依赖边界

基础文本和几何解析通过 `createPdfParser()`、`createSimplePdfParser()` 或
`createAcademicPdfParser()`
创建，不需要推理能力。它们在文档必须进入视觉层而调用方没有注入能力时明确失败，不再从
`ServiceRegistry` 按字符串查找全局 AI 引擎。

扫描件和视觉优先解析由调用方显式注入 `TextGenerationPort`、`DocumentOcrPort`
与视觉模型 ID，入口见 [factory.ts](./factory.ts)。知识库摄入的正式 composition
root 在 `ParsingHandler`：通用逐页视觉只使用 Text
Generation，专用文档直传/单页续跑只使用 Document OCR。

`TextGenerationPort` 的合同 owner 位于
`domains/model-inference/features/text-generation`。PDF
parser 只拥有 PDF 转图、页级并发、重试、超时、partial diagnostics 和 Markdown
block 投影，不得依赖 Provider SDK、旧
`AIEngine.chatCompletion`、OpenAI 响应形状或 Host route 实现。

Worker 与主进程都必须在 composition root 构造 Host text-generation/document-ocr
adapter 后注入；parser 内部禁止读取全局注册表、创建 Provider
capability、按 URL 猜 OCR 模式或在超时后隐式切模。失败页续跑分别接收 Text
Generation、Document OCR 和 Embedding 能力，避免一个大接口同时代表无关职责。

文档复杂度分析入口仍为
`PdfParser.analyzeDocument()`；它只分析 PDF 结构，不触发视觉 Provider 调用。

### 故障排除检查清单

- [ ] **锁定 runtime 已准备**：`pnpm run prepare:poppler-runtime`
      通过完整性与版本校验
- [ ] **Node.js 依赖齐全**：`pnpm list pdf-parse-debugging-disabled pdfjs-dist sharp`
- [ ] **权限正确**：临时目录有读写权限
- [ ] **磁盘空间充足**：转换大文件时需要临时存储空间

## 🔧 Poppler runtime 边界

PDF 转图只依赖 `pdftocairo`。开发态与生产态统一使用
`config/poppler-runtime.json` 锁定的 runtime，不从
`node_modules`、Homebrew 或系统 `PATH`
猜测另一份实现。开发启动和 Desktop 构建会先运行
`pnpm run prepare:poppler-runtime`，按目标平台校验已有 runtime，缺失时才从固定 Linnya
release 下载，并同时验证 archive、完整文件树和主程序 hash。

当前生产目标只有：

- Windows x64：`extraResources/bin/poppler/win-x64/pdftocairo.exe`
- macOS arm64：`extraResources/bin/poppler/mac-arm64/pdftocairo`

Linux、macOS x64 和 Windows arm64 尚不是 Linnya
Desktop 的生产目标，因此不会隐式使用开发者机器上的系统 Poppler。

## 🚨 已知问题与解决方案

### pdf-parse 调试模式 Bug (已修复)

**问题描述：** 在使用原始的 `pdf-parse@1.1.1` 库时，PDF解析过程会出现以下错误：

```
ENOENT: no such file or directory, open 'D:\Aitiptap\mytiptap\test\data\05-versions-space.pdf'
```

**症状表现：**

- PDF文件上传和处理开始正常
- 快速文本提取阶段失败
- 错误日志显示尝试打开硬编码的测试文件路径
- 导致整个解析流程无法完成

**根本原因：** 这是 `pdf-parse@1.1.1`
库的一个已知bug，当库在某些条件下进入调试模式时，会尝试打开硬编码的测试文件路径
`test/data/05-versions-space.pdf`，而这个路径在生产环境中不存在。

**解决方案：** 我们使用了社区修复版本
`pdf-parse-debugging-disabled@1.1.1`，这个包与原始包完全兼容，只是禁用了有问题的调试模式。

**修复步骤：**

1. **更新依赖：**

   ```bash
   npm uninstall pdf-parse
   npm install pdf-parse-debugging-disabled
   ```

2. **更新代码：**

   ```typescript
   // 在 PdfParseAdapter.ts 中
   const pdfParse = await import('pdf-parse-debugging-disabled');
   ```

3. **添加类型声明：**
   ```typescript
   // 创建 src/types/pdf-parse-debugging-disabled.d.ts
   declare module 'pdf-parse-debugging-disabled' {
     interface ParsedPdf {
       text: string;
       numpages: number;
       info: any;
       metadata: any;
     }
     function pdfParse(data: Buffer | Uint8Array): Promise<ParsedPdf>;
     export = pdfParse;
   }
   ```

**验证修复：** 修复后，PDF解析器能够正常完成三层处理策略：

- ✅ Layer 1: 快速文本提取正常工作
- ✅ Layer 2: 几何分栏算法作为降级选项
- ✅ Layer 3: AI视觉识别作为最后选项

**参考资源：**

- [pdf-parse-debugging-disabled 包](https://www.npmjs.com/package/pdf-parse-debugging-disabled)
- [原始 pdf-parse bug 报告](https://gitlab.com/autokent/pdf-parse/-/issues/15)

**注意事项：**

- `pdf-parse-debugging-disabled` 与原始 `pdf-parse` 完全兼容
- 不需要修改任何业务逻辑代码
- 只是禁用了有问题的调试功能
- 性能和功能完全一致

### 进度跳跃问题 (v1.4.0已修复)

**问题描述：**
在v1.3.0及之前版本，用户反馈PDF解析进度会突然从15%跳跃到45%，体验不佳。

**根本原因：**

```javascript
// 旧版本的粗糙进度设置
updater(60, '尝试AI视觉识别...'); // 直接跳到60%！

// 计算链路导致跳跃：
// PDF解析器60% → ParsingHandler 58% → 前端显示48%
```

**解决方案：**

```javascript
// v1.4.0的精细化进度设计
updater(5, '开始AI视觉识别...'); // 从5%开始

// AI识别逐页精细报告
for (let page = 1; page <= totalPages; page++) {
  const progress = 5 + ((page - 1) / totalPages) * 85;
  updater(progress, `AI识别第 ${page}/${totalPages} 页...`);
}
```

### 其他常见问题

**问题：PDF解析失败，显示"无法加载pdfjs-dist"** **解决：**
检查Node.js版本兼容性，确保使用推荐的Node.js LTS版本

**问题：AI/OCR 识别超时** **解决：**

- 若使用通用视觉模型（逐页转图方案 B）：建议优先换更快的模型，或降低
  `targetPixels` 以减少每页图像复杂度。
- 若使用专用 OCR（原始文档直传方案 A）：单次 attempt 超时由
  `ModelConfig.document_ocr_route.attempt_timeout_ms`
  声明，不再在代码里按厂商名硬编码。
- 若仍频繁超时：建议检查上游 OCR 服务端点的负载、网络稳定性，并观察日志里的“第 N 次尝试失败”与耗时，判断是排队慢还是处理慢。

**问题：内存使用过高** **解决：** 调整批处理大小，避免同时处理过多大文件

**问题：Worker线程中无法找到文件** **解决：**
确保使用绝对路径，或正确设置Worker环境变量

---

## 🧩 安装与构建一览（关键命令）

- **开发启动（前后端联调）**：`npm run dev:electron`
- **仅构建 worker**：`npm run build:worker`
- **仅构建后端（主进程/服务）**：`npm run build:backend`
- **准备并校验 Poppler runtime**：`pnpm run prepare:poppler-runtime`

## 📦 打包与分发（macOS 重点）

Poppler
runtime 是与 Qdrant 相同的外部运行时资产：公共源码只保存锁定 catalog 和准备脚本，不提交生成目录。Linnya
release 保存两个固定压缩包；构建只接受 catalog 中声明的版本和 hash。macOS 包包含主程序、其闭包内动态库和固定 fontconfig；Windows 包只包含
`pdftocairo.exe` 及实际依赖 DLL，不再携带其他未使用的 Poppler CLI。

## 🛠️ 故障排除（Troubleshooting）

- **现象：退出码为 null，stderr 为空**
  - 通常是 runtime 文件树损坏、macOS 动态库路径或签名异常
  - 先运行
    `pnpm run prepare:poppler-runtime`；若 hash 已通过，再检查签名/公证产物

- **dyld 报错：Library not loaded: @rpath/libpoppler.149.dylib**
  - 说明运行时不完整；锁定的 tree hash 应在 Desktop 构建前直接拦截

- **开发态能用，打包后目标机器崩溃**
  - 开发态和生产态已经使用同一 runtime；检查安装包 BOM、签名和公证，不安装 Homebrew 兜底

- **临时文件清理 ENOENT**
  - 清理阶段未找到期望的中间文件，属于非致命问题
  - 可忽略；转换结果已成功返回

- **验证检查**
  - `otool -L dist/.../pdftocairo` 应显示依赖为 `@rpath/*.dylib`
  - `pdftocairo -v` 的版本应与 `config/poppler-runtime.json` 一致
  - macOS 上 `FONTCONFIG_PATH` 指向 runtime 内的 `etc`

## 🧪 最佳实践

- 学术论文或扫描件建议启用视觉优先模式（或自动策略会在前两层失败后进入视觉层）
- 大图像目标像素（`targetPixels`）可按需求在 1536~2048 之间调整以平衡质量/性能
- 升级 Poppler 时必须生成新 release 资产并更新版本、archive/tree/executable
  hash，不直接复制本机文件覆盖
