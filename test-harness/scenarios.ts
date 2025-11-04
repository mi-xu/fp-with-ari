#!/usr/bin/env bun

/**
 * State Sync Test Harness - Integrated Scenarios
 *
 * Runs end-to-end tests with both server and client in the same process.
 * Tests correctness and performance of the syncing and batching mechanics.
 */

import { Effect, Console, Stream, Ref, Scope, Fiber } from "effect"
import {
  createDisposableStateSync,
  EntityId,
  UserId,
  WorkspaceId,
  EntityType,
  Event,
  Subscription,
  EnvelopedEvent,
} from "../src/state-sync/index"

// ============================================================================
// Shared Types
// ============================================================================

type TestResult = {
  name: string
  passed: boolean
  publishedCount: number
  receivedCount: number
  duration: number
  rate: number
  errors: string[]
}

// ============================================================================
// Scenario 1: Basic Correctness
// ============================================================================

/**
 * Test that all published events are received by subscribers
 */
const scenario1_BasicCorrectness = Effect.gen(function* () {
  yield* Console.log(`\n=== Scenario 1: Basic Correctness ===`)

  const { stateSync, dispose } = yield* Effect.promise(() => createDisposableStateSync())
  const userId = UserId("test-user")
  const workspaceId = WorkspaceId("workspace-1")

  const subscription: Subscription = {
    userId,
    alwaysInclude: { entityTypes: ["tab"] },
    workspaces: new Set([workspaceId]),
  }

  const receivedEvents: EnvelopedEvent[] = []
  const errors: string[] = []

  // Subscribe and collect events
  const collectEvents = Effect.gen(function* () {
    const stream = yield* stateSync.subscribe(subscription)
    yield* Stream.runForEach(stream, event =>
      Effect.sync(() => {
        receivedEvents.push(event)
      })
    )
  }).pipe(Effect.scoped, Effect.fork)

  const fiber = yield* collectEvents

  // Give subscription time to set up
  yield* Effect.sleep(100)

  // Publish events
  const eventCount = 100
  const startTime = Date.now()

  for (let i = 0; i < eventCount; i++) {
    const event: Event = {
      type: "EntityCreated",
      entityId: EntityId(`tab-${i}`),
      entityType: "tab" as EntityType,
      data: { url: `https://example.com/${i}`, title: `Tab ${i}`, workspaceId },
    }

    yield* stateSync.publishEvent(userId, event)
  }

  // Wait for events to propagate
  yield* Effect.sleep(500)

  const duration = Date.now() - startTime

  // Check results
  const passed = receivedEvents.length === eventCount

  if (!passed) {
    errors.push(`Expected ${eventCount} events, received ${receivedEvents.length}`)
  }

  // Check sequence numbers are correct
  const sequences = receivedEvents.map(e => e.sequenceNumber).sort((a, b) => a - b)
  for (let i = 0; i < sequences.length; i++) {
    if (sequences[i] !== i + 1) {
      errors.push(`Sequence number gap: expected ${i + 1}, got ${sequences[i]}`)
      break
    }
  }

  yield* Console.log(`Published: ${eventCount} events`)
  yield* Console.log(`Received: ${receivedEvents.length} events`)
  yield* Console.log(`Duration: ${duration}ms`)
  yield* Console.log(`Result: ${passed ? "PASS" : "FAIL"}`)

  if (errors.length > 0) {
    yield* Console.log(`Errors: ${errors.join(", ")}`)
  }

  // Cleanup
  yield* Fiber.interrupt(fiber)
  yield* Effect.promise(dispose)

  return {
    name: "Basic Correctness",
    passed,
    publishedCount: eventCount,
    receivedCount: receivedEvents.length,
    duration,
    rate: (eventCount / duration) * 1000,
    errors,
  } as TestResult
})

// ============================================================================
// Scenario 2: Workspace Isolation
// ============================================================================

/**
 * Test that clients only receive events for their subscribed workspaces
 *
 * Note: This test creates workspace entities and connects folders to them via edges.
 * Folders are NOT in alwaysInclude, so they are filtered by workspace membership.
 */
