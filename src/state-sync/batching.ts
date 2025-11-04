import { Effect, Ref, Queue, Stream, Schedule, Duration, Fiber, Config, Layer } from "effect"
import type { EntityId, AtomicEvent, StateSyncError } from "./types"
import { QueueFullError } from "./types"

/**
 * Event batching system that accumulates rapid entity updates within time windows
 * and emits batched updates at specified intervals (default 16ms for 60fps).
 */

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the event batcher with validation
 */
export const BatchWindowConfig = Config.number("BATCH_WINDOW_MS").pipe(
  Config.withDefault(16),
  Config.validate({
    message: "Batch window must be between 1 and 1000ms",
    validation: n => n >= 1 && n <= 1000,
  })
)

export const QueueCapacityConfig = Config.number("BATCH_QUEUE_CAPACITY").pipe(
  Config.withDefault(10000),
  Config.validate({
    message: "Queue capacity must be between 100 and 100000",
    validation: n => n >= 100 && n <= 100000,
  })
)

// ============================================================================
// Types
// ============================================================================

type PendingUpdate = {
  entityId: EntityId
  changes: Record<string, any>
  timestamp: number
}

type BatcherConfig = {
  readonly windowMs: number // Batch window in milliseconds (default 16ms)
  readonly queueCapacity: number // Maximum queue size
}

export type EventBatcher = {
  /**
   * Schedule an entity update to be batched
   */
  readonly scheduleUpdate: (
    entityId: EntityId,
    changes: Record<string, any>
  ) => Effect.Effect<void, QueueFullError>

  /**
   * Get a stream of batched events
   */
  readonly events: Stream.Stream<AtomicEvent, never, never>

  /**
   * Manually flush all pending updates immediately
   */
  readonly flush: Effect.Effect<ReadonlyArray<AtomicEvent>, never, never>

  /**
   * Shutdown the batcher
   */
  readonly shutdown: Effect.Effect<void, never, never>
}

// ============================================================================
// Implementation
// ============================================================================

const makeBatcher = (config: BatcherConfig): Effect.Effect<EventBatcher, never, never> =>
  Effect.gen(function* () {
    // Pending updates map: entityId -> accumulated changes
    const pending = yield* Ref.make(new Map<EntityId, Record<string, any>>())

    // Bounded queue for emitting batched events (with capacity limit)
    const eventQueue = yield* Queue.bounded<AtomicEvent>(config.queueCapacity)

    /**
     * Flush all pending updates to the event queue
     */
    const flush = Effect.gen(function* () {
      const updates = yield* Ref.getAndSet(pending, new Map<EntityId, Record<string, any>>())

      const events: AtomicEvent[] = []

      for (const [entityId, changes] of updates) {
        if (Object.keys(changes).length > 0) {
          events.push({
            type: "EntityUpdated",
            entityId,
            changes,
          })
        }
      }

      // Enqueue all events (fails if queue is full)
      yield* Effect.forEach(events, event => Queue.offer(eventQueue, event), {
        discard: true,
      })

      return events
    })

    /**
     * Schedule an entity update
     */
    const scheduleUpdate = (
      entityId: EntityId,
      changes: Record<string, any>
    ): Effect.Effect<void, QueueFullError, never> =>
      Ref.update(pending, map => {
        const existing = map.get(entityId) || {}
        const merged = { ...existing, ...changes }
        const newMap = new Map(map)
        newMap.set(entityId, merged)
        return newMap
      })

    /**
     * Simplified background fiber that flushes at intervals
     * Uses Effect.repeat with interruptible schedule
     */
    const flusher = flush.pipe(
      Effect.repeat(Schedule.spaced(Duration.millis(config.windowMs))),
      Effect.interruptible,
      Effect.ensuring(
        Effect.gen(function* () {
          // Flush one last time before shutting down
          yield* flush
          yield* Queue.shutdown(eventQueue)
        })
      )
    )

    // Start the background flusher
    const flusherFiber = yield* Effect.fork(flusher)

    /**
     * Get stream of batched events
     */
    const events = Stream.fromQueue(eventQueue, { shutdown: true })

    /**
     * Shutdown the batcher - flushes pending updates and cleans up
     */
    const shutdown = Effect.gen(function* () {
      // Flush any pending updates immediately
      yield* flush
      // Then interrupt the flusher fiber (which will also flush via ensuring)
      yield* Fiber.interrupt(flusherFiber)
      // Give a moment for events to be consumed from the queue
      yield* Effect.sleep(Duration.millis(10))
    })

    return {
      scheduleUpdate,
      events,
      flush,
      shutdown,
    }
  })

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a new event batcher with the given configuration
 */
export const make = (
  config: BatcherConfig = { windowMs: 16, queueCapacity: 10000 }
): Effect.Effect<EventBatcher, never, never> => makeBatcher(config)

/**
 * Create an EventBatcher from Config environment variables
 */
export const makeFromConfig = Effect.gen(function* () {
  const windowMs = yield* BatchWindowConfig
  const queueCapacity = yield* QueueCapacityConfig
  return yield* makeBatcher({ windowMs, queueCapacity })
})

/**
 * Create a Layer that provides EventBatcher using default configuration
 */
export class EventBatcherService extends Effect.Service<EventBatcherService>()(
  "EventBatcherService",
  {
    effect: makeBatcher({ windowMs: 16, queueCapacity: 10000 }),
    dependencies: [],
  }
) {}

/**
 * Create a Layer that provides EventBatcher using Config
 */
export const EventBatcherServiceLive = Layer.effect(EventBatcherService, makeFromConfig)
