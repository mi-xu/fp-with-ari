#!/usr/bin/env bun

/**
 * State Sync Test Harness - Server
 *
 * Sets up a StateSync system and publishes events for testing.
 * This simulates a server managing state for multiple clients.
 */

import { Effect, Console, Schedule } from "effect"
import {
  createDisposableStateSync,
  EntityId,
  UserId,
  WorkspaceId,
  EntityType,
  Event,
} from "../src/state-sync/index"

// ============================================================================
// Configuration
// ============================================================================

type ServerConfig = {
  duration: number // Duration to run (ms), 0 = indefinite
  eventRate: number // Events per second
  scenario: "basic" | "rapid-fire" | "burst" | "workspace-isolation"
}

const config: ServerConfig = {
  duration: 30000, // 30 seconds
  eventRate: 10, // 10 events/sec
  scenario: "basic",
}

// Parse command line arguments
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--duration":
      config.duration = parseInt(args[++i] || "30000", 10)
      break
    case "--rate":
      config.eventRate = parseInt(args[++i] || "10", 10)
      break
    case "--scenario":
      config.scenario = (args[++i] || "basic") as ServerConfig["scenario"]
      break
  }
}

// ============================================================================
// Event Generators
// ============================================================================

let eventCounter = 0

/**
 * Generate a simple entity creation event
 */
const generateTabCreatedEvent = (workspaceId: WorkspaceId): Event => {
  const tabId = EntityId(`tab-${++eventCounter}`)
  return {
    type: "EntityCreated",
    entityId: tabId,
    entityType: "tab" as EntityType,
    data: {
      url: `https://example.com/page-${eventCounter}`,
      title: `Page ${eventCounter}`,
      workspaceId,
    },
  }
}

/**
 * Generate a transaction with multiple operations
 */
const generateWindowWithTabsEvent = (workspaceId: WorkspaceId): Event => {
  const windowId = EntityId(`window-${++eventCounter}`)
  const tab1Id = EntityId(`tab-${++eventCounter}`)
  const tab2Id = EntityId(`tab-${++eventCounter}`)

  return {
    type: "Transaction",
    operations: [
      {
        type: "EntityCreated",
        entityId: windowId,
        entityType: "window" as EntityType,
        data: { title: `Window ${eventCounter}`, workspaceId },
      },
      {
        type: "EntityCreated",
        entityId: tab1Id,
        entityType: "tab" as EntityType,
        data: { url: "https://example.com/1", title: "Tab 1", workspaceId },
      },
      {
        type: "EntityCreated",
        entityId: tab2Id,
        entityType: "tab" as EntityType,
        data: { url: "https://example.com/2", title: "Tab 2", workspaceId },
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
  }
}

/**
 * Generate an entity update event
 */
const generateTabUpdateEvent = (tabId: EntityId): Event => {
  return {
    type: "EntityUpdated",
    entityId: tabId,
    changes: {
      title: `Updated Page ${eventCounter++}`,
      updatedAt: new Date().toISOString(),
    },
  }
}

// ============================================================================
// Scenarios
// ============================================================================

/**
 * Basic scenario: Create tabs at steady rate
 */
const basicScenario = (userId: UserId, workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    const { stateSync } = yield* Effect.promise(() => createDisposableStateSync())

    yield* Console.log(`[Server] Starting basic scenario`)
    yield* Console.log(`[Server] Rate: ${config.eventRate} events/sec`)
    yield* Console.log(`[Server] Duration: ${config.duration}ms`)

    const delayMs = 1000 / config.eventRate
    const startTime = Date.now()
    let publishedCount = 0

    // Publish events at configured rate
    const publishLoop = Effect.gen(function* () {
      while (config.duration === 0 || Date.now() - startTime < config.duration) {
        const event = generateTabCreatedEvent(workspaceId)
        yield* stateSync.publishEvent(userId, event)
        publishedCount++

        if (publishedCount % 100 === 0) {
          yield* Console.log(`[Server] Published ${publishedCount} events`)
        }

        yield* Effect.sleep(delayMs)
      }
    })

    yield* publishLoop

    const elapsed = Date.now() - startTime
    yield* Console.log(`[Server] Completed: ${publishedCount} events in ${elapsed}ms`)
    yield* Console.log(
      `[Server] Effective rate: ${((publishedCount / elapsed) * 1000).toFixed(2)} events/sec`
    )

    return { publishedCount, elapsed }
  })

/**
 * Rapid-fire scenario: Burst of events without delays
 */
const rapidFireScenario = (userId: UserId, workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    const { stateSync } = yield* Effect.promise(() => createDisposableStateSync())

    yield* Console.log(`[Server] Starting rapid-fire scenario`)
    yield* Console.log(`[Server] Target: ${config.eventRate} events as fast as possible`)

    const startTime = Date.now()
    let publishedCount = 0
    const targetCount = config.eventRate

    // Publish events as fast as possible
    for (let i = 0; i < targetCount; i++) {
      const event = generateWindowWithTabsEvent(workspaceId)
      yield* stateSync.publishEvent(userId, event)
      publishedCount++

      if (publishedCount % 100 === 0) {
        yield* Console.log(`[Server] Published ${publishedCount} events`)
      }
    }

    const elapsed = Date.now() - startTime
    yield* Console.log(`[Server] Completed: ${publishedCount} events in ${elapsed}ms`)
    yield* Console.log(
      `[Server] Effective rate: ${((publishedCount / elapsed) * 1000).toFixed(2)} events/sec`
    )

    return { publishedCount, elapsed }
  })

