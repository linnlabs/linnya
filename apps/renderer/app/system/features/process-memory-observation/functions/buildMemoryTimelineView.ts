import type { ElectronProcessRole } from '@app/schemas';
import type {
  MemoryTimelineSeries,
  MemoryTimelineView,
  ProcessMemoryObservationSample,
} from '../definitions/processMemoryObservation';

const SERIES_ROLES: Readonly<
  Record<Exclude<MemoryTimelineSeries['id'], 'total'>, ElectronProcessRole>
> = {
  main: 'main',
  renderer: 'app-renderer',
  'hidden-worker': 'hidden-worker',
};

function sumRole(sample: ProcessMemoryObservationSample, role: ElectronProcessRole): number {
  return sample.snapshot.metrics.reduce(
    (total, metric) => (metric.role === role ? total + metric.workingSetMB : total),
    0
  );
}

function roundUpScale(value: number): number {
  return Math.max(256, Math.ceil(value / 256) * 256);
}

function buildPoints(
  values: readonly number[],
  width: number,
  height: number,
  yMax: number
): string {
  const divisor = Math.max(1, values.length - 1);
  return values
    .map((value, index) => {
      const x = Math.round((index / divisor) * width * 10) / 10;
      const y = Math.round((height - (value / yMax) * height) * 10) / 10;
      return `${x},${y}`;
    })
    .join(' ');
}

export function buildMemoryTimelineView(
  samples: readonly ProcessMemoryObservationSample[],
  size: { readonly width: number; readonly height: number }
): MemoryTimelineView | null {
  if (samples.length === 0) return null;
  const valuesBySeries: Readonly<Record<MemoryTimelineSeries['id'], readonly number[]>> = {
    total: samples.map(sample => sample.snapshot.totalWorkingSetMB),
    main: samples.map(sample => sumRole(sample, SERIES_ROLES.main)),
    renderer: samples.map(sample => sumRole(sample, SERIES_ROLES.renderer)),
    'hidden-worker': samples.map(sample => sumRole(sample, SERIES_ROLES['hidden-worker'])),
  };
  const yMaxMB = roundUpScale(Math.max(...valuesBySeries.total));
  const series = (Object.keys(valuesBySeries) as MemoryTimelineSeries['id'][]).map(id => ({
    id,
    points: buildPoints(valuesBySeries[id], size.width, size.height, yMaxMB),
  }));
  return { yMaxMB, yMidMB: yMaxMB / 2, series };
}
