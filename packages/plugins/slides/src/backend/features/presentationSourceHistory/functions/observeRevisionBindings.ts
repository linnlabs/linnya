import type { PresentationImageBindingRepositoryPort } from '../../presentationImageOwnership';
import type { PresentationSvgGraphicBindingRepositoryPort } from '../../presentationSvgGraphicOwnership';
import type { PresentationRevisionScope } from '../orchestration/PresentationRevisionScope';

/** 记录 binding 最终赢家，而非可能被并发接管后弃用的候选资产。 */
export function observeRevisionImageBindings(repository: PresentationImageBindingRepositoryPort, scope: PresentationRevisionScope): PresentationImageBindingRepositoryPort {
  return {
    find(input) { const value = repository.find(input); if (value) scope.record(input.presentationId, { assetId: value.assetId, kind: 'image' }); return value; },
    bind(input) { const value = repository.bind(input); scope.record(input.presentationId, { assetId: value.assetId, kind: 'image' }); return value; },
  };
}
export function observeRevisionSvgBindings(repository: PresentationSvgGraphicBindingRepositoryPort, scope: PresentationRevisionScope): PresentationSvgGraphicBindingRepositoryPort {
  return {
    find(input) { const value = repository.find(input); if (value) scope.record(input.presentationId, { assetId: value.assetId, kind: 'svg' }); return value; },
    bind(input) { const value = repository.bind(input); scope.record(input.presentationId, { assetId: value.assetId, kind: 'svg' }); return value; },
  };
}
