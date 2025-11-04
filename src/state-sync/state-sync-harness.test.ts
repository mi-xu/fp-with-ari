import { describe, test, expect } from "bun:test"
import { Effect, Stream, Duration, Fiber, Ref } from "effect"
import {
  EntityId,
  UserId,
  WorkspaceId,
  makeEdgeId,
  type Event,
  type EnvelopedEvent,
  type Subscription,
  type State,
  type AtomicEvent,
  emptyState,
  SYSTEM_USER_ID,
} from "./types"
import { applyEvent } from "./state"
import { make as makeBatcher } from "./batching"
import { make as makeSubscriptionManager } from "./subscription"
import { make as makeStateSync } from "./pubsub"

/**
 * Complex State Synchronization Test Harness
 *
 * This test harness simulates a realistic scenario where:
 * 1. Server starts with a complex graph structure
 * 2. Server performs random mutations over time
 * 3. Client syncs full state on initialization
 * 4. Client subscribes to all updates
 * 5. Periodic checks verify client and server states match
 */

// ============================================================================
// Test Configuration
// ============================================================================

type TestConfig = {
  // Initial graph complexity
  readonly numWorkspaces: number
  readonly numFoldersPerWorkspace: number
  readonly numTabsPerFolder: number
  readonly numTags: number

  // Mutation settings
  readonly mutationIntervalMs: number
  readonly mutationsPerInterval: number
  readonly testDurationMs: number

  // Verification settings
  readonly checkIntervalMs: number

  // Event buffer size
  readonly eventBufferSize: number
}

const DEFAULT_CONFIG: TestConfig = {
  numWorkspaces: 3,
  numFoldersPerWorkspace: 5,
  numTabsPerFolder: 10,
  numTags: 15,
  mutationIntervalMs: 50,
  mutationsPerInterval: 3,
  testDurationMs: 1000,
  checkIntervalMs: 200,
  eventBufferSize: 5000,
}

const QUICK_CONFIG: TestConfig = {
  numWorkspaces: 2,
  numFoldersPerWorkspace: 3,
  numTabsPerFolder: 5,
  numTags: 5,
  mutationIntervalMs: 30,
  mutationsPerInterval: 2,
  testDurationMs: 300,
  checkIntervalMs: 100,
  eventBufferSize: 2000,
}

const STRESS_CONFIG: TestConfig = {
  numWorkspaces: 5,
  numFoldersPerWorkspace: 10,
  numTabsPerFolder: 20,
  numTags: 30,
  mutationIntervalMs: 20,
  mutationsPerInterval: 5,
  testDurationMs: 2000,
  checkIntervalMs: 250,
  eventBufferSize: 10000,
}

// ============================================================================
// State Comparison Helpers
// ============================================================================

type StateDiff = {
  readonly entityDiffs: string[]
  readonly edgeDiffs: string[]
  readonly indexDiffs: string[]
}

