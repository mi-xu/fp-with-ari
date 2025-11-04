import { describe, test, expect } from "bun:test"
import { Effect, Stream, Duration, Fiber } from "effect"
import {
  EntityId,
  UserId,
  WorkspaceId,
  makeEdgeId,
  type Event,
  type EnvelopedEvent,
  type Subscription,
} from "./types"
import { make as makeBatcher } from "./batching"
import { make as makeSubscriptionManager } from "./subscription"
import { make as makeStateSync } from "./pubsub"

/**
 * Integration tests for the complete state synchronization system
 */

describe("Full System Integration", () => {
  test("publishes and filters events for single subscriber", async () => {
    const program = Effect.gen(function* (_) {
      const batcher = yield* _(makeBatcher({ windowMs: 16 }))
      const subManager = yield* _(makeSubscriptionManager())
      const sync = yield* _(
        makeStateSync({ eventBufferSize: 100 }, batcher, subManager)
      )

      const subscription: Subscription = {
        userId: UserId("user-1"),
        alwaysInclude: { entityTypes: ["window", "tab"] },
        workspaces: new Set(),
      }

      const collectedEvents: EnvelopedEvent[] = []

      // Start collecting events in a scoped fiber
      const collectorFiber = yield* _(
        Effect.fork(
          Effect.scoped(
            Effect.gen(function* (_) {
              const eventStream = yield* _(sync.subscribe(subscription))
              yield* _(
                Stream.runForEach(
                  Stream.take(eventStream, 3), // Expect 3 events
                  event => Effect.sync(() => collectedEvents.push(event))
                )
              )
            })
          )
        )
      )

      // Give stream time to set up
      yield* _(Effect.sleep(Duration.millis(10)))

      // Publish events
      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityCreated",
          entityId: EntityId("window-1"),
          entityType: "window",
          data: {},
        })
      )

      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityCreated",
          entityId: EntityId("tab-1"),
          entityType: "tab",
          data: { url: "https://example.com" },
        })
      )

      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityUpdated",
          entityId: EntityId("tab-1"),
          changes: { title: "Example" },
        })
      )

      // Wait for events to be collected
      yield* _(Fiber.join(collectorFiber))

      expect(collectedEvents.length).toBe(3)
      expect(collectedEvents[0].event.type).toBe("EntityCreated")
      expect(collectedEvents[1].event.type).toBe("EntityCreated")
      expect(collectedEvents[2].event.type).toBe("EntityUpdated")

      yield* _(sync.shutdown)
    })

    await Effect.runPromise(program)
  })

  test("filters out events for different user", async () => {
    const program = Effect.gen(function* (_) {
      const batcher = yield* _(makeBatcher({ windowMs: 16 }))
      const subManager = yield* _(makeSubscriptionManager())
      const sync = yield* _(
        makeStateSync({ eventBufferSize: 100 }, batcher, subManager)
      )

      const subscription: Subscription = {
        userId: UserId("user-1"),
        alwaysInclude: { entityTypes: ["tab"] },
        workspaces: new Set(),
      }

      const collectedEvents: EnvelopedEvent[] = []

      const collectorFiber = yield* _(
        Effect.fork(
          Effect.scoped(
            Effect.gen(function* (_) {
              const eventStream = yield* _(sync.subscribe(subscription))
              yield* _(
                Stream.runForEach(
                  Stream.take(eventStream, 1), // Should only get 1 event
                  event => Effect.sync(() => collectedEvents.push(event))
                )
              )
            })
          )
        )
      )

      yield* _(Effect.sleep(Duration.millis(10)))

      // Event for different user - should be filtered out
      yield* _(
        sync.publishEvent(UserId("user-2"), {
          type: "EntityCreated",
          entityId: EntityId("tab-1"),
          entityType: "tab",
          data: {},
        })
      )

      // Event for correct user - should be received
      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityCreated",
          entityId: EntityId("tab-2"),
          entityType: "tab",
          data: {},
        })
      )

      yield* _(Fiber.join(collectorFiber))

      expect(collectedEvents.length).toBe(1)
      expect(collectedEvents[0].userId).toBe(UserId("user-1"))

      yield* _(sync.shutdown)
    })

    await Effect.runPromise(program)
  })

  test("workspace-based filtering works end-to-end", async () => {
    const program = Effect.gen(function* (_) {
      const batcher = yield* _(makeBatcher({ windowMs: 16 }))
      const subManager = yield* _(makeSubscriptionManager())
      const sync = yield* _(
        makeStateSync({ eventBufferSize: 100 }, batcher, subManager)
      )

      // Create workspace structure
      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityCreated",
          entityId: EntityId("workspace-1"),
          entityType: "workspace",
          data: { name: "My Workspace" },
        })
      )

      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityCreated",
          entityId: EntityId("folder-1"),
          entityType: "folder",
          data: { name: "My Folder" },
        })
      )

      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EdgeCreated",
          edgeId: makeEdgeId(
            EntityId("workspace-1"),
            EntityId("folder-1"),
            "contains"
          ),
          from: EntityId("workspace-1"),
          to: EntityId("folder-1"),
          edgeType: "contains",
          data: {},
        })
      )

      // Rebuild index to catch up
      const state = yield* _(sync.getState)
      yield* _(subManager.rebuildIndex(state))

      // Now subscribe to workspace-1
      const subscription: Subscription = {
        userId: UserId("user-1"),
        alwaysInclude: { entityTypes: [] }, // No always-include types
        workspaces: new Set([WorkspaceId("workspace-1")]),
      }

      const collectedEvents: EnvelopedEvent[] = []

      const collectorFiber = yield* _(
        Effect.fork(
          Effect.scoped(
            Effect.gen(function* (_) {
              const eventStream = yield* _(sync.subscribe(subscription))
              yield* _(
                Stream.runForEach(
                  Stream.take(eventStream, 1),
                  event => Effect.sync(() => collectedEvents.push(event))
                )
              )
            })
          )
        )
      )

      yield* _(Effect.sleep(Duration.millis(10)))

      // Update folder in workspace - should be received
      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityUpdated",
          entityId: EntityId("folder-1"),
          changes: { name: "Updated Folder" },
        })
      )

      yield* _(Fiber.join(collectorFiber))

      expect(collectedEvents.length).toBe(1)
      expect(collectedEvents[0].event.type).toBe("EntityUpdated")

      yield* _(sync.shutdown)
    })

    await Effect.runPromise(program)
  })

  test("simulates browser tab management scenario", async () => {
    const program = Effect.gen(function* (_) {
      const batcher = yield* _(makeBatcher({ windowMs: 16 }))
      const subManager = yield* _(makeSubscriptionManager())
      const sync = yield* _(
        makeStateSync({ eventBufferSize: 100 }, batcher, subManager)
      )

      const subscription: Subscription = {
        userId: UserId("user-1"),
        alwaysInclude: { entityTypes: ["window", "tab"] },
        workspaces: new Set(),
      }

      const collectedEvents: EnvelopedEvent[] = []

      const collectorFiber = yield* _(
        Effect.fork(
          Effect.scoped(
            Effect.gen(function* (_) {
              const eventStream = yield* _(sync.subscribe(subscription))
              yield* _(
                Stream.runForEach(
                  Stream.take(eventStream, 6),
                  event => Effect.sync(() => collectedEvents.push(event))
                )
              )
            })
          )
        )
      )

      yield* _(Effect.sleep(Duration.millis(10)))

      // Simulate: Browser window opens
      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityCreated",
          entityId: EntityId("window-1"),
          entityType: "window",
          data: { position: { x: 0, y: 0 } },
        })
      )

      // Simulate: Two tabs open in window
      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityCreated",
          entityId: EntityId("tab-1"),
          entityType: "tab",
          data: { url: "https://example.com", title: "Example" },
        })
      )

      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityCreated",
          entityId: EntityId("tab-2"),
          entityType: "tab",
          data: { url: "https://test.com", title: "Test" },
        })
      )

      // Simulate: Tabs added to window
      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EdgeCreated",
          edgeId: makeEdgeId(EntityId("window-1"), EntityId("tab-1"), "contains"),
          from: EntityId("window-1"),
          to: EntityId("tab-1"),
          edgeType: "contains",
          data: { "list-index": 0 },
        })
      )

      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EdgeCreated",
          edgeId: makeEdgeId(EntityId("window-1"), EntityId("tab-2"), "contains"),
          from: EntityId("window-1"),
          to: EntityId("tab-2"),
          edgeType: "contains",
          data: { "list-index": 1 },
        })
      )

      // Simulate: Tab URL changes (navigation)
      yield* _(
        sync.publishEvent(UserId("user-1"), {
          type: "EntityUpdated",
          entityId: EntityId("tab-1"),
          changes: {
            url: "https://example.com/page2",
            title: "Example - Page 2",
          },
        })
      )

      yield* _(Fiber.join(collectorFiber))

      expect(collectedEvents.length).toBe(6)

      // Verify final state
      const finalState = yield* _(sync.getState)
      expect(finalState.entities.size).toBe(3) // 1 window + 2 tabs
      expect(finalState.edges.size).toBe(2) // 2 contains edges

      const tab1 = finalState.entities.get(EntityId("tab-1"))
      expect(tab1?.data.url).toBe("https://example.com/page2")

      yield* _(sync.shutdown)
    })

    await Effect.runPromise(program)
  })

  test("simulates complex workspace with folders and tabs", async () => {
    const program = Effect.gen(function* (_) {
      const batcher = yield* _(makeBatcher({ windowMs: 16 }))
      const subManager = yield* _(makeSubscriptionManager())
      const sync = yield* _(
        makeStateSync({ eventBufferSize: 100 }, batcher, subManager)
      )

      const userId = UserId("user-1")

      // Build structure:
      //   workspace-1
      //   ├─ folder-1
      //   │  ├─ tab-1
      //   │  └─ tab-2
      //   └─ folder-2
      //      └─ tab-3

      // Create entities
      yield* _(
        sync.publishEvent(userId, {
          type: "EntityCreated",
          entityId: EntityId("workspace-1"),
          entityType: "workspace",
          data: { name: "Work" },
        })
      )

      yield* _(
        sync.publishEvent(userId, {
          type: "EntityCreated",
          entityId: EntityId("folder-1"),
          entityType: "folder",
          data: { name: "Project A" },
        })
      )

      yield* _(
        sync.publishEvent(userId, {
          type: "EntityCreated",
          entityId: EntityId("folder-2"),
          entityType: "folder",
          data: { name: "Project B" },
        })
      )

      for (let i = 1; i <= 3; i++) {
        yield* _(
          sync.publishEvent(userId, {
            type: "EntityCreated",
            entityId: EntityId(`tab-${i}`),
            entityType: "tab",
            data: { url: `https://example.com/tab${i}` },
          })
        )
      }

      // Create edges
      const edges = [
        { from: "workspace-1", to: "folder-1" },
        { from: "workspace-1", to: "folder-2" },
        { from: "folder-1", to: "tab-1" },
        { from: "folder-1", to: "tab-2" },
        { from: "folder-2", to: "tab-3" },
      ]

      for (const { from, to } of edges) {
        yield* _(
          sync.publishEvent(userId, {
            type: "EdgeCreated",
            edgeId: makeEdgeId(EntityId(from), EntityId(to), "contains"),
            from: EntityId(from),
            to: EntityId(to),
            edgeType: "contains",
            data: {},
          })
        )
      }

      // Verify final state
      const state = yield* _(sync.getState)
      expect(state.entities.size).toBe(6) // 1 workspace + 2 folders + 3 tabs
      expect(state.edges.size).toBe(5)

      // Rebuild workspace index
      yield* _(subManager.rebuildIndex(state))
      const index = yield* _(subManager.getIndex)

      const workspaceEntities = index.get(WorkspaceId("workspace-1"))
      expect(workspaceEntities?.size).toBe(6) // All entities reachable from workspace

      yield* _(sync.shutdown)
    })

    await Effect.runPromise(program)
  })

  test("handles tab moving between folders atomically", async () => {
    const program = Effect.gen(function* (_) {
      const batcher = yield* _(makeBatcher({ windowMs: 16 }))
      const subManager = yield* _(makeSubscriptionManager())
      const sync = yield* _(
        makeStateSync({ eventBufferSize: 100 }, batcher, subManager)
      )

      const userId = UserId("user-1")

      // Create workspace with two folders and a tab
      yield* _(
        sync.publishEvent(userId, {
          type: "EntityCreated",
          entityId: EntityId("workspace-1"),
          entityType: "workspace",
          data: {},
        })
      )

      yield* _(
        sync.publishEvent(userId, {
          type: "EntityCreated",
          entityId: EntityId("folder-1"),
          entityType: "folder",
          data: { name: "Folder 1" },
        })
      )

      yield* _(
        sync.publishEvent(userId, {
          type: "EntityCreated",
          entityId: EntityId("folder-2"),
          entityType: "folder",
          data: { name: "Folder 2" },
        })
      )

      yield* _(
        sync.publishEvent(userId, {
          type: "EntityCreated",
          entityId: EntityId("tab-1"),
          entityType: "tab",
          data: { url: "https://example.com" },
        })
      )

      // Tab initially in folder-1
      yield* _(
        sync.publishEvent(userId, {
          type: "EdgeCreated",
          edgeId: makeEdgeId(EntityId("folder-1"), EntityId("tab-1"), "contains"),
          from: EntityId("folder-1"),
          to: EntityId("tab-1"),
          edgeType: "contains",
          data: { "list-index": 0 },
        })
      )

      // Move tab from folder-1 to folder-2 (transaction)
      yield* _(
        sync.publishEvent(userId, {
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
        })
      )

      const state = yield* _(sync.getState)

      // Verify tab is now only in folder-2
      const tab1Incoming = Array.from(state.edgesByTo.get(EntityId("tab-1")) || [])
        .map(edgeId => state.edges.get(edgeId))
        .filter(e => e !== undefined)

      expect(tab1Incoming.length).toBe(1)
      expect(tab1Incoming[0]?.from).toBe(EntityId("folder-2"))

      yield* _(sync.shutdown)
    })

    await Effect.runPromise(program)
  })

  test("simulates 1000 tabs being created and updated", async () => {
    const program = Effect.gen(function* (_) {
      const batcher = yield* _(makeBatcher({ windowMs: 16 }))
      const subManager = yield* _(makeSubscriptionManager())
      const sync = yield* _(
        makeStateSync({ eventBufferSize: 2000 }, batcher, subManager)
      )

      const userId = UserId("user-1")

      // Create 1000 tabs
      for (let i = 0; i < 1000; i++) {
        yield* _(
          sync.publishEvent(userId, {
            type: "EntityCreated",
            entityId: EntityId(`tab-${i}`),
            entityType: "tab",
            data: { url: `https://example.com/${i}`, title: `Tab ${i}` },
          })
        )
      }

      // Update every 10th tab
      for (let i = 0; i < 1000; i += 10) {
        yield* _(
          sync.publishEvent(userId, {
            type: "EntityUpdated",
            entityId: EntityId(`tab-${i}`),
            changes: { title: `Updated Tab ${i}` },
          })
        )
      }

      const state = yield* _(sync.getState)
      expect(state.entities.size).toBe(1000)

      // Verify some tabs were updated
      const tab0 = state.entities.get(EntityId("tab-0"))
      expect(tab0?.data.title).toBe("Updated Tab 0")

      const tab5 = state.entities.get(EntityId("tab-5"))
      expect(tab5?.data.title).toBe("Tab 5") // Not updated

      yield* _(sync.shutdown)
    })

    await Effect.runPromise(program)
  })
})

