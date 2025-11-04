import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import {
  EntityId,
  UserId,
  WorkspaceId,
  SequenceNumber,
  makeEdgeId,
  type Subscription,
  type EnvelopedEvent,
  type Event,
  emptyState,
} from "./types"
import { applyEvent } from "./state"
import { make as makeSubscriptionManager } from "./subscription"

/**
 * Tests for subscription filtering and workspace subgraph tracking
 */

describe("Subscription Filtering", () => {
  test("filters by user ID", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    const event: EnvelopedEvent = {
      event: {
        type: "EntityCreated",
        entityId: EntityId("tab-1"),
        entityType: "tab",
        data: {},
      },
      sequenceNumber: SequenceNumber(1),
      userId: UserId("user-1"),
      timestamp: new Date(),
      affectsEntities: [EntityId("tab-1")],
    }

    const subscription: Subscription = {
      userId: UserId("user-2"), // Different user
      alwaysInclude: { entityTypes: ["tab"] },
      workspaces: new Set(),
    }

    const isRelevant = await Effect.runPromise(manager.isRelevant(event, subscription, emptyState))

    expect(isRelevant).toBe(false)
  })

  test("includes events for always-include entity types", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState
    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: {},
    })

    const event: EnvelopedEvent = {
      event: {
        type: "EntityUpdated",
        entityId: EntityId("tab-1"),
        changes: { title: "Updated" },
      },
      sequenceNumber: SequenceNumber(1),
      userId: UserId("user-1"),
      timestamp: new Date(),
      affectsEntities: [EntityId("tab-1")],
    }

    const subscription: Subscription = {
      userId: UserId("user-1"),
      alwaysInclude: { entityTypes: ["window", "tab"] },
      workspaces: new Set(),
    }

    const isRelevant = await Effect.runPromise(manager.isRelevant(event, subscription, state))

    expect(isRelevant).toBe(true)
  })

  test("excludes events for non-subscribed entity types", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState
    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("folder-1"),
      entityType: "folder",
      data: {},
    })

    const event: EnvelopedEvent = {
      event: {
        type: "EntityUpdated",
        entityId: EntityId("folder-1"),
        changes: { name: "My Folder" },
      },
      sequenceNumber: SequenceNumber(1),
      userId: UserId("user-1"),
      timestamp: new Date(),
      affectsEntities: [EntityId("folder-1")],
    }

    const subscription: Subscription = {
      userId: UserId("user-1"),
      alwaysInclude: { entityTypes: ["window", "tab"] }, // folder not included
      workspaces: new Set(),
    }

    const isRelevant = await Effect.runPromise(manager.isRelevant(event, subscription, state))

    expect(isRelevant).toBe(false)
  })
})

