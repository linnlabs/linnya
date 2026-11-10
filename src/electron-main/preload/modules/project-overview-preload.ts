import type { IpcRenderer } from 'electron';
import { PROJECT_OVERVIEW_CHANNEL, type ProjectOverviewRequest } from '@app/schemas';

export function buildProjectOverviewPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    /** 返回值未校验；Renderer 必须用 ProjectOverviewSchema 解析。 */
    readProjectOverview: (request: ProjectOverviewRequest): Promise<unknown> => (
      ipcRenderer.invoke(PROJECT_OVERVIEW_CHANNEL, request)
    ),
  };
}
