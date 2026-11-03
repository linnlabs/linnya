import { rm } from 'node:fs/promises';
// 一个clean阶段在并行entry之前；每个tsup配置自行clean会删除其他entry刚产出的worker。
await Promise.all(['dist/backend', 'dist/cli', 'dist/.metadata'].map(directory => rm(directory, { recursive: true, force: true })));
