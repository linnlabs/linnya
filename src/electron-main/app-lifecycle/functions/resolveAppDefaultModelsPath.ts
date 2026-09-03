import fs from 'node:fs';
import path from 'node:path';

import {
  resolveExplicitDefaultModelsPath,
  sourceDefaultModelsPath,
} from '../../../domains/model-catalog';

export interface AppDefaultModelsPathResolution {
  readonly path: string;
  readonly source: 'explicit' | 'application_default' | 'source_development';
}

/**
 * App owner 在任何后端/worker 启动前选择一条真实存在的目录路径。后续进程只消费
 * MODEL_REGISTRY_DEFAULTS_PATH，不再各自搜索 cwd、asar 或历史源码目录。
 */
export function resolveAppDefaultModelsPath(input: {
  readonly configuredPath: string | undefined;
  readonly applicationPath: string;
  readonly developmentRoot: string;
  readonly isPackaged: boolean;
}): AppDefaultModelsPathResolution {
  const explicitPath = resolveExplicitDefaultModelsPath(input.configuredPath);
  if (explicitPath) {
    return Object.freeze({ path: explicitPath, source: 'explicit' });
  }

  if (input.isPackaged) {
    const packagedPath = path.join(
      input.applicationPath,
      'dist',
      'domains',
      'model-catalog',
      'default_models.json',
    );
    if (!fs.existsSync(packagedPath)) {
      throw new Error('发布包缺少 Model Catalog 默认目录资产');
    }
    return Object.freeze({ path: packagedPath, source: 'application_default' });
  }

  // 开发命令以仓库根作为 cwd，但 app.getAppPath() 指向 dist/main 入口目录。
  // 两种身份必须由 composition root 明确传入，不能让 resolver 搜索或猜测父目录。
  const developmentPath = sourceDefaultModelsPath(input.developmentRoot);
  if (fs.existsSync(developmentPath)) {
    return Object.freeze({ path: developmentPath, source: 'source_development' });
  }

  throw new Error('开发源码缺少 Model Catalog 默认目录资产');
}
