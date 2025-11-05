import { Brand, Data } from "effect"

/**
 * Core domain types for the state synchronization system.
 *
 * The system models state as a directed graph where:
 * - Entities are nodes (windows, tabs, workspaces, folders, tags, etc.)
 * - Edges connect entities with typed relationships (contains, tagged_with, etc.)
 * - Events describe state transitions (entity created/updated/deleted, edge added/removed)
 */

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error types for state synchronization operations
 */
export class InvalidEntityIdError extends Data.TaggedError("InvalidEntityIdError")<{
  readonly id: string
  readonly reason: string
}> {}

export class InvalidEdgeIdError extends Data.TaggedError("InvalidEdgeIdError")<{
  readonly id: string
  readonly reason: string
}> {}

export class InvalidUserIdError extends Data.TaggedError("InvalidUserIdError")<{
  readonly id: string
  readonly reason: string
}> {}

export class InvalidWorkspaceIdError extends Data.TaggedError("InvalidWorkspaceIdError")<{
  readonly id: string
  readonly reason: string
}> {}

export class InvalidSequenceNumberError extends Data.TaggedError("InvalidSequenceNumberError")<{
  readonly value: number
  readonly reason: string
}> {}

export class EntityNotFoundError extends Data.TaggedError("EntityNotFoundError")<{
  readonly entityId: string
}> {}

export class EdgeNotFoundError extends Data.TaggedError("EdgeNotFoundError")<{
  readonly edgeId: string
}> {}

export class InvalidEventError extends Data.TaggedError("InvalidEventError")<{
  readonly event: string
  readonly reason: string
}> {}

export class QueueFullError extends Data.TaggedError("QueueFullError")<{
  readonly capacity: number
}> {}

export type StateSyncError =
  | InvalidEntityIdError
  | InvalidEdgeIdError
  | InvalidUserIdError
  | InvalidWorkspaceIdError
  | InvalidSequenceNumberError
  | EntityNotFoundError
  | EdgeNotFoundError
  | InvalidEventError
  | QueueFullError

// ============================================================================
// IDs and Basic Types with Runtime Validation
// ============================================================================

export type EntityId = string & Brand.Brand<"EntityId">
export const EntityId = Brand.refined<EntityId>(
  (id): id is EntityId => typeof id === "string" && id.length > 0 && id.length <= 256,
  id =>
    Brand.error(
      `Invalid EntityId: ${id} - must be a non-empty string with length <= 256 characters`
    )
)

export type EdgeId = string & Brand.Brand<"EdgeId">
export const EdgeId = Brand.refined<EdgeId>(
  (id): id is EdgeId => typeof id === "string" && id.length > 0 && id.length <= 512,
  id =>
    Brand.error(`Invalid EdgeId: ${id} - must be a non-empty string with length <= 512 characters`)
)

export type UserId = string & Brand.Brand<"UserId">
export const UserId = Brand.refined<UserId>(
  (id): id is UserId => typeof id === "string" && id.length > 0 && id.length <= 256,
  id =>
    Brand.error(`Invalid UserId: ${id} - must be a non-empty string with length <= 256 characters`)
)

// System user ID for internal operations (e.g., batched events)
export const SYSTEM_USER_ID = UserId("system")

export type WorkspaceId = string & Brand.Brand<"WorkspaceId">
export const WorkspaceId = Brand.refined<WorkspaceId>(
  (id): id is WorkspaceId => typeof id === "string" && id.length > 0 && id.length <= 256,
  id =>
    Brand.error(
      `Invalid WorkspaceId: ${id} - must be a non-empty string with length <= 256 characters`
    )
)

export type SequenceNumber = number & Brand.Brand<"SequenceNumber">
export const SequenceNumber = Brand.refined<SequenceNumber>(
  (n): n is SequenceNumber => typeof n === "number" && Number.isInteger(n) && n >= 0,
  n => Brand.error(`Invalid SequenceNumber: ${n} - must be a non-negative integer`)
)

// JSON-serializable values
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | { [key: string]: JsonValue }
  | JsonValue[]

// ============================================================================
// Entities
// ============================================================================

