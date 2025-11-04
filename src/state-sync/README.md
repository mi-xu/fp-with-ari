# State Synchronization System

A generic, event-sourced state synchronization system built with Effect-TS. This system maintains complex state as a graph of entities and edges, emits delta events when state changes, and provides filtered, real-time event streams to subscribers.

## Overview

The system is designed for scenarios where:
- A server process maintains authoritative state
- State changes need to be communicated to clients in real-time
- Clients may subscribe to subsets of the overall state
- High-frequency updates need to be batched for performance
- The state model is a flexible graph structure

**Primary Use Case:** Syncing browser window/tab state with user-generated metadata (annotations, workspaces, folders, tags) from a Bun server to a React TypeScript web app.

## Architecture

### Core Concepts

#### 1. Graph-Based State Model

State is modeled as a directed graph:
- **Entities** are nodes (windows, tabs, workspaces, folders, tags, etc.)
- **Edges** connect entities with typed relationships (contains, tagged_with, etc.)
- Both entities and edges can have arbitrary JSON data

```typescript
type Entity = {
  id: EntityId
  type: EntityType
  data: Record<string, JsonValue>
  createdAt: Date
  updatedAt: Date
}

type Edge = {
  id: EdgeId
  from: EntityId
  to: EntityId
  type: EdgeType
  data: Record<string, JsonValue>  // e.g., { "list-index": 0 }
  createdAt: Date
}
```

#### 2. Event-Sourced Updates

State changes are described as events:
- **EntityCreated** - new entity added
- **EntityUpdated** - entity properties changed
- **EntityDeleted** - entity removed
- **EdgeCreated** - relationship established
- **EdgeRemoved** - relationship removed
- **Transaction** - atomic batch of operations

Events are serializable and can be replayed to reconstruct state.

#### 3. Event Batching (16ms Windows)

High-frequency updates (like browser URL changes) are batched within 16ms windows to support 60fps rendering:
- Multiple updates to the same entity are merged
- Batched updates are emitted as single `EntityUpdated` events
- Reduces event volume without sacrificing responsiveness

#### 4. Subscription-Based Filtering

Clients subscribe to relevant portions of state:
- **Always-include types**: Entity types that are always sent (e.g., "window", "tab")
- **Workspace subscriptions**: Subscribe to specific workspaces and receive all entities in their subgraph

The system maintains an index of workspace subgraphs and incrementally updates it as the graph changes.

## API

### Creating the System

```typescript
import { makeStateSync, makeBatcher, makeSubscriptionManager } from "./state-sync"

const program = Effect.gen(function* (_) {
  // Create dependencies
  const batcher = yield* _(makeBatcher({ windowMs: 16 }))
  const subManager = yield* _(makeSubscriptionManager())

  // Create sync system
  const sync = yield* _(makeStateSync(
    { eventBufferSize: 1000 },
    batcher,
    subManager
  ))

  return sync
})
```

### Publishing Events

```typescript
// Create an entity
yield* _(sync.publishEvent(userId, {
  type: "EntityCreated",
  entityId: EntityId("tab-1"),
  entityType: "tab",
  data: { url: "https://example.com", title: "Example" }
}))

// Update an entity
yield* _(sync.publishEvent(userId, {
  type: "EntityUpdated",
  entityId: EntityId("tab-1"),
  changes: { title: "New Title" }
}))

// Create an edge
yield* _(sync.publishEvent(userId, {
  type: "EdgeCreated",
  edgeId: makeEdgeId(EntityId("window-1"), EntityId("tab-1"), "contains"),
  from: EntityId("window-1"),
  to: EntityId("tab-1"),
  edgeType: "contains",
  data: { "list-index": 0 }
}))

// Atomic transaction
yield* _(sync.publishEvent(userId, {
  type: "Transaction",
  operations: [
    { type: "EdgeRemoved", edgeId: oldEdgeId },
    { type: "EdgeCreated", edgeId: newEdgeId, from, to, edgeType: "contains", data: {} }
  ]
}))
```

### Subscribing to Events

```typescript
const subscription: Subscription = {
  userId: UserId("user-1"),
  alwaysInclude: {
    entityTypes: ["window", "tab"]  // Always receive these types
  },
  workspaces: new Set([
    WorkspaceId("workspace-1")  // Also receive entities in this workspace
  ])
}

// Subscribe (returns Effect<Stream, never, Scope>)
const program = Effect.scoped(
  Effect.gen(function* (_) {
    const eventStream = yield* _(sync.subscribe(subscription))

    yield* _(Stream.runForEach(eventStream, event => {
      console.log("Received event:", event)
      // Apply event to local state
    }))
  })
)
```

### Batching Browser Updates

For high-frequency browser events, use the batcher:

```typescript
const batcher = yield* _(sync.getBatcher)

// Schedule rapid updates (will be batched)
yield* _(batcher.scheduleUpdate(
  EntityId("tab-1"),
  { url: "https://example.com/page1" }
))

yield* _(batcher.scheduleUpdate(
  EntityId("tab-1"),
  { title: "Page 1" }
))

// After 16ms, a single EntityUpdated event is emitted with both changes
```