const scenario2_WorkspaceIsolation = Effect.gen(function* () {
  yield* Console.log(`\n=== Scenario 2: Workspace Isolation ===`)

  const { stateSync, dispose } = yield* Effect.promise(() => createDisposableStateSync())
  const userId = UserId("test-user")
  const workspace1 = WorkspaceId("workspace-1")
  const workspace2 = WorkspaceId("workspace-2")

  // First, create the workspace entities
  yield* stateSync.publishEvent(userId, {
    type: "EntityCreated",
    entityId: workspace1 as EntityId,
    entityType: "workspace" as EntityType,
    data: { name: "Workspace 1" },
  })

  yield* stateSync.publishEvent(userId, {
    type: "EntityCreated",
    entityId: workspace2 as EntityId,
    entityType: "workspace" as EntityType,
    data: { name: "Workspace 2" },
  })

  // Wait for workspace index to be built
  yield* Effect.sleep(100)

  // Client 1 subscribes to workspace-1 only (folders are NOT in alwaysInclude)
  const subscription1: Subscription = {
    userId,
    alwaysInclude: { entityTypes: [] }, // Empty - rely on workspace filtering
    workspaces: new Set([workspace1]),
  }

  // Client 2 subscribes to workspace-2 only
  const subscription2: Subscription = {
    userId,
    alwaysInclude: { entityTypes: [] }, // Empty - rely on workspace filtering
    workspaces: new Set([workspace2]),
  }

  const client1Events: EnvelopedEvent[] = []
  const client2Events: EnvelopedEvent[] = []
  const errors: string[] = []

  // Start both clients
  const client1Fiber = yield* Effect.gen(function* () {
    const stream = yield* stateSync.subscribe(subscription1)
    yield* Stream.runForEach(stream, event => Effect.sync(() => client1Events.push(event)))
  }).pipe(Effect.scoped, Effect.fork)

  const client2Fiber = yield* Effect.gen(function* () {
    const stream = yield* stateSync.subscribe(subscription2)
    yield* Stream.runForEach(stream, event => Effect.sync(() => client2Events.push(event)))
  }).pipe(Effect.scoped, Effect.fork)

  yield* Effect.sleep(100)

  // Publish folders connected to workspace-1 and workspace-2
  const startTime = Date.now()
  const foldersPerWorkspace = 25

  for (let i = 0; i < foldersPerWorkspace; i++) {
    const folderId = EntityId(`folder-w1-${i}`)
    yield* stateSync.publishEvent(userId, {
      type: "Transaction",
      operations: [
        {
          type: "EntityCreated",
          entityId: folderId,
          entityType: "folder" as EntityType,
          data: { name: `Folder ${i}` },
        },
        {
          type: "EdgeCreated",
          edgeId: EntityId(`${workspace1}:contains:${folderId}`),
          from: workspace1 as EntityId,
          to: folderId,
          edgeType: "belongs_to",
          data: {},
        },
      ],
    })
  }

  for (let i = 0; i < foldersPerWorkspace; i++) {
    const folderId = EntityId(`folder-w2-${i}`)
    yield* stateSync.publishEvent(userId, {
      type: "Transaction",
      operations: [
        {
          type: "EntityCreated",
          entityId: folderId,
          entityType: "folder" as EntityType,
          data: { name: `Folder ${i}` },
        },
        {
          type: "EdgeCreated",
          edgeId: EntityId(`${workspace2}:contains:${folderId}`),
          from: workspace2 as EntityId,
          to: folderId,
          edgeType: "belongs_to",
          data: {},
        },
      ],
    })
  }

  yield* Effect.sleep(500)
  const duration = Date.now() - startTime

  // Each client should receive only folders for their subscribed workspace
  // (workspace entities are not in alwaysInclude, so clients don't see them)
  const expectedPerClient = foldersPerWorkspace

  // Check results - each client should only see their workspace's folders
  const passed =
    client1Events.length === expectedPerClient && client2Events.length === expectedPerClient

  if (client1Events.length !== expectedPerClient) {
    errors.push(`Client 1 expected ${expectedPerClient} events, received ${client1Events.length}`)
  }

  if (client2Events.length !== expectedPerClient) {
    errors.push(`Client 2 expected ${expectedPerClient} events, received ${client2Events.length}`)
  }

  const totalPublished = 2 + foldersPerWorkspace * 2
  yield* Console.log(
    `Published: ${totalPublished} events (2 workspaces + ${foldersPerWorkspace} folders each)`
  )
  yield* Console.log(
    `Client 1 received: ${client1Events.length} events (expected ${expectedPerClient})`
  )
  yield* Console.log(
    `Client 2 received: ${client2Events.length} events (expected ${expectedPerClient})`
  )
  yield* Console.log(`Duration: ${duration}ms`)
  yield* Console.log(`Result: ${passed ? "PASS" : "FAIL"}`)

  if (errors.length > 0) {
    yield* Console.log(`Errors: ${errors.join(", ")}`)
  }

  // Cleanup
  yield* Fiber.interrupt(client1Fiber)
  yield* Fiber.interrupt(client2Fiber)
  yield* Effect.promise(dispose)

  return {
    name: "Workspace Isolation",
    passed,
    publishedCount: totalPublished,
    receivedCount: client1Events.length + client2Events.length,
    duration,
    rate: (totalPublished / duration) * 1000,
    errors,
  } as TestResult
})

