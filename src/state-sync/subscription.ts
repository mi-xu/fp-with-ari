import { Effect, Ref } from "effect"
import type {
  State,
  Subscription,
  Event,
  EnvelopedEvent,
  EntityId,
  WorkspaceId,
  EntityType,
} from "./types"
import { getAffectedEntities } from "./types"
import { findReachableEntitiesFromSet } from "./state"

/**
 * Subscription filtering and workspace subgraph tracking
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Index mapping workspace IDs to the set of all entity IDs in their subgraph
 */
export type WorkspaceIndex = ReadonlyMap<WorkspaceId, ReadonlySet<EntityId>>

/**
 * Subscription manager that tracks which entities are relevant for subscriptions
 */
export type SubscriptionManager = {
  /**
   * Rebuild the workspace index from current state
   */
  readonly rebuildIndex: (state: State) => Effect.Effect<void, never, never>

  /**
   * Incrementally update the index based on an event
   */
  readonly updateIndex: (state: State, event: Event) => Effect.Effect<void, never, never>

  /**
   * Check if an event is relevant for a subscription
   */
  readonly isRelevant: (
    event: EnvelopedEvent,
    subscription: Subscription,
    state: State
  ) => Effect.Effect<boolean, never, never>

  /**
   * Get the current workspace index
   */
  readonly getIndex: Effect.Effect<WorkspaceIndex, never, never>
}

// ============================================================================
// Implementation
// ============================================================================

const makeSubscriptionManager = (): Effect.Effect<SubscriptionManager, never, never> =>
  Effect.gen(function* () {
    const index = yield* Ref.make<WorkspaceIndex>(new Map())

    /**
     * Rebuild the entire workspace index from scratch
     */
    const rebuildIndex = (state: State): Effect.Effect<void> =>
      Effect.gen(function* () {
        const newIndex = new Map<WorkspaceId, ReadonlySet<EntityId>>()

        // Find all workspace entities
        const workspaceIds = state.entitiesByType.get("workspace") || new Set()

        // For each workspace, compute its reachable subgraph
        for (const workspaceId of workspaceIds) {
          const reachable = findReachableEntitiesFromSet(state, new Set([workspaceId]))
          newIndex.set(workspaceId as WorkspaceId, reachable)
        }

        yield* Ref.set(index, newIndex)
      })

    /**
     * Incrementally update index based on event
     *
     * Strategy: For simplicity, if an event affects any workspace or entity in a workspace,
     * recompute that workspace's subgraph. This is simpler than trying to incrementally
     * add/remove entities.
     */
    const updateIndex = (state: State, event: Event): Effect.Effect<void> =>
      Effect.gen(function* () {
        const affectedEntities = getAffectedEntities(event)
        const currentIndex = yield* Ref.get(index)

        // Find which workspaces are affected
        const affectedWorkspaces = new Set<WorkspaceId>()

        // Check if any affected entity is a workspace
        for (const entityId of affectedEntities) {
          const entity = state.entities.get(entityId)
          if (entity?.type === "workspace") {
            affectedWorkspaces.add(entityId as WorkspaceId)
          }
        }

        // Check if any affected entity is in a workspace's subgraph
        for (const [workspaceId, entities] of currentIndex) {
          for (const entityId of affectedEntities) {
            if (entities.has(entityId)) {
              affectedWorkspaces.add(workspaceId)
            }
          }
        }

        // Recompute affected workspaces
        if (affectedWorkspaces.size > 0) {
          const newIndex = new Map(currentIndex)

          for (const workspaceId of affectedWorkspaces) {
            // Check if workspace still exists
            if (state.entities.has(workspaceId as EntityId)) {
              const reachable = findReachableEntitiesFromSet(
                state,
                new Set([workspaceId as EntityId])
              )
              newIndex.set(workspaceId, reachable)
            } else {
              // Workspace was deleted
              newIndex.delete(workspaceId)
            }
          }

          yield* Ref.set(index, newIndex)
        }
      })

    /**
     * Check if event is relevant for subscription
     */
    const isRelevant = (
      event: EnvelopedEvent,
      subscription: Subscription,
      state: State
    ): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        // Check user ID
        if (event.userId !== subscription.userId) {
          return false
        }

        const currentIndex = yield* Ref.get(index)
        const affectedEntities = event.affectsEntities

        // Check if any affected entity is an "always include" type
        // Use entity type metadata from the event (captured before deletion)
        // instead of looking up in current state
        for (const entityId of affectedEntities) {
          const entityType = event.entityTypesByAffectedId.get(entityId)
          if (entityType && subscription.alwaysInclude.entityTypes.includes(entityType)) {
            return true
          }
        }

        // Check if any affected entity is in a subscribed workspace
        for (const workspaceId of subscription.workspaces) {
          const workspaceEntities = currentIndex.get(workspaceId)
          if (workspaceEntities) {
            for (const entityId of affectedEntities) {
              if (workspaceEntities.has(entityId)) {
                return true
              }
            }
          }
        }

        return false
      })

    /**
     * Get current index
     */
    const getIndex = Ref.get(index)

    return {
      rebuildIndex,
      updateIndex,
      isRelevant,
      getIndex,
    }
  })

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an entity should be sent as full data when it crosses subscription boundary
 *
 * When an edge is created that connects a subscribed entity to a non-subscribed entity,
 * we need to send the full entity data for the non-subscribed entity.
 */
export const needsFullEntityData = (
  event: Event,
  subscription: Subscription,
  state: State,
  index: WorkspaceIndex
): boolean => {
  if (event.type === "EdgeCreated") {
    const fromEntity = state.entities.get(event.from)
    const toEntity = state.entities.get(event.to)

    if (!fromEntity || !toEntity) return false

    // Check if 'from' is subscribed but 'to' is not
    const fromSubscribed = isEntitySubscribed(event.from, fromEntity.type, subscription, index)
    const toSubscribed = isEntitySubscribed(event.to, toEntity.type, subscription, index)

    // If 'from' is subscribed but 'to' is not, client needs full 'to' data
    return fromSubscribed && !toSubscribed
  }

  return false
}

/**
 * Check if a single entity is subscribed
 */
const isEntitySubscribed = (
  entityId: EntityId,
  entityType: EntityType,
  subscription: Subscription,
  index: WorkspaceIndex
): boolean => {
  // Check if entity type is always included
  if (subscription.alwaysInclude.entityTypes.includes(entityType)) {
    return true
  }

  // Check if entity is in any subscribed workspace
  for (const workspaceId of subscription.workspaces) {
    const workspaceEntities = index.get(workspaceId)
    if (workspaceEntities?.has(entityId)) {
      return true
    }
  }

  return false
}

// ============================================================================
// Public API
// ============================================================================

export const make = (): Effect.Effect<SubscriptionManager> => makeSubscriptionManager()

/**
 * Create a Layer that provides SubscriptionManager
 */
export class SubscriptionManagerService extends Effect.Service<SubscriptionManagerService>()(
  "SubscriptionManagerService",
  {
    effect: makeSubscriptionManager(),
    dependencies: [],
  }
) {}