/**
 * Burst scenario: Alternating bursts and quiet periods
 */
const burstScenario = (userId: UserId, workspaceId: WorkspaceId) =>
  Effect.gen(function* () {
    const { stateSync } = yield* Effect.promise(() => createDisposableStateSync())

    yield* Console.log(`[Server] Starting burst scenario`)
    yield* Console.log(`[Server] Pattern: 100 events, 1s pause, repeat`)

    const startTime = Date.now()
    let publishedCount = 0
    const burstSize = 100
    const pauseMs = 1000

    while (config.duration === 0 || Date.now() - startTime < config.duration) {
      // Burst
      for (let i = 0; i < burstSize; i++) {
        const event = generateTabCreatedEvent(workspaceId)
        yield* stateSync.publishEvent(userId, event)
        publishedCount++
      }

      yield* Console.log(`[Server] Burst complete: ${publishedCount} total events`)

      // Pause
      if (config.duration === 0 || Date.now() - startTime + pauseMs < config.duration) {
        yield* Effect.sleep(pauseMs)
      } else {
        break
      }
    }

    const elapsed = Date.now() - startTime
    yield* Console.log(`[Server] Completed: ${publishedCount} events in ${elapsed}ms`)
    yield* Console.log(
      `[Server] Effective rate: ${((publishedCount / elapsed) * 1000).toFixed(2)} events/sec`
    )

    return { publishedCount, elapsed }
  })

/**
 * Workspace isolation scenario: Events in different workspaces
 */
const workspaceIsolationScenario = (userId: UserId) =>
  Effect.gen(function* () {
    const { stateSync } = yield* Effect.promise(() => createDisposableStateSync())

    const workspace1 = WorkspaceId("workspace-1")
    const workspace2 = WorkspaceId("workspace-2")

    yield* Console.log(`[Server] Starting workspace isolation scenario`)
    yield* Console.log(`[Server] Publishing to 2 workspaces alternately`)

    const startTime = Date.now()
    let publishedCount = 0
    const delayMs = 1000 / config.eventRate

    while (config.duration === 0 || Date.now() - startTime < config.duration) {
      // Alternate between workspaces
      const workspace = publishedCount % 2 === 0 ? workspace1 : workspace2
      const event = generateTabCreatedEvent(workspace)

      yield* stateSync.publishEvent(userId, event)
      publishedCount++

      if (publishedCount % 100 === 0) {
        yield* Console.log(`[Server] Published ${publishedCount} events`)
      }

      yield* Effect.sleep(delayMs)
    }

    const elapsed = Date.now() - startTime
    yield* Console.log(`[Server] Completed: ${publishedCount} events in ${elapsed}ms`)
    yield* Console.log(
      `[Server] Effective rate: ${((publishedCount / elapsed) * 1000).toFixed(2)} events/sec`
    )

    return { publishedCount, elapsed }
  })

// ============================================================================
// Main
// ============================================================================

const main = Effect.gen(function* () {
  const userId = UserId("test-user-1")
  const workspaceId = WorkspaceId("workspace-1")

  yield* Console.log(`[Server] Starting StateSync test server`)
  yield* Console.log(`[Server] Scenario: ${config.scenario}`)

  let result

  switch (config.scenario) {
    case "basic":
      result = yield* basicScenario(userId, workspaceId)
      break
    case "rapid-fire":
      result = yield* rapidFireScenario(userId, workspaceId)
      break
    case "burst":
      result = yield* burstScenario(userId, workspaceId)
      break
    case "workspace-isolation":
      result = yield* workspaceIsolationScenario(userId)
      break
    default:
      yield* Console.log(`[Server] Unknown scenario: ${config.scenario}`)
      return
  }

  yield* Console.log(`[Server] Final stats: ${JSON.stringify(result)}`)
})

// Run the program
Effect.runPromise(main).catch(error => {
  console.error("[Server] Fatal error:", error)
  process.exit(1)
})