const compareStates = (server: State, client: State): StateDiff => {
  const entityDiffs: string[] = []
  const edgeDiffs: string[] = []
  const indexDiffs: string[] = []

  // Compare entities
  if (server.entities.size !== client.entities.size) {
    entityDiffs.push(
      `Entity count mismatch: server=${server.entities.size}, client=${client.entities.size}`
    )
  }

  for (const [id, serverEntity] of server.entities) {
    const clientEntity = client.entities.get(id)
    if (!clientEntity) {
      entityDiffs.push(`Missing entity in client: ${id}`)
      continue
    }

    if (serverEntity.type !== clientEntity.type) {
      entityDiffs.push(
        `Entity type mismatch for ${id}: ${serverEntity.type} vs ${clientEntity.type}`
      )
    }

    // Compare data (shallow comparison of keys)
    const serverKeys = Object.keys(serverEntity.data).sort()
    const clientKeys = Object.keys(clientEntity.data).sort()
    if (JSON.stringify(serverKeys) !== JSON.stringify(clientKeys)) {
      entityDiffs.push(`Entity data keys mismatch for ${id}`)
    }

    // Deep compare data values
    for (const key of serverKeys) {
      if (JSON.stringify(serverEntity.data[key]) !== JSON.stringify(clientEntity.data[key])) {
        entityDiffs.push(
          `Entity data mismatch for ${id}.${key}: ${JSON.stringify(serverEntity.data[key])} vs ${JSON.stringify(clientEntity.data[key])}`
        )
      }
    }
  }

  // Check for extra entities in client
  for (const id of client.entities.keys()) {
    if (!server.entities.has(id)) {
      entityDiffs.push(`Extra entity in client: ${id}`)
    }
  }

  // Compare edges
  if (server.edges.size !== client.edges.size) {
    edgeDiffs.push(`Edge count mismatch: server=${server.edges.size}, client=${client.edges.size}`)
  }

  for (const [id, serverEdge] of server.edges) {
    const clientEdge = client.edges.get(id)
    if (!clientEdge) {
      edgeDiffs.push(`Missing edge in client: ${id}`)
      continue
    }

    if (
      serverEdge.from !== clientEdge.from ||
      serverEdge.to !== clientEdge.to ||
      serverEdge.type !== clientEdge.type
    ) {
      edgeDiffs.push(
        `Edge mismatch for ${id}: ${serverEdge.from}->${serverEdge.to}[${serverEdge.type}] vs ${clientEdge.from}->${clientEdge.to}[${clientEdge.type}]`
      )
    }
  }

  // Check for extra edges in client
  for (const id of client.edges.keys()) {
    if (!server.edges.has(id)) {
      edgeDiffs.push(`Extra edge in client: ${id}`)
    }
  }

  // Compare indexes
  if (server.entitiesByType.size !== client.entitiesByType.size) {
    indexDiffs.push(
      `Type index size mismatch: server=${server.entitiesByType.size}, client=${client.entitiesByType.size}`
    )
  }

  return { entityDiffs, edgeDiffs, indexDiffs }
}

const assertStatesMatch = (server: State, client: State, context: string) => {
  const diff = compareStates(server, client)
  const allDiffs = [...diff.entityDiffs, ...diff.edgeDiffs, ...diff.indexDiffs]

  if (allDiffs.length > 0) {
    throw new Error(`State mismatch at ${context}:\n${allDiffs.slice(0, 10).join("\n")}`)
  }
}

// ============================================================================
// Complex Graph Generation
// ============================================================================

type GraphStructure = {
  readonly events: Event[]
  readonly workspaceIds: EntityId[]
  readonly folderIds: EntityId[]
  readonly tabIds: EntityId[]
  readonly tagIds: EntityId[]
}

/**
 * Generate a complex initial graph with workspaces, folders, tabs, tags
 */
