import { Effect } from "effect"
import type {
  State,
  Event,
  AtomicEvent,
  Entity,
  Edge,
  EntityId,
  EdgeId,
  EntityType,
} from "./types"
import { emptyState } from "./types"

/**
 * State management and event application
 */

// ============================================================================
// Helper Functions for Immutable Updates
// ============================================================================

const addToSetInMap = <K, V>(
  map: ReadonlyMap<K, ReadonlySet<V>>,
  key: K,
  value: V
): ReadonlyMap<K, ReadonlySet<V>> => {
  const existing = map.get(key) || new Set<V>()
  const updated = new Set(existing).add(value)
  return new Map(map).set(key, updated)
}

const removeFromSetInMap = <K, V>(
  map: ReadonlyMap<K, ReadonlySet<V>>,
  key: K,
  value: V
): ReadonlyMap<K, ReadonlySet<V>> => {
  const existing = map.get(key)
  if (!existing) return map

  const updated = new Set(existing)
  updated.delete(value)

  const newMap = new Map(map)
  if (updated.size === 0) {
    newMap.delete(key)
  } else {
    newMap.set(key, updated)
  }
  return newMap
}

const removeKeyFromSetMap = <K, V>(
  map: ReadonlyMap<K, ReadonlySet<V>>,
  keyToRemove: K
): ReadonlyMap<K, ReadonlySet<V>> => {
  const newMap = new Map(map)
  newMap.delete(keyToRemove)
  return newMap
}

// ============================================================================
// Atomic Event Application
// ============================================================================

const applyAtomicEvent = (state: State, event: AtomicEvent): State => {
  switch (event.type) {
    case "EntityCreated": {
      const entity: Entity = {
        id: event.entityId,
        type: event.entityType,
        data: event.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      return {
        ...state,
        entities: new Map(state.entities).set(event.entityId, entity),
        entitiesByType: addToSetInMap(
          state.entitiesByType,
          event.entityType,
          event.entityId
        ),
      }
    }

    case "EntityUpdated": {
      const existing = state.entities.get(event.entityId)
      if (!existing) {
        // Entity doesn't exist, skip update
        return state
      }

      const updated: Entity = {
        ...existing,
        data: { ...existing.data, ...event.changes },
        updatedAt: new Date(),
      }

      return {
        ...state,
        entities: new Map(state.entities).set(event.entityId, updated),
      }
    }

    case "EntityDeleted": {
      const entity = state.entities.get(event.entityId)
      if (!entity) {
        return state
      }

      // Remove entity
      const newEntities = new Map(state.entities)
      newEntities.delete(event.entityId)

      // Remove from type index
      const newEntitiesByType = removeFromSetInMap(
        state.entitiesByType,
        entity.type,
        event.entityId
      )

      // Find and remove all edges involving this entity
      const edgesToRemove = new Set<EdgeId>()
      const fromEdges = state.edgesByFrom.get(event.entityId) || new Set()
      const toEdges = state.edgesByTo.get(event.entityId) || new Set()

      fromEdges.forEach(edgeId => edgesToRemove.add(edgeId))
      toEdges.forEach(edgeId => edgesToRemove.add(edgeId))

      // Remove edges
      const newEdges = new Map(state.edges)
      let newEdgesByFrom = state.edgesByFrom
      let newEdgesByTo = state.edgesByTo

      edgesToRemove.forEach(edgeId => {
        const edge = state.edges.get(edgeId)
        if (edge) {
          newEdges.delete(edgeId)
          newEdgesByFrom = removeFromSetInMap(newEdgesByFrom, edge.from, edgeId)
          newEdgesByTo = removeFromSetInMap(newEdgesByTo, edge.to, edgeId)
        }
      })

      // Clean up empty index entries
      newEdgesByFrom = removeKeyFromSetMap(newEdgesByFrom, event.entityId)
      newEdgesByTo = removeKeyFromSetMap(newEdgesByTo, event.entityId)

      return {
        ...state,
        entities: newEntities,
        edges: newEdges,
        edgesByFrom: newEdgesByFrom,
        edgesByTo: newEdgesByTo,
        entitiesByType: newEntitiesByType,
      }
    }

    case "EdgeCreated": {
      const edge: Edge = {
        id: event.edgeId,
        from: event.from,
        to: event.to,
        type: event.edgeType,
        data: event.data,
        createdAt: new Date(),
      }

      return {
        ...state,
        edges: new Map(state.edges).set(event.edgeId, edge),
        edgesByFrom: addToSetInMap(state.edgesByFrom, event.from, event.edgeId),
        edgesByTo: addToSetInMap(state.edgesByTo, event.to, event.edgeId),
      }
    }

    case "EdgeRemoved": {
      const edge = state.edges.get(event.edgeId)
      if (!edge) {
        return state
      }

      const newEdges = new Map(state.edges)
      newEdges.delete(event.edgeId)

      return {
        ...state,
        edges: newEdges,
        edgesByFrom: removeFromSetInMap(state.edgesByFrom, edge.from, event.edgeId),
        edgesByTo: removeFromSetInMap(state.edgesByTo, edge.to, event.edgeId),
      }
    }
  }
}

// ============================================================================
// Event Application
// ============================================================================

/**
 * Apply an event to state, returning the new state.
 * Handles both atomic events and transactions.
 */
export const applyEvent = (state: State, event: Event): State => {
  if (event.type === "Transaction") {
    return event.operations.reduce(applyAtomicEvent, state)
  } else {
    return applyAtomicEvent(state, event)
  }
}

/**
 * Effect-based event application with error handling
 */
export const applyEventEffect = (state: State, event: Event): Effect.Effect<State> =>
  Effect.sync(() => applyEvent(state, event))

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Get all entities of a specific type
 */
export const getEntitiesByType = (
  state: State,
  type: EntityType
): ReadonlyArray<Entity> => {
  const ids = state.entitiesByType.get(type) || new Set()
  return Array.from(ids)
    .map(id => state.entities.get(id))
    .filter((e): e is Entity => e !== undefined)
}

/**
 * Get all outgoing edges from an entity
 */
export const getOutgoingEdges = (state: State, entityId: EntityId): ReadonlyArray<Edge> => {
  const edgeIds = state.edgesByFrom.get(entityId) || new Set()
  return Array.from(edgeIds)
    .map(id => state.edges.get(id))
    .filter((e): e is Edge => e !== undefined)
}

/**
 * Get all incoming edges to an entity
 */
export const getIncomingEdges = (state: State, entityId: EntityId): ReadonlyArray<Edge> => {
  const edgeIds = state.edgesByTo.get(entityId) || new Set()
  return Array.from(edgeIds)
    .map(id => state.edges.get(id))
    .filter((e): e is Edge => e !== undefined)
}

/**
 * Find all entities reachable from a starting entity by following outgoing edges
 */
export const findReachableEntities = (
  state: State,
  startId: EntityId
): ReadonlySet<EntityId> => {
  const visited = new Set<EntityId>()
  const queue: EntityId[] = [startId]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue

    visited.add(current)

    const outgoing = getOutgoingEdges(state, current)
    for (const edge of outgoing) {
      if (!visited.has(edge.to)) {
        queue.push(edge.to)
      }
    }
  }

  return visited
}

/**
 * Find all entities reachable from multiple starting entities
 */
export const findReachableEntitiesFromSet = (
  state: State,
  startIds: ReadonlySet<EntityId>
): ReadonlySet<EntityId> => {
  const result = new Set<EntityId>()

  for (const startId of startIds) {
    const reachable = findReachableEntities(state, startId)
    reachable.forEach(id => result.add(id))
  }

  return result
}
