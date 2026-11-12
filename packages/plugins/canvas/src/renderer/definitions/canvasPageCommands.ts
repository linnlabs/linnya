import type { createCanvasSurface } from '../orchestration/createCanvasSurface';

type Surface = Awaited<ReturnType<typeof createCanvasSurface>>;
/** 菜单只获得已存在的表面动作，不获得kernel或存储写入口。 */
export interface CanvasPageCommandSurface
  extends Pick<
    Surface,
    | 'context'
    | 'createText'
    | 'fit'
    | 'edit'
    | 'remove'
    | 'select'
    | 'arrange'
    | 'locateEndpoint'
    | 'closeContext'
    | 'color'
  > {
  readonly actions: Pick<
    Surface['actions'],
    'duplicate' | 'lock' | 'layer' | 'align' | 'distribute'
  >;
  readonly clipboard: Pick<Surface['clipboard'], 'copy' | 'cut' | 'paste'>;
  readonly connections: Pick<
    Surface['connections'],
    'selected' | 'patch' | 'reverse' | 'beginLabel'
  >;
  readonly session: { readonly state: Pick<Surface['session']['state'], 'snapshot'> };
  readonly sections: Pick<Surface['sections'], 'group'>;
  readonly selection: { readonly ids: Pick<Surface['selection']['ids'], 'value'> };
}