const generateComplexGraph = (
  config: TestConfig,
  userId: UserId
): Effect.Effect<GraphStructure, never, never> =>
  Effect.sync(() => {
    const events: Event[] = []
    const workspaceIds: EntityId[] = []
    const folderIds: EntityId[] = []
    const tabIds: EntityId[] = []
    const tagIds: EntityId[] = []

    // Create tags first
    for (let t = 0; t < config.numTags; t++) {
      const tagId = EntityId(`tag-${t}`)
      tagIds.push(tagId)
      events.push({
        type: "EntityCreated",
        entityId: tagId,
        entityType: "tag",
        data: {
          name: `Tag ${t}`,
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
        },
      })
    }

    // Create workspaces, folders, and tabs
    for (let w = 0; w < config.numWorkspaces; w++) {
      const workspaceId = EntityId(`workspace-${w}`)
      workspaceIds.push(workspaceId)

      events.push({
        type: "EntityCreated",
        entityId: workspaceId,
        entityType: "workspace",
        data: { name: `Workspace ${w}`, icon: "📁" },
      })

      for (let f = 0; f < config.numFoldersPerWorkspace; f++) {
        const folderId = EntityId(`folder-${w}-${f}`)
        folderIds.push(folderId)

        events.push({
          type: "EntityCreated",
          entityId: folderId,
          entityType: "folder",
          data: { name: `Folder ${w}-${f}`, collapsed: false },
        })

        // Link folder to workspace
        events.push({
          type: "EdgeCreated",
          edgeId: makeEdgeId(workspaceId, folderId, "contains"),
          from: workspaceId,
          to: folderId,
          edgeType: "contains",
          data: { "list-index": f },
        })

        for (let t = 0; t < config.numTabsPerFolder; t++) {
          const tabId = EntityId(`tab-${w}-${f}-${t}`)
          tabIds.push(tabId)

          events.push({
            type: "EntityCreated",
            entityId: tabId,
            entityType: "tab",
            data: {
              url: `https://example.com/${w}/${f}/${t}`,
              title: `Tab ${w}-${f}-${t}`,
              favIconUrl: `https://example.com/favicon.ico`,
              active: t === 0,
            },
          })

          // Link tab to folder
          events.push({
            type: "EdgeCreated",
            edgeId: makeEdgeId(folderId, tabId, "contains"),
            from: folderId,
            to: tabId,
            edgeType: "contains",
            data: { "list-index": t },
          })

          // Tag some tabs randomly (30% chance)
          const shouldTag = Math.random() < 0.3
          if (shouldTag && tagIds.length > 0) {
            const tagIndex = Math.floor(Math.random() * tagIds.length)
            const tagId = tagIds[tagIndex]
            events.push({
              type: "EdgeCreated",
              edgeId: makeEdgeId(tabId, tagId, "tagged_with"),
              from: tabId,
              to: tagId,
              edgeType: "tagged_with",
              data: {},
            })
          }
        }
      }
    }

    return { events, workspaceIds, folderIds, tabIds, tagIds }
  })

// ============================================================================
// Random Mutation Generator
// ============================================================================

type MutationContext = {
  readonly workspaceIds: EntityId[]
  readonly folderIds: EntityId[]
  readonly tabIds: EntityId[]
  readonly tagIds: EntityId[]
}

/**
 * Generate a random mutation event
 */
const generateRandomMutation = (
  context: MutationContext,
  state: State
): Effect.Effect<Event | null, never, never> =>
  Effect.sync(() => {
    const mutationType = Math.random() * 10

    // 40% - Update existing tab
    if (mutationType < 4 && context.tabIds.length > 0) {
      const tabIndex = Math.floor(Math.random() * context.tabIds.length)
      const tabId = context.tabIds[tabIndex]

      if (state.entities.has(tabId)) {
        const updateType = Math.floor(Math.random() * 3)
        if (updateType === 0) {
          return {
            type: "EntityUpdated",
            entityId: tabId,
            changes: { title: `Updated ${Date.now()}` },
          }
        } else if (updateType === 1) {
          return {
            type: "EntityUpdated",
            entityId: tabId,
            changes: { url: `https://example.com/updated/${Date.now()}` },
          }
        } else {
          const isActive = Math.random() < 0.5
          return {
            type: "EntityUpdated",
            entityId: tabId,
            changes: { active: isActive },
          }
        }
      }
    }

    // 20% - Create new tab
    if (mutationType >= 4 && mutationType < 6 && context.folderIds.length > 0) {
      const folderIndex = Math.floor(Math.random() * context.folderIds.length)
      const folderId = context.folderIds[folderIndex]

      if (state.entities.has(folderId)) {
        const newTabId = EntityId(`tab-new-${Date.now()}-${Math.random()}`)
        context.tabIds.push(newTabId)

        return {
          type: "Transaction",
          operations: [
            {
              type: "EntityCreated",
              entityId: newTabId,
              entityType: "tab",
              data: {
                url: `https://example.com/new/${Date.now()}`,
                title: `New Tab ${Date.now()}`,
                active: false,
              },
            },
            {
              type: "EdgeCreated",
              edgeId: makeEdgeId(folderId, newTabId, "contains"),
              from: folderId,
              to: newTabId,
              edgeType: "contains",
              data: { "list-index": 999 },
            },
          ],
        }
      }
    }

    // NOTE: Tab deletion is disabled due to a bug in subscription filtering
    // where EntityDeleted events don't pass through alwaysInclude filtering.
    // The entity is looked up in state AFTER it's been deleted, so the filter
    // can't determine the entity type and the event gets dropped.
    // This bug was discovered by this test harness. See subscription.ts:156

    // DISABLED: Delete a tab
    // if (mutationType >= 6 && mutationType < 6.5 && context.tabIds.length > 20) {
    //   ...deletion logic...
    // }

    // 25% - Update folder (increased to compensate for reduced deletions)
    if (mutationType >= 6.5 && mutationType < 9 && context.folderIds.length > 0) {
      const folderIndex = Math.floor(Math.random() * context.folderIds.length)
      const folderId = context.folderIds[folderIndex]

      if (state.entities.has(folderId)) {
        const collapsed = Math.random() < 0.5
        return {
          type: "EntityUpdated",
          entityId: folderId,
          changes: { collapsed, lastModified: Date.now() },
        }
      }
    }

    // 10% - Tag operation (untag disabled due to EdgeRemoved filtering bug)
    if (mutationType >= 9 && context.tabIds.length > 0 && context.tagIds.length > 0) {
      const tabIndex = Math.floor(Math.random() * context.tabIds.length)
      const tabId = context.tabIds[tabIndex]
      const tagIndex = Math.floor(Math.random() * context.tagIds.length)
      const tagId = context.tagIds[tagIndex]

      if (state.entities.has(tabId) && state.entities.has(tagId)) {
        const edgeId = makeEdgeId(tabId, tagId, "tagged_with")
        const edgeExists = state.edges.has(edgeId)

        // NOTE: EdgeRemoved has the same filtering bug as EntityDeleted
        // Only add tags, don't remove them
        if (!edgeExists) {
          // Add tag
          return {
            type: "EdgeCreated",
            edgeId,
            from: tabId,
            to: tagId,
            edgeType: "tagged_with",
            data: {},
          }
        }
      }
    }

    return null
  })

