import {
  assertCanonicalFinalAnswerIdentity,
  assertDistinctAnswerChunkIdentity,
  routeRuntimeEvent,
  type EventEnvelope,
  type RoutedRuntimeEvent,
  type RuntimeEvent,
  type RuntimeEventRoutingIdentity,
} from '../../contracts';
import type { EventBus } from './event-bus';
import type { EventSequencer } from './sequencer';

export interface PublishRuntimeEventOptions {
  renderHint?: EventEnvelope<RuntimeEvent>['render_hint'];
  runLocation?: EventEnvelope<RuntimeEvent>['run_location'];
  /** 已由 Host 提交的 incoming fact 需要 fan-out，但不属于本次 agent 生成结果。 */
  recordInGeneratedJournal?: boolean;
}

/**
 * 单次 execution 的 RuntimeEvent 唯一发布入口。
 *
 * 节点拥有事实内容；publisher 只附着 host 已确定的 run 路由身份、生成 envelope 并 fan-out。
 */
export class RuntimeEventPublisher {
  private readonly generatedEvents: RoutedRuntimeEvent[] = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly sequencer: EventSequencer,
    private readonly identity: RuntimeEventRoutingIdentity,
  ) {
    if (eventBus.executionId !== sequencer.getExecutionId()) {
      throw new Error('RuntimeEventPublisher requires EventBus and EventSequencer from the same execution.');
    }
  }

  publish(
    event: RuntimeEvent,
    source: string,
    options: PublishRuntimeEventOptions = {},
  ): RoutedRuntimeEvent {
    return this.publishRouted(this.route(event), source, options);
  }

  /** 在 durable commit 前为 incoming fact 附着与后续发布完全一致的正式路由身份。 */
  route(event: RuntimeEvent): RoutedRuntimeEvent {
    this.assertAdmissionIdentity(event);
    return routeRuntimeEvent(event, this.identity);
  }

  /** 发布已经持久化的正式事实；身份不一致时拒绝静默改写 durable 语义。 */
  publishRouted(
    routedEvent: RoutedRuntimeEvent,
    source: string,
    options: PublishRuntimeEventOptions = {},
  ): RoutedRuntimeEvent {
    this.assertAdmissionIdentity(routedEvent);
    if (
      routedEvent.run_id !== this.identity.run_id
      || routedEvent.parent_run_id !== this.identity.parent_run_id
      || routedEvent.lane !== this.identity.lane
      || routedEvent.visibility !== this.identity.visibility
    ) {
      throw new Error('RuntimeEventPublisher received a routed event with mismatched run identity.');
    }
    const envelope = this.sequencer.wrapEvent(routedEvent, source, options);
    this.eventBus.publish(envelope);
    if (options.recordInGeneratedJournal !== false) {
      this.generatedEvents.push(routedEvent);
    }
    return routedEvent;
  }

  getGeneratedEvents(): RoutedRuntimeEvent[] {
    return [...this.generatedEvents];
  }

  /** Publisher 再次锁定跨字段身份关系，防止非 schema 调用路径构造非法事实。 */
  private assertAdmissionIdentity(event: RuntimeEvent): void {
    if (event.type === 'final_answer') {
      assertCanonicalFinalAnswerIdentity(event);
      return;
    }
    if (event.type === 'final_answer_chunk') {
      assertDistinctAnswerChunkIdentity(event);
    }
  }
}
