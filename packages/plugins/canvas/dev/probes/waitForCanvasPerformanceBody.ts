interface BodySnapshot {
  readonly stats: { readonly failed: number; readonly pending: number; readonly running: boolean } | undefined;
  readonly resourcesIdle: boolean;
  readonly fadingCards: number;
  readonly presentationReady: boolean;
}

function ready(snapshot: BodySnapshot): boolean {
  const { stats } = snapshot;
  return stats !== undefined && !stats.failed && !stats.pending && !stats.running
    && snapshot.resourcesIdle && !snapshot.fadingCards && snapshot.presentationReady;
}

/** 队列暂空只是候选状态；两个真实绘制帧之后须重新读取同一份完成事实。 */
export async function waitForCanvasPerformanceBody<Snapshot extends BodySnapshot>(ports: {
  readonly readSnapshot: () => Snapshot;
  readonly now: () => number;
  readonly nextFrame: () => Promise<unknown>;
}) {
  const started = ports.now();
  const result = (settled: boolean, snapshot: Snapshot) => ({ settled, ms: ports.now() - started, snapshot });
  let snapshot = ports.readSnapshot();
  while (ports.now() - started < 5000) {
    if (snapshot.stats?.failed) return result(false, snapshot);
    if (ready(snapshot)) {
      await ports.nextFrame(); await ports.nextFrame();
      // paint失败、新正文需求或尚未实际draw的当前版本都可能在await期间出现。
      snapshot = ports.readSnapshot();
      if (snapshot.stats?.failed) return result(false, snapshot);
      if (ready(snapshot)) return result(true, snapshot);
    }
    await ports.nextFrame();
    snapshot = ports.readSnapshot();
  }
  return result(false, ports.readSnapshot());
}