export type EntityType = "window" | "tab" | "workspace" | "folder" | "tag" | string // Extensible for custom types

export type Entity = {
  readonly id: EntityId
  readonly type: EntityType
  readonly data: Record<string, JsonValue>
  readonly createdAt: Date
  readonly updatedAt: Date
}

// ============================================================================
// Edges
// ============================================================================

export type EdgeType =
  | "contains" // window contains tab, folder contains tab/folder
  | "tagged_with" // tab tagged_with tag
  | "belongs_to" // folder belongs_to workspace
  | string // Extensible

export type Edge = {
  readonly id: EdgeId
  readonly from: EntityId
  readonly to: EntityId
  readonly type: EdgeType
  readonly data: Record<string, JsonValue> // e.g., { "list-index": 0 }
  readonly createdAt: Date
}

// Helper to create edge ID from components
export const makeEdgeId = (from: EntityId, to: EntityId, type: EdgeType): EdgeId =>
  EdgeId(`${from}:${type}:${to}`)

// ============================================================================
// State
// ============================================================================

export type State = {
  readonly entities: ReadonlyMap<EntityId, Entity>
  readonly edges: ReadonlyMap<EdgeId, Edge>

  // Indexes for efficient lookups
  readonly edgesByFrom: ReadonlyMap<EntityId, ReadonlySet<EdgeId>>
  readonly edgesByTo: ReadonlyMap<EntityId, ReadonlySet<EdgeId>>
  readonly entitiesByType: ReadonlyMap<EntityType, ReadonlySet<EntityId>>
}

export const emptyState: State = {
  entities: new Map(),
  edges: new Map(),
  edgesByFrom: new Map(),
  edgesByTo: new Map(),
  entitiesByType: new Map(),
}

// ============================================================================
// Events
// ============================================================================

/**
 * Atomic state transitions
 */
export type AtomicEvent =
  | {
      readonly type: "EntityCreated"
      readonly entityId: EntityId
      readonly entityType: EntityType
      readonly data: Record<string, JsonValue>
    }
  | {
      readonly type: "EntityUpdated"
      readonly entityId: EntityId
      readonly changes: Record<string, JsonValue>
    }
  | {
      readonly type: "EntityDeleted"
      readonly entityId: EntityId
    }
  | {
      readonly type: "EdgeCreated"
      readonly edgeId: EdgeId
      readonly from: EntityId
      readonly to: EntityId
      readonly edgeType: EdgeType
      readonly data: Record<string, JsonValue>
    }
  | {
      readonly type: "EdgeRemoved"
      readonly edgeId: EdgeId
    }

/**
 * Event that can be a single atomic operation or a transaction
 */
export type Event =
  | AtomicEvent
  | {
      readonly type: "Transaction"
      readonly operations: ReadonlyArray<AtomicEvent>
    }

/**
 * Event with metadata for sequencing and filtering
 */
export type EnvelopedEvent = {
  readonly event: Event
  readonly sequenceNumber: SequenceNumber
  readonly userId: UserId
  readonly timestamp: Date
  readonly affectsEntities: ReadonlyArray<EntityId>
}

// ============================================================================
// Subscriptions
// ============================================================================

export type Subscription = {
  readonly userId: UserId
  readonly alwaysInclude: {
    readonly entityTypes: ReadonlyArray<EntityType> // e.g., ["window", "tab"]
  }
  readonly workspaces: ReadonlySet<WorkspaceId>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract all entity IDs that an event affects
 * Note: EdgeRemoved only has edgeId, so we can't determine affected entities
 * without state lookup. Returns empty array for EdgeRemoved.
 */
export const getAffectedEntities = (event: Event): EntityId[] => {
  switch (event.type) {
    case "EntityCreated":
    case "EntityUpdated":
    case "EntityDeleted":
      return [event.entityId]

    case "EdgeCreated":
      return [event.from, event.to]

    case "EdgeRemoved":
      // EdgeRemoved only has edgeId, need state lookup to get from/to
      return []

    case "Transaction":
      return event.operations.flatMap(getAffectedEntities)
  }
}
