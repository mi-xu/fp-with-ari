/**
 * State Synchronization System
 *
 * A generic event-sourced state synchronization system that:
 * - Models state as a graph of entities and edges
 * - Emits delta events when state changes
 * - Batches rapid updates for performance (60fps)
 * - Filters events based on subscriptions (workspace-level)
 * - Supports workspace subgraph tracking
 *
 * Usage:
 * ```typescript
 * import { makeStateSync, makeBatcher, makeSubscriptionManager } from "./state-sync"
 * import { Effect, Stream } from "effect"
 *
 * const program = Effect.gen(function* () {
 *   const batcher = yield* makeBatcher()
 *   const subManager = yield* makeSubscriptionManager()
 *   const sync = yield* makeStateSync({ eventBufferSize: 1000 }, batcher, subManager)
 *
 *   // Publish events
 *   yield* sync.publishEvent(userId, {
 *     type: "EntityCreated",
 *     entityId: EntityId("tab-1"),
 *     entityType: "tab",
 *     data: { url: "https://example.com", title: "Example" }
 *   })
 *
 *   // Subscribe to filtered events
 *   const stream = yield* sync.subscribe({
 *     userId,
 *     alwaysInclude: { entityTypes: ["window", "tab"] },
 *     workspaces: new Set([workspaceId])
 *   })
 *
 *   // Process events
 *   yield* Stream.runForEach(stream, event =>
 *     Effect.sync(() => console.log("Event:", event))
 *   )
 * })
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  EntityId,
  EdgeId,
  UserId,
  WorkspaceId,
  SequenceNumber,
  JsonValue,
  EntityType,
  Entity,
  EdgeType,
  Edge,
  State,
  AtomicEvent,
  Event,
  EnvelopedEvent,
  Subscription,
  StateSyncError,
} from "./types"

export {
  EntityId,
  EdgeId,
  UserId,
  WorkspaceId,
  SequenceNumber,
  SYSTEM_USER_ID,
  emptyState,
  makeEdgeId,
  getAffectedEntities,
} from "./types"

// ============================================================================
// Error Types
// ============================================================================

export {
  InvalidEntityIdError,
  InvalidEdgeIdError,
  InvalidUserIdError,
  InvalidWorkspaceIdError,
  InvalidSequenceNumberError,
  EntityNotFoundError,
  EdgeNotFoundError,
  InvalidEventError,
  QueueFullError,
} from "./types"

// ============================================================================
// State Management
// ============================================================================

export {
  applyEvent,
  applyEventEffect,
  applyEventStrict,
  applyEventStrictEffect,
  getEntitiesByType,
  getOutgoingEdges,
  getIncomingEdges,
  findReachableEntities,
  findReachableEntitiesFromSet,
} from "./state"

// ============================================================================
// Event Batching
// ============================================================================

export type { EventBatcher } from "./batching"
export {
  make as makeBatcher,
  makeFromConfig as makeBatcherFromConfig,
  EventBatcherService,
  EventBatcherServiceLive,
  BatchWindowConfig,
  QueueCapacityConfig,
} from "./batching"

// ============================================================================
// Subscription Management
// ============================================================================

export type { SubscriptionManager, WorkspaceIndex } from "./subscription"
export {
  make as makeSubscriptionManager,
  SubscriptionManagerService,
  needsFullEntityData,
} from "./subscription"

// ============================================================================
// Main Pub/Sub System
// ============================================================================

export type { StateSync, StateSyncConfig } from "./pubsub"
export {
  make as makeStateSync,
  makeFromConfig as makeStateSyncFromConfig,
  StateSyncService,
  StateSyncServiceLive,
  EventBufferSizeConfig,
} from "./pubsub"

// ============================================================================
// Runtime (ManagedRuntime for external framework integration)
// ============================================================================

export type { RuntimeConfig } from "./runtime"
export {
  createStateSyncRuntime,
  createStateSyncRuntimeWithConfig,
  runWithStateSync,
  createDisposableStateSync,
} from "./runtime"
