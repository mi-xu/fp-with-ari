import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { EntityId, EdgeId, makeEdgeId, emptyState, type State, type Event } from "./types"
import {
  applyEvent,
  getEntitiesByType,
  getOutgoingEdges,
  getIncomingEdges,
  findReachableEntities,
} from "./state"

/**
 * Tests for state management and event application
 */

describe("Entity Operations", () => {
  test("create entity", () => {
    const event: Event = {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: { url: "https://example.com", title: "Example" },
    }

    const newState = applyEvent(emptyState, event)

    expect(newState.entities.size).toBe(1)
    const entity = newState.entities.get(EntityId("tab-1"))
    expect(entity).toBeDefined()
    expect(entity?.type).toBe("tab")
    expect(entity?.data.url).toBe("https://example.com")
    expect(entity?.data.title).toBe("Example")
  })

  test("create multiple entities", () => {
    let state = emptyState

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("window-1"),
      entityType: "window",
      data: { position: { x: 0, y: 0 } },
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: { url: "https://example.com" },
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-2"),
      entityType: "tab",
      data: { url: "https://test.com" },
    })

    expect(state.entities.size).toBe(3)
    expect(getEntitiesByType(state, "tab").length).toBe(2)
    expect(getEntitiesByType(state, "window").length).toBe(1)
  })

  test("update entity", () => {
    let state = applyEvent(emptyState, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: { url: "https://example.com", title: "Example" },
    })

    state = applyEvent(state, {
      type: "EntityUpdated",
      entityId: EntityId("tab-1"),
      changes: { title: "Updated Title" },
    })

    const entity = state.entities.get(EntityId("tab-1"))
    expect(entity?.data.title).toBe("Updated Title")
    expect(entity?.data.url).toBe("https://example.com") // Unchanged
  })

  test("update merges changes", () => {
    let state = applyEvent(emptyState, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: { url: "https://example.com", title: "Example", favicon: "icon.png" },
    })

    state = applyEvent(state, {
      type: "EntityUpdated",
      entityId: EntityId("tab-1"),
      changes: { title: "New Title", notes: "Important" },
    })

    const entity = state.entities.get(EntityId("tab-1"))
    expect(entity?.data.url).toBe("https://example.com")
    expect(entity?.data.title).toBe("New Title")
    expect(entity?.data.favicon).toBe("icon.png")
    expect(entity?.data.notes).toBe("Important")
  })

  test("update non-existent entity is no-op", () => {
    const state = applyEvent(emptyState, {
      type: "EntityUpdated",
      entityId: EntityId("does-not-exist"),
      changes: { foo: "bar" },
    })

    expect(state.entities.size).toBe(0)
  })

  test("delete entity", () => {
    let state = applyEvent(emptyState, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: { url: "https://example.com" },
    })

    state = applyEvent(state, {
      type: "EntityDeleted",
      entityId: EntityId("tab-1"),
    })

    expect(state.entities.size).toBe(0)
    expect(state.entitiesByType.get("tab")).toBeUndefined()
  })

  test("delete entity removes from type index", () => {
    let state = applyEvent(emptyState, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-2"),
      entityType: "tab",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityDeleted",
      entityId: EntityId("tab-1"),
    })

    expect(state.entities.size).toBe(1)
    expect(getEntitiesByType(state, "tab").length).toBe(1)
    expect(state.entities.has(EntityId("tab-2"))).toBe(true)
  })

  test("delete non-existent entity is no-op", () => {
    const state = applyEvent(emptyState, {
      type: "EntityDeleted",
      entityId: EntityId("does-not-exist"),
    })

    expect(state.entities.size).toBe(0)
  })
})