// ============================================================================
// Scenario 3: High-Frequency Updates (Batching Performance)
// ============================================================================

/**
 * Test that rapid updates are properly batched and delivered
 */
const scenario3_HighFrequency = Effect.gen(function* () {
  yield* Console.log(`\n=== Scenario 3: High-Frequency Updates (Batching) ===`)

  const { stateSync, dispose } = yield* Effect.promise(() => createDisposableStateSync())
  const userId = UserId("test-user")
  const workspaceId = WorkspaceId("workspace-1")

  const subscription: Subscription = {
    userId,
    alwaysInclude: { entityTypes: ["tab"] },
    workspaces: new Set([workspaceId]),
  }

  const receivedEvents: EnvelopedEvent[] = []
  const errors: string[] = []

  const fiber = yield* Effect.gen(function* () {
    const stream = yield* stateSync.subscribe(subscription)
    yield* Stream.runForEach(stream, event => Effect.sync(() => receivedEvents.push(event)))
  }).pipe(Effect.scoped, Effect.fork)

  yield* Effect.sleep(100)

  // Publish rapid burst of updates
  const eventCount = 1000
  const startTime = Date.now()

  for (let i = 0; i < eventCount; i++) {
    yield* stateSync.publishEvent(userId, {
      type: "EntityCreated",
      entityId: EntityId(`tab-${i}`),
      entityType: "tab" as EntityType,
      data: { url: `https://example.com/${i}`, workspaceId },
    })
  }

  const publishDuration = Date.now() - startTime

  // Wait for all events to be received
  yield* Effect.sleep(1000)

  const totalDuration = Date.now() - startTime

  // Check results
  const passed = receivedEvents.length === eventCount

  if (!passed) {
    errors.push(`Expected ${eventCount} events, received ${receivedEvents.length}`)
  }

  const publishRate = (eventCount / publishDuration) * 1000
  const receiveRate = (receivedEvents.length / totalDuration) * 1000

  yield* Console.log(`Published: ${eventCount} events in ${publishDuration}ms`)
  yield* Console.log(`Publish rate: ${publishRate.toFixed(2)} events/sec`)
  yield* Console.log(`Received: ${receivedEvents.length} events in ${totalDuration}ms`)
  yield* Console.log(`Receive rate: ${receiveRate.toFixed(2)} events/sec`)
  yield* Console.log(`Result: ${passed ? "PASS" : "FAIL"}`)

  if (errors.length > 0) {
    yield* Console.log(`Errors: ${errors.join(", ")}`)
  }

  // Cleanup
  yield* Fiber.interrupt(fiber)
  yield* Effect.promise(dispose)

  return {
    name: "High-Frequency Updates",
    passed,
    publishedCount: eventCount,
    receivedCount: receivedEvents.length,
    duration: totalDuration,
    rate: receiveRate,
    errors,
  } as TestResult
})

// ============================================================================
// Scenario 4: Transaction Processing
// ============================================================================

/**
 * Test that transaction events are properly processed
 */
