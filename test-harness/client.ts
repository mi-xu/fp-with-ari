#!/usr/bin/env bun

/**
 * State Sync Test Harness - Client
 *
 * Subscribes to events from a StateSync system and tracks received events.
 * This simulates a client receiving state updates.
 */

import { Effect, Console, Stream, Ref, Scope } from "effect"
import {
  createDisposableStateSync,
  EntityId,
  UserId,
  WorkspaceId,
  Subscription,
  EnvelopedEvent,
} from "../src/state-sync/index"

// ============================================================================
// Configuration
// ============================================================================

type ClientConfig = {
  userId: string
  workspaces: string[] // Workspace IDs to subscribe to
  entityTypes: string[] // Entity types to always include
  duration: number // Duration to listen (ms), 0 = indefinite
  verbose: boolean // Log every event
}

const config: ClientConfig = {
  userId: "test-user-1",
  workspaces: ["workspace-1"],
  entityTypes: ["window", "tab"],
  duration: 0, // Listen indefinitely by default
  verbose: false,
}

// Parse command line arguments
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--user":
      config.userId = args[++i] || "test-user-1"
      break
    case "--workspaces":
      config.workspaces = (args[++i] || "workspace-1").split(",")
      break
    case "--types":
      config.entityTypes = (args[++i] || "window,tab").split(",")
      break
    case "--duration":
      config.duration = parseInt(args[++i] || "0", 10)
      break
    case "--verbose":
      config.verbose = true
      break
  }
}

// ============================================================================
// Event Statistics
// ============================================================================

type EventStats = {
  totalReceived: number
  byType: Map<string, number>
  byWorkspace: Map<string, number>
  firstEventTime: number | null
  lastEventTime: number | null
  sequenceGaps: number[]
  duplicates: number
  seenSequenceNumbers: Set<number>
}

const createStats = (): EventStats => ({
  totalReceived: 0,
  byType: new Map(),
  byWorkspace: new Map(),
  firstEventTime: null,
  lastEventTime: null,
  sequenceGaps: [],
  duplicates: 0,
  seenSequenceNumbers: new Set(),
})

const updateStats = (stats: EventStats, event: EnvelopedEvent): EventStats => {
  const now = Date.now()

  // Check for duplicates
  if (stats.seenSequenceNumbers.has(event.sequenceNumber)) {
    return { ...stats, duplicates: stats.duplicates + 1 }
  }

  stats.seenSequenceNumbers.add(event.sequenceNumber)

  // Update counts
  const totalReceived = stats.totalReceived + 1

  // Track by event type
  const eventType = event.event.type
  const byType = new Map(stats.byType)
  byType.set(eventType, (byType.get(eventType) || 0) + 1)

  // Track by workspace (extract from event data)
  const workspaceId = extractWorkspaceId(event)
  const byWorkspace = new Map(stats.byWorkspace)
  if (workspaceId) {
    byWorkspace.set(workspaceId, (byWorkspace.get(workspaceId) || 0) + 1)
  }

  // Track timing
  const firstEventTime = stats.firstEventTime ?? now
  const lastEventTime = now

  // Check for sequence gaps
  const sequenceGaps = [...stats.sequenceGaps]
  if (stats.totalReceived > 0) {
    const expectedSeq = Math.max(...stats.seenSequenceNumbers) + 1
    if (event.sequenceNumber > expectedSeq) {
      sequenceGaps.push(event.sequenceNumber - expectedSeq)
    }
  }

  return {
    totalReceived,
    byType,
    byWorkspace,
    firstEventTime,
    lastEventTime,
    sequenceGaps,
    duplicates: stats.duplicates,
    seenSequenceNumbers: stats.seenSequenceNumbers,
  }
}

/**
 * Extract workspace ID from event data
 */
const extractWorkspaceId = (event: EnvelopedEvent): string | null => {
  const atomicEvent = event.event.type === "Transaction" ? event.event.operations[0] : event.event

  if (!atomicEvent) return null

  switch (atomicEvent.type) {
    case "EntityCreated":
      return (atomicEvent.data.workspaceId as string) || null
    case "EntityUpdated":
      return (atomicEvent.changes.workspaceId as string) || null
    default:
      return null
  }
}

