import { buildProcessMemoryObservationReport } from '../functions/buildProcessMemoryObservationReport';
import { useProcessMemoryObservationStore } from '../store/processMemoryObservationStore';

function buildReportFileName(timestamp: number): string {
  const date = new Date(timestamp);
  const stamp = date.toISOString().replace(/:/gu, '-').replace(/\.\d{3}Z$/u, 'Z');
  return `linnya-memory-${stamp}.json`;
}

export async function exportProcessMemoryObservation(): Promise<'saved' | 'cancelled'> {
  const store = useProcessMemoryObservationStore();
  const report = buildProcessMemoryObservationReport({
    sessionId: store.sessionId,
    startedAt: store.startedAt,
    stoppedAt: store.stoppedAt,
    intervalMs: store.intervalMs,
    samples: store.samples,
    markers: store.markers,
  });
  const result = await window.electronAPI.exportFile(
    buildReportFileName(store.startedAt || Date.now()),
    JSON.stringify(report, null, 2),
    {
      fileType: 'json',
      title: '导出内存诊断报告',
      buttonLabel: '导出',
      filterName: 'JSON 报告',
    },
  );
  if (result.success) return 'saved';
  if (result.cancelled) return 'cancelled';
  throw new Error(result.error ?? '导出内存诊断报告失败');
}
