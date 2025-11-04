import { Effect, Ref, Queue, Stream, Schedule, Duration } from "effect"
import type { EntityId, AtomicEvent } from "./types"

/**
 * Event batching system that accumulates rapid entity updates within time windows
 * and emits batched updates at specified intervals (default 16ms for 60fps).
 */

// ============================================================================
// Types
// ============================================================================

type PendingUpdate = {
  entityId: EntityId
  changes: Record<string, any>
  timestamp: number
}

type BatcherConfig = {
  readonly windowMs: number  // Batch window in milliseconds (default 16ms)
}

export type EventBatcher = {
  /**
   * Schedule an entity update to be batched
   */
  readonly scheduleUpdate: (
    entityId: EntityId,
    changes: Record<string, any>
  ) => Effect.Effect<void>

  /**
   * Get a stream of batched events
   */
  readonly events: Stream.Stream<AtomicEvent>

  /**
   * Manually flush all pending updates immediately
   */
  readonly flush: Effect.Effect<ReadonlyArray<AtomicEvent>>

  /**
   * Shutdown the batcher
   */
  readonly shutdown: Effect.Effect<void>
}

// ============================================================================
// Implementation
// ============================================================================

const makeBatcher = (config: BatcherConfig): Effect.Effect<EventBatcher> =>
  Effect.gen(function* () {
    // Pending updates map: entityId -> accumulated changes
    const pending = yield* Ref.make(new Map<EntityId, Record<string, any>>())

    // Queue for emitting batched events
    const eventQueue = yield* Queue.unbounded<AtomicEvent>()

    // Running flag
    const running = yield* Ref.make(true)

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

      // Enqueue all events
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
    ): Effect.Effect<void> =>
      Ref.update(pending, map => {
        const existing = map.get(entityId) || {}
        const merged = { ...existing, ...changes }
        const newMap = new Map(map)
        newMap.set(entityId, merged)
        return newMap
      })

    /**
     * Background fiber that flushes at intervals
     */
    const flusher = Effect.gen(function* () {
      yield* flush.pipe(
        Effect.repeat(
          Schedule.spaced(Duration.millis(config.windowMs)).pipe(
            Schedule.whileInput(() =>
              Effect.gen(function* () {
                return yield* Ref.get(running)
              })
            )
          )
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            // Flush one last time before shutting down
            yield* flush
            yield* Queue.shutdown(eventQueue)
          })
        )
      )
    })

    // Start the background flusher
    const flusherFiber = yield* Effect.fork(flusher)

    /**
     * Get stream of batched events
     */
    const events = Stream.fromQueue(eventQueue)

    /**
     * Shutdown the batcher
     */
    const shutdown = Effect.gen(function* () {
      yield* Ref.set(running, false)
      yield* Effect.sleep(Duration.millis(config.windowMs * 2)) // Wait for final flush
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
export const make = (config: BatcherConfig = { windowMs: 16 }): Effect.Effect<EventBatcher> =>
  makeBatcher(config)

/**
 * Create a Layer that provides EventBatcher
 */
export class EventBatcherService extends Effect.Service<EventBatcherService>()(
  "EventBatcherService",
  {
    effect: makeBatcher({ windowMs: 16 }),
    dependencies: [],
  }
) {}
