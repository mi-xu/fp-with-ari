import { Effect, Ref, PubSub, Stream, Fiber, Scope } from "effect"
import type {
  State,
  Event,
  EnvelopedEvent,
  EntityId,
  UserId,
  SequenceNumber,
  Subscription,
} from "./types"
import { emptyState, getAffectedEntities, EntityId as EntityIdBrand } from "./types"
import { applyEvent } from "./state"
import type { EventBatcher } from "./batching"
import type { SubscriptionManager } from "./subscription"

/**
 * Main state synchronization pub/sub system
 */

// ============================================================================
// Types
// ============================================================================

export type StateSyncConfig = {
  readonly eventBufferSize: number
}

export type StateSync = {
  /**
   * Publish an event (applies to state and broadcasts to subscribers)
   */
  readonly publishEvent: (userId: UserId, event: Event) => Effect.Effect<EnvelopedEvent>

  /**
   * Get current state snapshot
   */
  readonly getState: Effect.Effect<State>

  /**
   * Get filtered event stream for a subscription
   */
  readonly subscribe: (
    subscription: Subscription
  ) => Effect.Effect<Stream.Stream<EnvelopedEvent>>

  /**
   * Get the event batcher for scheduling browser updates
   */
  readonly getBatcher: Effect.Effect<EventBatcher>

  /**
   * Get stream of batched events (merged into main event stream)
   */
  readonly getBatchedEvents: Stream.Stream<Event>

  /**
   * Shutdown the sync system
   */
  readonly shutdown: Effect.Effect<void>
}

// ============================================================================
// Implementation
// ============================================================================

export const make = (
  config: StateSyncConfig,
  batcher: EventBatcher,
  subManager: SubscriptionManager
): Effect.Effect<StateSync> =>
  Effect.gen(function* () {
    // State
    const state = yield* Ref.make<State>(emptyState)

    // Sequence number counter
    const sequenceCounter = yield* Ref.make<number>(0)

    // Event pub/sub
    const eventPubSub = yield* PubSub.bounded<EnvelopedEvent>(config.eventBufferSize)

    // Track background fibers
    const fibers = yield* Ref.make<Fiber.Fiber<void, never>[]>([])

    /**
     * Get next sequence number
     */
    const getNextSequenceNumber = (): Effect.Effect<SequenceNumber> =>
      Ref.updateAndGet(sequenceCounter, n => n + 1).pipe(
        Effect.map(n => n as SequenceNumber)
      )

    /**
     * Publish an event
     */
    const publishEvent = (userId: UserId, event: Event): Effect.Effect<EnvelopedEvent> =>
      Effect.gen(function* () {
        // Get sequence number
        const sequenceNumber = yield* getNextSequenceNumber()

        // Create enveloped event
        const enveloped: EnvelopedEvent = {
          event,
          sequenceNumber,
          userId,
          timestamp: new Date(),
          affectsEntities: getAffectedEntities(event),
        }

        // Get current state for subscription manager
        const currentState = yield* Ref.get(state)

        // Apply event to state
        const newState = applyEvent(currentState, event)
        yield* Ref.set(state, newState)

        // Update subscription manager index
        yield* subManager.updateIndex(newState, event)

        // Publish to subscribers
        yield* PubSub.publish(eventPubSub, enveloped)

        return enveloped
      })

    /**
     * Subscribe to filtered events
     *
     * Returns a Stream within a scoped Effect. The scope manages the subscription lifecycle.
     */
    const subscribe = (
      subscription: Subscription
    ): Effect.Effect<Stream.Stream<EnvelopedEvent, never, never>, never, Scope.Scope> =>
      Effect.map(
        PubSub.subscribe(eventPubSub),
        dequeue => {
          const stream = Stream.fromQueue(dequeue, { shutdown: true })

          // Filter based on subscription
          const filtered = Stream.filterEffect(stream, event =>
            Effect.gen(function* () {
              const currentState = yield* Ref.get(state)
              return yield* subManager.isRelevant(event, subscription, currentState)
            })
          )

          return filtered
        }
      )

    /**
     * Get current state
     */
    const getState = Ref.get(state)

    /**
     * Get the batcher
     */
    const getBatcher = Effect.succeed(batcher)

    /**
     * Stream of batched events from the batcher
     * These get automatically published as events
     */
    const batchedEventsStream = batcher.events

    // Start background fiber to publish batched events
    const batchPublisher = Stream.runForEach(batchedEventsStream, event =>
      Effect.gen(function* () {
        // Batched events don't have a specific userId context
        // In practice, they should be tagged with userId when scheduled
        // For now, we'll use a placeholder - this should be improved
        const userId = EntityIdBrand("system") as unknown as UserId
        yield* publishEvent(userId, event)
      })
    )

    const batchPublisherFiber = yield* Effect.fork(batchPublisher)
    yield* Ref.update(fibers, fs => [...fs, batchPublisherFiber])

    /**
     * Shutdown
     */
    const shutdown = Effect.gen(function* () {
      // Shutdown batcher
      yield* batcher.shutdown

      // Interrupt background fibers
      const allFibers = yield* Ref.get(fibers)
      yield* Effect.forEach(allFibers, Fiber.interrupt, { discard: true })

      // Shutdown pub/sub
      yield* PubSub.shutdown(eventPubSub)
    })

    return {
      publishEvent,
      getState,
      subscribe,
      getBatcher,
      getBatchedEvents: batchedEventsStream,
      shutdown,
    }
  })

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a new StateSync instance with dependencies
 */
export const makeWithDeps = (
  config: StateSyncConfig = { eventBufferSize: 1000 }
): Effect.Effect<StateSync> =>
  Effect.gen(function* () {
    const batcher = yield* 
      Effect.serviceOption(EventBatcher).pipe(
        Effect.flatMap(option =>
          option._tag === "Some"
            ? Effect.succeed(option.value)
            : Effect.fail(new Error("EventBatcher not provided")
        )
      )
    )

    const subManager = yield* 
      Effect.serviceOption(SubscriptionManager).pipe(
        Effect.flatMap(option =>
          option._tag === "Some"
            ? Effect.succeed(option.value)
            : Effect.fail(new Error("SubscriptionManager not provided")
        )
      )
    )

    return yield* make(config, batcher, subManager)
  })

/**
 * Service wrapper
 */
export class StateSyncService extends Effect.Service<StateSyncService>()("StateSyncService", {
  effect: makeWithDeps(),
  dependencies: [],
}) {}

// Import the service types
import { EventBatcherService } from "./batching"
import { SubscriptionManagerService } from "./subscription"

// Re-export for convenience
export { EventBatcherService, SubscriptionManagerService }

type EventBatcher = EventBatcherService
type SubscriptionManager = SubscriptionManagerService