/**
 * Print statistics summary
 */
const printStats = (stats: EventStats) =>
  Effect.gen(function* () {
    yield* Console.log(`\n[Client] === Event Statistics ===`)
    yield* Console.log(`[Client] Total received: ${stats.totalReceived}`)
    yield* Console.log(`[Client] Duplicates: ${stats.duplicates}`)

    if (stats.firstEventTime && stats.lastEventTime) {
      const duration = stats.lastEventTime - stats.firstEventTime
      const rate = duration > 0 ? (stats.totalReceived / duration) * 1000 : 0
      yield* Console.log(`[Client] Duration: ${duration}ms`)
      yield* Console.log(`[Client] Rate: ${rate.toFixed(2)} events/sec`)
    }

    yield* Console.log(`\n[Client] By event type:`)
    for (const [type, count] of stats.byType.entries()) {
      yield* Console.log(`[Client]   ${type}: ${count}`)
    }

    yield* Console.log(`\n[Client] By workspace:`)
    for (const [workspace, count] of stats.byWorkspace.entries()) {
      yield* Console.log(`[Client]   ${workspace}: ${count}`)
    }

    if (stats.sequenceGaps.length > 0) {
      yield* Console.log(`\n[Client] Sequence gaps detected: ${stats.sequenceGaps.length}`)
      yield* Console.log(`[Client] Gap sizes: ${stats.sequenceGaps.join(", ")}`)
    }
  })

// ============================================================================
// Main Client Logic
// ============================================================================

const main = Effect.gen(function* () {
  yield* Console.log(`[Client] Starting StateSync test client`)
  yield* Console.log(`[Client] User: ${config.userId}`)
  yield* Console.log(`[Client] Workspaces: ${config.workspaces.join(", ")}`)
  yield* Console.log(`[Client] Entity types: ${config.entityTypes.join(", ")}`)
  yield* Console.log(`[Client] Duration: ${config.duration || "indefinite"}ms`)
  yield* Console.log(`[Client] Verbose: ${config.verbose}\n`)

  // Create StateSync instance
  const { stateSync, dispose } = yield* Effect.promise(() => createDisposableStateSync())

  // Create subscription
  const subscription: Subscription = {
    userId: UserId(config.userId),
    alwaysInclude: {
      entityTypes: config.entityTypes,
    },
    workspaces: new Set(config.workspaces.map(WorkspaceId)),
  }

  // Track statistics
  const statsRef = yield* Ref.make(createStats())

  // Subscribe and process events
  yield* Effect.gen(function* () {
    const stream = yield* stateSync.subscribe(subscription)

    // Create a stream that processes events and updates stats
    const processStream = Stream.mapEffect(stream, event =>
      Effect.gen(function* () {
        // Update stats
        yield* Ref.update(statsRef, stats => updateStats(stats, event))

        // Log if verbose
        if (config.verbose) {
          yield* Console.log(
            `[Client] Event #${event.sequenceNumber}: ${event.event.type} at ${event.timestamp.toISOString()}`
          )
        }

        return event
      })
    )

    // Run the stream for the configured duration
    const runStream =
      config.duration > 0
        ? Stream.runDrain(Stream.takeUntil(processStream, Effect.sleep(config.duration)))
        : Stream.runDrain(processStream)

    // Handle Ctrl+C gracefully
    const interrupted = yield* Effect.fork(
      Effect.gen(function* () {
        yield* Effect.sleep(config.duration || Number.MAX_SAFE_INTEGER)
      })
    )

    yield* runStream.pipe(Effect.race(Effect.interrupt))
  }).pipe(Effect.scoped)

  // Print final statistics
  const finalStats = yield* Ref.get(statsRef)
  yield* printStats(finalStats)

  // Cleanup
  yield* Effect.promise(dispose)
  yield* Console.log(`\n[Client] Shutdown complete`)
})

// Run the program
Effect.runPromise(main).catch(error => {
  console.error("[Client] Fatal error:", error)
  process.exit(1)
})