### Getting Current State

```typescript
const state = yield* _(sync.getState)

// Query entities
const tabs = getEntitiesByType(state, "tab")

// Query edges
const outgoing = getOutgoingEdges(state, EntityId("window-1"))
const incoming = getIncomingEdges(state, EntityId("tab-1"))

// Graph traversal
const reachable = findReachableEntities(state, EntityId("workspace-1"))
```

## Design Decisions

### Event Granularity: Fine-Grained + Batching

We use fine-grained atomic events (EntityCreated, EntityUpdated, EdgeCreated, etc.) for semantic clarity, combined with automatic batching for performance:

**Pros:**
- Events have clear meaning
- Easy to reason about state transitions
- Batching handles performance concerns

### Last-Write-Wins for Conflicts

When the same field is updated multiple times, the last update wins. This is appropriate for single-client scenarios.

### Composite Events as Transactions

Complex operations (like moving a tab between folders) are expressed as transactions containing multiple atomic operations. This ensures consistency.

### Workspace-Level Subscriptions

Clients can subscribe to specific workspaces and receive all entities reachable from those workspaces via graph traversal. The system maintains an index that is incrementally updated.

### No Offline Support (Yet)

The current implementation assumes client and server are on the same machine with a live connection. Offline support and conflict resolution would require additional complexity.

## Testing

The system includes comprehensive tests:

### State Tests (`state.test.ts`)
- Entity operations (create, update, delete)
- Edge operations (create, remove, cascade delete)
- Graph traversal (chains, trees, cycles)
- Transactions

### Subscription Tests (`subscription.test.ts`)
- User ID filtering
- Entity type filtering
- Workspace subgraph tracking
- Incremental index updates

### Batching Tests (`batching.test.ts`)
- 16ms window batching
- Multiple entities
- Field override behavior
- Custom window sizes
- Stress tests (100 rapid updates)

### Integration Tests (`integration.test.ts`)
- Full pub/sub flow
- Workspace-based filtering
- Browser tab management simulation
- 1000 tabs scenario
- Batching integration

Run all tests:
```bash
bun test src/state-sync/
```

## File Structure

```
src/state-sync/
├── types.ts          # Core type definitions
├── state.ts          # State management and event application
├── batching.ts       # Event batching system
├── subscription.ts   # Subscription filtering and workspace indexing
├── pubsub.ts         # Main pub/sub system
├── index.ts          # Public API exports
├── README.md         # This file
├── state.test.ts
├── subscription.test.ts
├── batching.test.ts
└── integration.test.ts
```

## Performance Characteristics

- **Event batching**: Reduces event volume by ~10-100x for rapid updates
- **Incremental indexing**: Workspace subscriptions updated incrementally, not rebuilt
- **Efficient graph traversal**: BFS with visited set, handles cycles
- **Immutable state**: New state objects created on updates (Effect-friendly)

### Scale Targets

Tested with:
- 1000 tabs
- Complex workspace hierarchies (3+ levels deep)
- 100 rapid updates/second (batched to ~6 events/second at 16ms window)

## Future Enhancements

Potential additions:
- **Snapshots**: Periodic state snapshots for faster client initialization
- **Event history**: Replay events from sequence number N
- **Compression**: gzip for large state snapshots
- **Optimistic updates**: Client-side prediction with reconciliation
- **Conflict resolution**: Beyond last-write-wins
- **Partial entity subscriptions**: Field-level filtering
- **Schema validation**: Runtime validation of entity/edge data

## Example: Browser Tab Management

```typescript
// Server maintains authoritative state
const program = Effect.gen(function* (_) {
  const sync = yield* _(makeStateSync(...))

  // Browser opens a window
  yield* _(sync.publishEvent(userId, {
    type: "EntityCreated",
    entityId: EntityId("window-1"),
    entityType: "window",
    data: { position: { x: 0, y: 0 } }
  }))

  // User opens a tab
  yield* _(sync.publishEvent(userId, {
    type: "EntityCreated",
    entityId: EntityId("tab-1"),
    entityType: "tab",
    data: { url: "https://example.com", title: "Example" }
  }))

  // Tab added to window
  yield* _(sync.publishEvent(userId, {
    type: "EdgeCreated",
    edgeId: makeEdgeId(EntityId("window-1"), EntityId("tab-1"), "contains"),
    from: EntityId("window-1"),
    to: EntityId("tab-1"),
    edgeType: "contains",
    data: { "list-index": 0 }
  }))

  // User annotates tab (batched updates)
  const batcher = yield* _(sync.getBatcher)
  yield* _(batcher.scheduleUpdate(
    EntityId("tab-1"),
    { customName: "My Favorite Site", notes: "Check daily" }
  ))

  // User organizes into workspace
  yield* _(sync.publishEvent(userId, {
    type: "EdgeCreated",
    edgeId: makeEdgeId(EntityId("workspace-work"), EntityId("tab-1"), "contains"),
    from: EntityId("workspace-work"),
    to: EntityId("tab-1"),
    edgeType: "contains",
    data: {}
  }))
})
```

## License

MIT