describe("Edge Operations", () => {
  test("create edge", () => {
    let state = applyEvent(emptyState, {
      type: "EntityCreated",
      entityId: EntityId("window-1"),
      entityType: "window",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: {},
    })

    const edgeId = makeEdgeId(EntityId("window-1"), EntityId("tab-1"), "contains")

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId,
      from: EntityId("window-1"),
      to: EntityId("tab-1"),
      edgeType: "contains",
      data: { "list-index": 0 },
    })

    expect(state.edges.size).toBe(1)
    const edge = state.edges.get(edgeId)
    expect(edge?.from).toBe(EntityId("window-1"))
    expect(edge?.to).toBe(EntityId("tab-1"))
    expect(edge?.type).toBe("contains")
    expect(edge?.data["list-index"]).toBe(0)
  })

  test("create multiple edges", () => {
    let state = emptyState

    // Create entities
    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("window-1"),
      entityType: "window",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-2"),
      entityType: "tab",
      data: {},
    })

    // Create edges
    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("window-1"), EntityId("tab-1"), "contains"),
      from: EntityId("window-1"),
      to: EntityId("tab-1"),
      edgeType: "contains",
      data: { "list-index": 0 },
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("window-1"), EntityId("tab-2"), "contains"),
      from: EntityId("window-1"),
      to: EntityId("tab-2"),
      edgeType: "contains",
      data: { "list-index": 1 },
    })

    expect(state.edges.size).toBe(2)

    const outgoing = getOutgoingEdges(state, EntityId("window-1"))
    expect(outgoing.length).toBe(2)

    const incoming1 = getIncomingEdges(state, EntityId("tab-1"))
    expect(incoming1.length).toBe(1)
    expect(incoming1[0].from).toBe(EntityId("window-1"))
  })

  test("remove edge", () => {
    let state = emptyState

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("window-1"),
      entityType: "window",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: {},
    })

    const edgeId = makeEdgeId(EntityId("window-1"), EntityId("tab-1"), "contains")

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId,
      from: EntityId("window-1"),
      to: EntityId("tab-1"),
      edgeType: "contains",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeRemoved",
      edgeId,
    })

    expect(state.edges.size).toBe(0)
    expect(getOutgoingEdges(state, EntityId("window-1")).length).toBe(0)
    expect(getIncomingEdges(state, EntityId("tab-1")).length).toBe(0)
  })

  test("delete entity cascades to edges", () => {
    let state = emptyState

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("window-1"),
      entityType: "window",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-2"),
      entityType: "tab",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("window-1"), EntityId("tab-1"), "contains"),
      from: EntityId("window-1"),
      to: EntityId("tab-1"),
      edgeType: "contains",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("window-1"), EntityId("tab-2"), "contains"),
      from: EntityId("window-1"),
      to: EntityId("tab-2"),
      edgeType: "contains",
      data: {},
    })

    // Delete window should cascade to both edges
    state = applyEvent(state, {
      type: "EntityDeleted",
      entityId: EntityId("window-1"),
    })

    expect(state.entities.size).toBe(2) // Only tabs remain
    expect(state.edges.size).toBe(0) // All edges removed
    expect(getIncomingEdges(state, EntityId("tab-1")).length).toBe(0)
    expect(getIncomingEdges(state, EntityId("tab-2")).length).toBe(0)
  })
})