describe("Batching Integration", () => {
  test("batched browser updates are published through sync system", async () => {
    const program = Effect.gen(function* (_) {
      const batcher = yield* _(makeBatcher({ windowMs: 50 }))
      const subManager = yield* _(makeSubscriptionManager())
      const sync = yield* _(
        makeStateSync({ eventBufferSize: 100 }, batcher, subManager)
      )

      const subscription: Subscription = {
        userId: UserId("system"), // Batched events use system userId
        alwaysInclude: { entityTypes: ["tab"] },
        workspaces: new Set(),
      }

      const collectedEvents: EnvelopedEvent[] = []

      // Subscribe first
      const collectorFiber = yield* _(
        Effect.fork(
          Effect.scoped(
            Effect.gen(function* (_) {
              const eventStream = yield* _(sync.subscribe(subscription))
              yield* _(
                Stream.runForEach(
                  Stream.take(eventStream, 2), // 1 create + 1 batched update
                  event => Effect.sync(() => collectedEvents.push(event))
                )
              )
            })
          )
        )
      )

      yield* _(Effect.sleep(Duration.millis(10)))

      // Create tab
      yield* _(
        sync.publishEvent(UserId("system"), {
          type: "EntityCreated",
          entityId: EntityId("tab-1"),
          entityType: "tab",
          data: { url: "https://example.com" },
        })
      )

      // Schedule rapid updates via batcher
      yield* _(batcher.scheduleUpdate(EntityId("tab-1"), { title: "First" }))
      yield* _(batcher.scheduleUpdate(EntityId("tab-1"), { title: "Second" }))
      yield* _(batcher.scheduleUpdate(EntityId("tab-1"), { favicon: "icon.png" }))

      // Wait for batch window to flush
      yield* _(Effect.sleep(Duration.millis(100)))

      // Wait for collection
      yield* _(Fiber.join(collectorFiber))

      // Should have create event + batched update
      expect(collectedEvents.length).toBe(2)
      expect(collectedEvents[1].event.type).toBe("EntityUpdated")

      if (collectedEvents[1].event.type === "EntityUpdated") {
        expect(collectedEvents[1].event.changes.title).toBe("Second")
        expect(collectedEvents[1].event.changes.favicon).toBe("icon.png")
      }

      yield* _(sync.shutdown)
    })

    await Effect.runPromise(program)
  })
})