describe("Workspace Subgraph Tracking", () => {
  test("rebuild index computes workspace subgraphs", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState

    // Create workspace -> folder -> tab
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

    await Effect.runPromise(manager.rebuildIndex(state))

    const index = await Effect.runPromise(manager.getIndex)
    const workspaceEntities = index.get(WorkspaceId("workspace-1"))

    expect(workspaceEntities).toBeDefined()
    expect(workspaceEntities?.size).toBe(3)
    expect(workspaceEntities?.has(EntityId("workspace-1"))).toBe(true)
    expect(workspaceEntities?.has(EntityId("folder-1"))).toBe(true)
    expect(workspaceEntities?.has(EntityId("tab-1"))).toBe(true)
  })

  test("filters events for subscribed workspace", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState

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
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("workspace-1"), EntityId("folder-1"), "contains"),
      from: EntityId("workspace-1"),
      to: EntityId("folder-1"),
      edgeType: "contains",
      data: {},
    })

    await Effect.runPromise(manager.rebuildIndex(state))

    const event: EnvelopedEvent = {
      event: {
        type: "EntityUpdated",
        entityId: EntityId("folder-1"),
        changes: { name: "My Folder" },
      },
      sequenceNumber: SequenceNumber(1),
      userId: UserId("user-1"),
      timestamp: new Date(),
      affectsEntities: [EntityId("folder-1")],
    }

    const subscription: Subscription = {
      userId: UserId("user-1"),
      alwaysInclude: { entityTypes: [] },
      workspaces: new Set([WorkspaceId("workspace-1")]),
    }

    const isRelevant = await Effect.runPromise(manager.isRelevant(event, subscription, state))

    expect(isRelevant).toBe(true)
  })

  test("excludes events for non-subscribed workspace", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-1"),
      entityType: "workspace",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-2"),
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
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("workspace-2"), EntityId("folder-1"), "contains"),
      from: EntityId("workspace-2"),
      to: EntityId("folder-1"),
      edgeType: "contains",
      data: {},
    })

    await Effect.runPromise(manager.rebuildIndex(state))

    const event: EnvelopedEvent = {
      event: {
        type: "EntityUpdated",
        entityId: EntityId("folder-1"),
        changes: { name: "My Folder" },
      },
      sequenceNumber: SequenceNumber(1),
      userId: UserId("user-1"),
      timestamp: new Date(),
      affectsEntities: [EntityId("folder-1")],
    }

    const subscription: Subscription = {
      userId: UserId("user-1"),
      alwaysInclude: { entityTypes: [] },
      workspaces: new Set([WorkspaceId("workspace-1")]), // Different workspace
    }

    const isRelevant = await Effect.runPromise(manager.isRelevant(event, subscription, state))

    expect(isRelevant).toBe(false)
  })

  test("incrementally updates index when entity added to workspace", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-1"),
      entityType: "workspace",
      data: {},
    })

    await Effect.runPromise(manager.rebuildIndex(state))

    let index = await Effect.runPromise(manager.getIndex)
    expect(index.get(WorkspaceId("workspace-1"))?.size).toBe(1)

    // Add folder to workspace
    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("folder-1"),
      entityType: "folder",
      data: {},
    })

    const edgeEvent: Event = {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("workspace-1"), EntityId("folder-1"), "contains"),
      from: EntityId("workspace-1"),
      to: EntityId("folder-1"),
      edgeType: "contains",
      data: {},
    }

    state = applyEvent(state, edgeEvent)
    await Effect.runPromise(manager.updateIndex(state, edgeEvent))

    index = await Effect.runPromise(manager.getIndex)
    const workspaceEntities = index.get(WorkspaceId("workspace-1"))

    expect(workspaceEntities?.size).toBe(2)
    expect(workspaceEntities?.has(EntityId("workspace-1"))).toBe(true)
    expect(workspaceEntities?.has(EntityId("folder-1"))).toBe(true)
  })

  test("incrementally updates index when workspace deleted", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-1"),
      entityType: "workspace",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-2"),
      entityType: "workspace",
      data: {},
    })

    await Effect.runPromise(manager.rebuildIndex(state))

    let index = await Effect.runPromise(manager.getIndex)
    expect(index.size).toBe(2)

    // Delete workspace-1
    const deleteEvent: Event = {
      type: "EntityDeleted",
      entityId: EntityId("workspace-1"),
    }

    state = applyEvent(state, deleteEvent)
    await Effect.runPromise(manager.updateIndex(state, deleteEvent))

    index = await Effect.runPromise(manager.getIndex)
    expect(index.size).toBe(1)
    expect(index.has(WorkspaceId("workspace-1"))).toBe(false)
    expect(index.has(WorkspaceId("workspace-2"))).toBe(true)
  })

  test("handles complex workspace tree", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState

    // Create:
    //   workspace
    //   ├─ folder-1
    //   │  ├─ tab-1
    //   │  └─ tab-2
    //   └─ folder-2
    //      └─ folder-3
    //         └─ tab-3

    const entities = [
      { id: "workspace-1", type: "workspace" },
      { id: "folder-1", type: "folder" },
      { id: "folder-2", type: "folder" },
      { id: "folder-3", type: "folder" },
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
      { from: "folder-2", to: "folder-3" },
      { from: "folder-3", to: "tab-3" },
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

    await Effect.runPromise(manager.rebuildIndex(state))

    const index = await Effect.runPromise(manager.getIndex)
    const workspaceEntities = index.get(WorkspaceId("workspace-1"))

    expect(workspaceEntities?.size).toBe(7) // All entities
    expect(workspaceEntities?.has(EntityId("workspace-1"))).toBe(true)
    expect(workspaceEntities?.has(EntityId("folder-1"))).toBe(true)
    expect(workspaceEntities?.has(EntityId("folder-2"))).toBe(true)
    expect(workspaceEntities?.has(EntityId("folder-3"))).toBe(true)
    expect(workspaceEntities?.has(EntityId("tab-1"))).toBe(true)
    expect(workspaceEntities?.has(EntityId("tab-2"))).toBe(true)
    expect(workspaceEntities?.has(EntityId("tab-3"))).toBe(true)
  })
})