describe("Graph Traversal", () => {
  test("find reachable entities in simple chain", () => {
    let state = emptyState

    // Create: workspace -> folder -> tab
    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-1"),
      entityType: "workspace",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("folder-1"),
      entityType: "folder",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("workspace-1"), EntityId("folder-1"), "contains"),
      from: EntityId("workspace-1"),
      to: EntityId("folder-1"),
      edgeType: "contains",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("folder-1"), EntityId("tab-1"), "contains"),
      from: EntityId("folder-1"),
      to: EntityId("tab-1"),
      edgeType: "contains",
      data: {},
    })

    const reachable = findReachableEntities(state, EntityId("workspace-1"))

    expect(reachable.size).toBe(3)
    expect(reachable.has(EntityId("workspace-1"))).toBe(true)
    expect(reachable.has(EntityId("folder-1"))).toBe(true)
    expect(reachable.has(EntityId("tab-1"))).toBe(true)
  })

  test("find reachable entities in tree", () => {
    let state = emptyState

    // Create tree:
    //   workspace
    //   ├─ folder-1
    //   │  ├─ tab-1
    //   │  └─ tab-2
    //   └─ folder-2
    //      └─ tab-3

    const entities = [
      { id: "workspace-1", type: "workspace" },
      { id: "folder-1", type: "folder" },
      { id: "folder-2", type: "folder" },
      { id: "tab-1", type: "tab" },
      { id: "tab-2", type: "tab" },
      { id: "tab-3", type: "tab" },
    ]

    for (const { id, type } of entities) {
      state = applyEvent(state, {
        type: "EntityCreated",
        entityId: EntityId(id),
        entityType: type,
        data: {},
      })
    }

    const edges = [
      { from: "workspace-1", to: "folder-1" },
      { from: "workspace-1", to: "folder-2" },
      { from: "folder-1", to: "tab-1" },
      { from: "folder-1", to: "tab-2" },
      { from: "folder-2", to: "tab-3" },
    ]

    for (const { from, to } of edges) {
      state = applyEvent(state, {
        type: "EdgeCreated",
        edgeId: makeEdgeId(EntityId(from), EntityId(to), "contains"),
        from: EntityId(from),
        to: EntityId(to),
        edgeType: "contains",
        data: {},
      })
    }

    const reachable = findReachableEntities(state, EntityId("workspace-1"))

    expect(reachable.size).toBe(6)
    expect(reachable.has(EntityId("workspace-1"))).toBe(true)
    expect(reachable.has(EntityId("folder-1"))).toBe(true)
    expect(reachable.has(EntityId("folder-2"))).toBe(true)
    expect(reachable.has(EntityId("tab-1"))).toBe(true)
    expect(reachable.has(EntityId("tab-2"))).toBe(true)
    expect(reachable.has(EntityId("tab-3"))).toBe(true)
  })

  test("reachable entities with cycles", () => {
    let state = emptyState

    // Create cycle: A -> B -> C -> A
    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("a"),
      entityType: "node",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("b"),
      entityType: "node",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("c"),
      entityType: "node",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("a"), EntityId("b"), "links"),
      from: EntityId("a"),
      to: EntityId("b"),
      edgeType: "links",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("b"), EntityId("c"), "links"),
      from: EntityId("b"),
      to: EntityId("c"),
      edgeType: "links",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("c"), EntityId("a"), "links"),
      from: EntityId("c"),
      to: EntityId("a"),
      edgeType: "links",
      data: {},
    })

    const reachable = findReachableEntities(state, EntityId("a"))

    expect(reachable.size).toBe(3)
    expect(reachable.has(EntityId("a"))).toBe(true)
    expect(reachable.has(EntityId("b"))).toBe(true)
    expect(reachable.has(EntityId("c"))).toBe(true)
  })
})

describe("Transactions", () => {
  test("transaction applies multiple operations atomically", () => {
    const transaction: Event = {
      type: "Transaction",
      operations: [
        {
          type: "EntityCreated",
          entityId: EntityId("window-1"),
          entityType: "window",
          data: {},
        },
        {
          type: "EntityCreated",
          entityId: EntityId("tab-1"),
          entityType: "tab",
          data: {},
        },
        {
          type: "EdgeCreated",
          edgeId: makeEdgeId(EntityId("window-1"), EntityId("tab-1"), "contains"),
          from: EntityId("window-1"),
          to: EntityId("tab-1"),
          edgeType: "contains",
          data: { "list-index": 0 },
        },
      ],
    }

    const state = applyEvent(emptyState, transaction)

    expect(state.entities.size).toBe(2)
    expect(state.edges.size).toBe(1)
    expect(getOutgoingEdges(state, EntityId("window-1")).length).toBe(1)
  })

  test("complex transaction: move tab between folders", () => {
    let state = emptyState

    // Setup: workspace with two folders, tab in folder-1
    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-1"),
      entityType: "workspace",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("folder-1"),
      entityType: "folder",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("folder-2"),
      entityType: "folder",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("folder-1"), EntityId("tab-1"), "contains"),
      from: EntityId("folder-1"),
      to: EntityId("tab-1"),
      edgeType: "contains",
      data: { "list-index": 0 },
    })

    // Move tab from folder-1 to folder-2 (atomic operation)
    const moveTransaction: Event = {
      type: "Transaction",
      operations: [
        {
          type: "EdgeRemoved",
          edgeId: makeEdgeId(EntityId("folder-1"), EntityId("tab-1"), "contains"),
        },
        {
          type: "EdgeCreated",
          edgeId: makeEdgeId(EntityId("folder-2"), EntityId("tab-1"), "contains"),
          from: EntityId("folder-2"),
          to: EntityId("tab-1"),
          edgeType: "contains",
          data: { "list-index": 0 },
        },
      ],
    }

    state = applyEvent(state, moveTransaction)

    expect(getOutgoingEdges(state, EntityId("folder-1")).length).toBe(0)
    expect(getOutgoingEdges(state, EntityId("folder-2")).length).toBe(1)
    expect(getIncomingEdges(state, EntityId("tab-1")).length).toBe(1)
    expect(getIncomingEdges(state, EntityId("tab-1"))[0].from).toBe(EntityId("folder-2"))
  })
})