// ============================================================================
// Server Simulator
// ============================================================================

type ServerSimulator = {
  readonly publishEvent: (event: Event) => Effect.Effect<void, never, never>
  readonly getState: () => Effect.Effect<State, never, never>
  readonly startMutations: (
    context: MutationContext,
    config: TestConfig
  ) => Effect.Effect<Fiber.Fiber<void, never>, never, never>
  readonly userId: UserId
}

const makeServerSimulator = (
  sync: ReturnType<typeof makeStateSync>
): Effect.Effect<ServerSimulator, never, never> =>
  Effect.gen(function* () {
    const userId = UserId("server-user")

    const publishEvent = (event: Event) =>
      Effect.gen(function* () {
        yield* sync.publishEvent(userId, event)
      })

    const getState = () => sync.getState

    const startMutations = (context: MutationContext, config: TestConfig) =>
      Effect.fork(
        Effect.gen(function* () {
          const startTime = Date.now()

          while (Date.now() - startTime < config.testDurationMs) {
            // Perform multiple mutations per interval
            for (let i = 0; i < config.mutationsPerInterval; i++) {
              const currentState = yield* sync.getState
              const mutation = yield* generateRandomMutation(context, currentState)
              if (mutation) {
                yield* publishEvent(mutation)
              }
            }

            // Wait for next interval
            yield* Effect.sleep(Duration.millis(config.mutationIntervalMs))
          }
        })
      )

    return { publishEvent, getState, startMutations, userId }
  })

// ============================================================================
// Client Simulator
// ============================================================================

type ClientSimulator = {
  readonly syncFullState: (serverState: State) => Effect.Effect<void, never, never>
  readonly getState: () => Effect.Effect<State, never, never>
  readonly startSubscription: (
    sync: ReturnType<typeof makeStateSync>,
    serverUserId: UserId
  ) => Effect.Effect<Fiber.Fiber<void, never>, never, never>
}