describe("Combined Filtering", () => {
  test("allows events for always-include types even if not in workspace", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("tab-1"),
      entityType: "tab",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-1"),
      entityType: "workspace",
      data: {},
    })

    await Effect.runPromise(manager.rebuildIndex(state))

    const event: EnvelopedEvent = {
      event: {
        type: "EntityUpdated",
        entityId: EntityId("tab-1"),
        changes: { title: "Updated" },
      },
      sequenceNumber: SequenceNumber(1),
      userId: UserId("user-1"),
      timestamp: new Date(),
      affectsEntities: [EntityId("tab-1")],
    }

    const subscription: Subscription = {
      userId: UserId("user-1"),
      alwaysInclude: { entityTypes: ["tab"] }, // tabs always included
      workspaces: new Set([WorkspaceId("workspace-1")]),
    }

    const isRelevant = await Effect.runPromise(manager.isRelevant(event, subscription, state))

    expect(isRelevant).toBe(true)
  })

  test("filters out non-subscribed entities", async () => {
    const manager = await Effect.runPromise(makeSubscriptionManager())

    let state = emptyState

    // Create two separate workspaces
    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-1"),
      entityType: "workspace",
      data: {},
    })

    state = applyEvent(state, {
      type: "EntityCreated",
      entityId: EntityId("workspace-2"),
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
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("workspace-1"), EntityId("folder-1"), "contains"),
      from: EntityId("workspace-1"),
      to: EntityId("folder-1"),
      edgeType: "contains",
      data: {},
    })

    state = applyEvent(state, {
      type: "EdgeCreated",
      edgeId: makeEdgeId(EntityId("workspace-2"), EntityId("folder-2"), "contains"),
      from: EntityId("workspace-2"),
      to: EntityId("folder-2"),
      edgeType: "contains",
      data: {},
    })

    await Effect.runPromise(manager.rebuildIndex(state))

    const subscription: Subscription = {
      userId: UserId("user-1"),
      alwaysInclude: { entityTypes: [] },
      workspaces: new Set([WorkspaceId("workspace-1")]), // Only workspace-1
    }

    // Event for folder-1 (in workspace-1) should be included
    const event1: EnvelopedEvent = {
      event: {
        type: "EntityUpdated",
        entityId: EntityId("folder-1"),
        changes: { name: "Folder 1" },
      },
      sequenceNumber: SequenceNumber(1),
      userId: UserId("user-1"),
      timestamp: new Date(),
      affectsEntities: [EntityId("folder-1")],
    }

    const relevant1 = await Effect.runPromise(manager.isRelevant(event1, subscription, state))

    expect(relevant1).toBe(true)

    // Event for folder-2 (in workspace-2) should be excluded
    const event2: EnvelopedEvent = {
      event: {
        type: "EntityUpdated",
        entityId: EntityId("folder-2"),
        changes: { name: "Folder 2" },
      },
      sequenceNumber: SequenceNumber(2),
      userId: UserId("user-1"),
      timestamp: new Date(),
      affectsEntities: [EntityId("folder-2")],
    }

    const relevant2 = await Effect.runPromise(manager.isRelevant(event2, subscription, state))

    expect(relevant2).toBe(false)
  })
})