const scenario4_Transactions = Effect.gen(function* () {
  yield* Console.log(`\n=== Scenario 4: Transaction Processing ===`)

  const { stateSync, dispose } = yield* Effect.promise(() => createDisposableStateSync())
  const userId = UserId("test-user")
  const workspaceId = WorkspaceId("workspace-1")

  const subscription: Subscription = {
    userId,
    alwaysInclude: { entityTypes: ["window", "tab"] },
    workspaces: new Set([workspaceId]),
  }

  const receivedEvents: EnvelopedEvent[] = []
  const errors: string[] = []

  const fiber = yield* Effect.gen(function* () {
    const stream = yield* stateSync.subscribe(subscription)
    yield* Stream.runForEach(stream, event => Effect.sync(() => receivedEvents.push(event)))
  }).pipe(Effect.scoped, Effect.fork)

  yield* Effect.sleep(100)

  // Publish transactions (each creates window + 2 tabs + 2 edges)
  const transactionCount = 50
  const startTime = Date.now()

  for (let i = 0; i < transactionCount; i++) {
    const windowId = EntityId(`window-${i}`)
    const tab1Id = EntityId(`tab-${i}-1`)
    const tab2Id = EntityId(`tab-${i}-2`)

    yield* stateSync.publishEvent(userId, {
      type: "Transaction",
      operations: [
        {
          type: "EntityCreated",
          entityId: windowId,
          entityType: "window" as EntityType,
          data: { title: `Window ${i}`, workspaceId },
        },
        {
          type: "EntityCreated",
          entityId: tab1Id,
          entityType: "tab" as EntityType,
          data: { url: "https://example.com/1", workspaceId },
        },
        {
          type: "EntityCreated",
          entityId: tab2Id,
          entityType: "tab" as EntityType,
          data: { url: "https://example.com/2", workspaceId },
        },
        {
          type: "EdgeCreated",
          edgeId: EntityId(`${windowId}:contains:${tab1Id}`),
          from: windowId,
          to: tab1Id,
          edgeType: "contains",
          data: { index: 0 },
        },
        {
          type: "EdgeCreated",
          edgeId: EntityId(`${windowId}:contains:${tab2Id}`),
          from: windowId,
          to: tab2Id,
          edgeType: "contains",
          data: { index: 1 },
        },
      ],
    })
  }

  yield* Effect.sleep(500)
  const duration = Date.now() - startTime

  // Check results - should receive exactly transactionCount events (transactions are single events)
  const passed = receivedEvents.length === transactionCount

  if (!passed) {
    errors.push(`Expected ${transactionCount} events, received ${receivedEvents.length}`)
  }

  // Verify state has all entities
  const state = yield* stateSync.getState
  const expectedEntities = transactionCount * 3 // window + 2 tabs per transaction
  const actualEntities = state.entities.size

  if (actualEntities !== expectedEntities) {
    errors.push(`Expected ${expectedEntities} entities in state, found ${actualEntities}`)
  }

  yield* Console.log(`Published: ${transactionCount} transactions`)
  yield* Console.log(`Received: ${receivedEvents.length} events`)
  yield* Console.log(`State entities: ${actualEntities} (expected ${expectedEntities})`)
  yield* Console.log(`Duration: ${duration}ms`)
  yield* Console.log(`Result: ${passed ? "PASS" : "FAIL"}`)

  if (errors.length > 0) {
    yield* Console.log(`Errors: ${errors.join(", ")}`)
  }

  // Cleanup
  yield* Fiber.interrupt(fiber)
  yield* Effect.promise(dispose)

  return {
    name: "Transaction Processing",
    passed,
    publishedCount: transactionCount,
    receivedCount: receivedEvents.length,
    duration,
    rate: (transactionCount / duration) * 1000,
    errors,
  } as TestResult
})

// ============================================================================
// Main Test Runner
// ============================================================================

const main = Effect.gen(function* () {
  yield* Console.log(`\n╔════════════════════════════════════════════╗`)
  yield* Console.log(`║   State Sync Test Harness - Scenarios     ║`)
  yield* Console.log(`╚════════════════════════════════════════════╝`)

  const results: TestResult[] = []

  // Run all scenarios
  results.push(yield* scenario1_BasicCorrectness)
  results.push(yield* scenario2_WorkspaceIsolation)
  results.push(yield* scenario3_HighFrequency)
  results.push(yield* scenario4_Transactions)

  // Print summary
  yield* Console.log(`\n\n╔════════════════════════════════════════════╗`)
  yield* Console.log(`║              Test Summary                  ║`)
  yield* Console.log(`╚════════════════════════════════════════════╝\n`)

  for (const result of results) {
    const status = result.passed ? "✓ PASS" : "✗ FAIL"
    yield* Console.log(`${status} - ${result.name}`)
    yield* Console.log(
      `       Published: ${result.publishedCount}, Received: ${result.receivedCount}, Rate: ${result.rate.toFixed(2)} events/sec`
    )
    if (result.errors.length > 0) {
      yield* Console.log(`       Errors: ${result.errors.join(", ")}`)
    }
  }

  const passCount = results.filter(r => r.passed).length
  const totalCount = results.length

  yield* Console.log(`\nOverall: ${passCount}/${totalCount} scenarios passed`)

  if (passCount === totalCount) {
    yield* Console.log(`\n🎉 All tests passed!`)
  } else {
    yield* Console.log(`\n❌ Some tests failed`)
  }
})

// Run the test suite
Effect.runPromise(main).catch(error => {
  console.error("Fatal error:", error)
  process.exit(1)
})