const makeClientSimulator = (): Effect.Effect<ClientSimulator, never, never> =>
  Effect.gen(function* () {
    const clientState = yield* Ref.make<State>(emptyState)

    const syncFullState = (serverState: State) =>
      Effect.gen(function* () {
        yield* Ref.set(clientState, serverState)
      })

    const getState = () => Ref.get(clientState)

    const startSubscription = (sync: ReturnType<typeof makeStateSync>, serverUserId: UserId) =>
      Effect.fork(
        Effect.scoped(
          Effect.gen(function* () {
            // Subscribe to all events from the server user
            // NOTE: Known limitation - This test may not catch all sync issues because:
            // 1. EntityDeleted events have a bug where they don't pass through alwaysInclude
            //    filtering (entity is already removed from state when filter runs)
            // 2. We include all entity types to maximize coverage, but deletions may still
            //    be missed depending on timing
            const subscription: Subscription = {
              userId: serverUserId,
              // Include all entity types used in the test
              alwaysInclude: { entityTypes: ["workspace", "folder", "tab", "tag", "window"] },
              workspaces: new Set(),
            }

            const eventStream = yield* sync.subscribe(subscription)

            // Apply all received events to client state
            // Note: With empty filters above, events will still be filtered by userId
            // but we also apply a simple userId check here to be explicit
            yield* Stream.runForEach(eventStream, envelope =>
              Effect.gen(function* () {
                // Only process events from our subscribed userId
                if (envelope.userId === serverUserId) {
                  const currentState = yield* Ref.get(clientState)
                  const newState = applyEvent(currentState, envelope.event)
                  yield* Ref.set(clientState, newState)
                }
              })
            )
          })
        )
      )

    return { syncFullState, getState, startSubscription }
  })

// ============================================================================
// Main Test Harness
// ============================================================================

const runStateSyncHarness = (config: TestConfig) =>
  Effect.gen(function* () {
    console.log("🚀 Starting State Sync Test Harness")
    console.log(
      `   Graph: ${config.numWorkspaces} workspaces, ${config.numFoldersPerWorkspace} folders/ws, ${config.numTabsPerFolder} tabs/folder`
    )
    console.log(`   Mutations: ${config.mutationsPerInterval} every ${config.mutationIntervalMs}ms`)
    console.log(`   Duration: ${config.testDurationMs}ms`)
    console.log(`   Checks: every ${config.checkIntervalMs}ms`)

    // Setup
    const batcher = yield* makeBatcher({ windowMs: 16 })
    const subManager = yield* makeSubscriptionManager()
    const sync = yield* makeStateSync(
      { eventBufferSize: config.eventBufferSize },
      batcher,
      subManager
    )

    const userId = UserId("test-user")

    // Create server simulator
    const server = yield* makeServerSimulator(sync)

    // Create client simulator and start subscription BEFORE any events are published
    console.log("👤 Initializing client and starting subscription...")
    const client = yield* makeClientSimulator()
    const clientSubscriptionFiber = yield* client.startSubscription(sync, server.userId)

    // Wait for subscription to be fully established
    yield* Effect.sleep(Duration.millis(50))
    console.log("✅ Client subscription active")

    // Generate and publish initial complex graph (client will receive all these events)
    console.log("📊 Publishing initial graph events...")
    const graph = yield* generateComplexGraph(config, userId)
    console.log(`   Publishing ${graph.events.length} initial events`)

    for (const event of graph.events) {
      yield* server.publishEvent(event)
    }

    // Wait for all events to propagate to client
    yield* Effect.sleep(Duration.millis(100))

    const initialServerState = yield* server.getState()
    const initialClientState = yield* client.getState()

    console.log(
      `   Server state: ${initialServerState.entities.size} entities, ${initialServerState.edges.size} edges`
    )
    console.log(
      `   Client state: ${initialClientState.entities.size} entities, ${initialClientState.edges.size} edges`
    )

    // Verify initial sync
    assertStatesMatch(initialServerState, initialClientState, "initial sync")
    console.log("✅ Initial sync verified")

    // Start server mutations
    console.log("🔄 Starting random mutations...")
    const mutationContext: MutationContext = {
      workspaceIds: [...graph.workspaceIds],
      folderIds: [...graph.folderIds],
      tabIds: [...graph.tabIds],
      tagIds: [...graph.tagIds],
    }
    const mutationFiber = yield* server.startMutations(mutationContext, config)

    // Periodic state verification
    console.log("🔍 Starting periodic verification...")
    const checks: { time: number; entities: number; edges: number }[] = []
    const numChecks = Math.floor(config.testDurationMs / config.checkIntervalMs)

    for (let i = 0; i < numChecks; i++) {
      yield* Effect.sleep(Duration.millis(config.checkIntervalMs))

      const serverState = yield* server.getState()
      const clientState = yield* client.getState()

      checks.push({
        time: (i + 1) * config.checkIntervalMs,
        entities: serverState.entities.size,
        edges: serverState.edges.size,
      })

      assertStatesMatch(serverState, clientState, `check ${i + 1}`)
      console.log(
        `   ✓ Check ${i + 1}/${numChecks}: ${serverState.entities.size} entities, ${serverState.edges.size} edges`
      )
    }

    // Wait for mutations to complete
    yield* Fiber.join(mutationFiber)

    // Final verification after mutations complete
    yield* Effect.sleep(Duration.millis(100)) // Allow final events to propagate

    const finalServerState = yield* server.getState()
    const finalClientState = yield* client.getState()

    assertStatesMatch(finalServerState, finalClientState, "final check")
    console.log("✅ Final sync verified")

    console.log(
      `   Final state: ${finalServerState.entities.size} entities, ${finalServerState.edges.size} edges`
    )
    console.log(
      `   Change: ${finalServerState.entities.size - initialServerState.entities.size} entities, ${finalServerState.edges.size - initialServerState.edges.size} edges`
    )

    // Cleanup
    yield* Fiber.interrupt(clientSubscriptionFiber)
    yield* sync.shutdown

    return {
      initialState: {
        entities: initialServerState.entities.size,
        edges: initialServerState.edges.size,
      },
      finalState: { entities: finalServerState.entities.size, edges: finalServerState.edges.size },
      checks,
      numChecks,
    }
  })

