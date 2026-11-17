import { rm } from 'node:fs/promises';

// 一个清理阶段先于所有 entry；各并行构建不能删除其他 Worker 刚生成的文件。
await Promise.all(['dist/backend', 'dist/.metadata'].map(directory => rm(directory, { recursive: true, force: true })));
