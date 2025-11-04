import { Effect, ManagedRuntime, Layer } from "effect"
import type { StateSync, StateSyncConfig } from "./pubsub"
import { make as makeStateSync, StateSyncService, StateSyncServiceLive } from "./pubsub"
import { EventBatcherService, EventBatcherServiceLive } from "./batching"
import { SubscriptionManagerService } from "./subscription"
import type { StateSyncError } from "./types"

/**
 * ManagedRuntime wrapper for StateSync
 *
 * This provides an easier way to integrate the Effect-based StateSync system
 * with external frameworks (Node.js, browser, etc.) that don't natively support Effect.
 *
 * Usage:
 * ```typescript
 * import { createStateSyncRuntime } from "./state-sync/runtime"
 *
 * // Create runtime with default configuration
 * const runtime = createStateSyncRuntime()
 *
 * // Use the runtime
 * const stateSync = await runtime.runPromise(StateSyncService)
 *
 * // Publish events
 * await runtime.runPromise(stateSync.publishEvent(userId, event))
 *
 * // Subscribe to events
 * const stream = await runtime.runPromise(stateSync.subscribe(subscription))
 *
 * // Clean up when done
 * await runtime.dispose()
 * ```
 */

/**
 * Configuration for ManagedRuntime
 */
export type RuntimeConfig = {
  /**
   * Use live configuration from environment variables
   * If false, uses default configuration
   */
  readonly useConfigFromEnv?: boolean
}

/**
 * Create a ManagedRuntime for StateSync with all dependencies
 *
 * This runtime can be used to integrate Effect-based code with external frameworks.
 * The runtime automatically manages the lifecycle of all services.
 */
export const createStateSyncRuntime = (
  config: RuntimeConfig = {}
): ManagedRuntime.ManagedRuntime<StateSyncService, never> => {
  const { useConfigFromEnv = false } = config

  // Build the layer based on configuration
  const layer = useConfigFromEnv
    ? // Use configuration from environment variables
      StateSyncServiceLive
    : // Use default configuration
      StateSyncService.Default

  return ManagedRuntime.make(layer)
}

/**
 * Create a custom ManagedRuntime with specific configuration
 *
 * This allows you to provide custom configuration instead of using defaults
 * or environment variables.
 */
export const createStateSyncRuntimeWithConfig = (
  config: StateSyncConfig & {
    readonly batchWindowMs?: number
    readonly batchQueueCapacity?: number
  }
): ManagedRuntime.ManagedRuntime<StateSyncService, never> => {
  const { eventBufferSize, batchWindowMs = 16, batchQueueCapacity = 10000 } = config

  // Create custom layer with provided configuration
  const customBatcher = Layer.succeed(
    EventBatcherService,
    Effect.runSync(
      Effect.gen(function* () {
        const { make } = yield* Effect.promise(() => import("./batching"))
        return yield* make({ windowMs: batchWindowMs, queueCapacity: batchQueueCapacity })
      })
    )
  )

  const customSubManager = SubscriptionManagerService.Default

  const customStateSync = Layer.effect(
    StateSyncService,
    Effect.gen(function* () {
      const batcher = yield* EventBatcherService
      const subManager = yield* SubscriptionManagerService
      return yield* makeStateSync({ eventBufferSize }, batcher, subManager)
    })
  )

  const layer = Layer.provide(customStateSync, Layer.merge(customBatcher, customSubManager))

  return ManagedRuntime.make(layer)
}

/**
 * Helper function to run a StateSync effect with automatic runtime management
 *
 * This is useful for one-off operations where you don't need to keep the runtime around.
 *
 * Example:
 * ```typescript
 * const result = await runWithStateSync(stateSync =>
 *   stateSync.publishEvent(userId, event)
 * )
 * ```
 */
export const runWithStateSync = <A, E extends StateSyncError>(
  f: (stateSync: StateSync) => Effect.Effect<A, E, never>,
  runtimeConfig?: RuntimeConfig
): Promise<A> => {
  const runtime = createStateSyncRuntime(runtimeConfig)

  return runtime.runPromise(
    Effect.gen(function* () {
      const stateSync = yield* StateSyncService
      const result = yield* f(stateSync)
      return result
    })
  )
}

/**
 * Helper to create a disposable StateSync instance
 *
 * Returns both the StateSync instance and a dispose function.
 * Call dispose when you're done to clean up resources.
 *
 * Example:
 * ```typescript
 * const { stateSync, dispose } = await createDisposableStateSync()
 *
 * // Use stateSync...
 * await stateSync.publishEvent(userId, event)
 *
 * // Clean up
 * await dispose()
 * ```
 */
export const createDisposableStateSync = async (
  runtimeConfig?: RuntimeConfig
): Promise<{
  stateSync: StateSync
  dispose: () => Promise<void>
}> => {
  const runtime = createStateSyncRuntime(runtimeConfig)

  const stateSync = await runtime.runPromise(StateSyncService)

  return {
    stateSync,
    dispose: () => runtime.dispose(),
  }
}