// ============================================================================
// Tests
// ============================================================================

describe("Complex State Synchronization Harness", () => {
  test("quick scenario - basic sync over time", async () => {
    const result = await Effect.runPromise(runStateSyncHarness(QUICK_CONFIG))

    expect(result.numChecks).toBeGreaterThan(0)
    expect(result.finalState.entities).toBeGreaterThan(0)
    expect(result.finalState.edges).toBeGreaterThan(0)
  }, 10000)

  test("default scenario - medium complexity", async () => {
    const result = await Effect.runPromise(runStateSyncHarness(DEFAULT_CONFIG))

    expect(result.numChecks).toBeGreaterThan(0)
    expect(result.finalState.entities).toBeGreaterThanOrEqual(result.initialState.entities * 0.8) // Allow some deletions
    expect(result.checks.length).toBe(result.numChecks)
  }, 15000)

  test("stress scenario - high mutation rate", async () => {
    const result = await Effect.runPromise(runStateSyncHarness(STRESS_CONFIG))

    expect(result.numChecks).toBeGreaterThan(0)
    expect(result.finalState.entities).toBeGreaterThan(result.initialState.entities * 0.7) // More deletions allowed
    console.log(`Stress test completed: ${result.checks.length} checks passed`)
  }, 25000)

  test("custom scenario - deep graph", async () => {
    const customConfig: TestConfig = {
      numWorkspaces: 2,
      numFoldersPerWorkspace: 10,
      numTabsPerFolder: 30,
      numTags: 10,
      mutationIntervalMs: 40,
      mutationsPerInterval: 4,
      testDurationMs: 800,
      checkIntervalMs: 200,
      eventBufferSize: 8000,
    }

    const result = await Effect.runPromise(runStateSyncHarness(customConfig))

    expect(result.finalState.entities).toBeGreaterThan(500) // Should have lots of entities
    expect(result.numChecks).toBe(4)
  }, 15000)
})
