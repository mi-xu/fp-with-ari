import { describe, test, expect } from "bun:test"
import { Effect, Stream, Duration, TestClock, TestContext } from "effect"
import { EntityId } from "./types"
import { make as makeBatcher } from "./batching"

/**
 * Tests for event batching with timing simulations
 */

describe("Event Batching", () => {
  test("batches multiple updates to same entity", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 16 })

      // Schedule multiple updates rapidly
      yield* batcher.scheduleUpdate(EntityId("tab-1"), { url: "https://example.com" })
      yield* batcher.scheduleUpdate(EntityId("tab-1"), { title: "Example" })
      yield* batcher.scheduleUpdate(EntityId("tab-1"), { favicon: "icon.png" })

      // Manually flush
      const events = yield* batcher.flush

      expect(events.length).toBe(1)
      expect(events[0].type).toBe("EntityUpdated")
      expect(events[0].entityId).toBe(EntityId("tab-1"))

      if (events[0].type === "EntityUpdated") {
        expect(events[0].changes.url).toBe("https://example.com")
        expect(events[0].changes.title).toBe("Example")
        expect(events[0].changes.favicon).toBe("icon.png")
      }

      yield* batcher.shutdown
    })

    await Effect.runPromise(program)
  })

  test("batches updates to different entities separately", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 16 })

      yield* batcher.scheduleUpdate(EntityId("tab-1"), { url: "https://example.com" })
      yield* batcher.scheduleUpdate(EntityId("tab-2"), { url: "https://test.com" })
      yield* batcher.scheduleUpdate(EntityId("tab-1"), { title: "Example" })

      const events = yield* batcher.flush

      expect(events.length).toBe(2)

      const tab1Event = events.find(e => e.entityId === EntityId("tab-1"))
      const tab2Event = events.find(e => e.entityId === EntityId("tab-2"))

      expect(tab1Event).toBeDefined()
      expect(tab2Event).toBeDefined()

      if (tab1Event?.type === "EntityUpdated") {
        expect(tab1Event.changes.url).toBe("https://example.com")
        expect(tab1Event.changes.title).toBe("Example")
      }

      if (tab2Event?.type === "EntityUpdated") {
        expect(tab2Event.changes.url).toBe("https://test.com")
      }

      yield* batcher.shutdown
    })

    await Effect.runPromise(program)
  })

  test("later updates override earlier ones for same field", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 16 })

      yield* batcher.scheduleUpdate(EntityId("tab-1"), { title: "First" })
      yield* batcher.scheduleUpdate(EntityId("tab-1"), { title: "Second" })
      yield* batcher.scheduleUpdate(EntityId("tab-1"), { title: "Third" })

      const events = yield* batcher.flush

      expect(events.length).toBe(1)

      if (events[0].type === "EntityUpdated") {
        expect(events[0].changes.title).toBe("Third")
      }

      yield* batcher.shutdown
    })

    await Effect.runPromise(program)
  })

  test("emits batched events via stream", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 50 })

      // Collect events from stream
      const collectedEvents: any[] = []

      // Start consuming stream in background
      const streamFiber = yield* 
        Effect.fork(
          Stream.runForEach(
            Stream.take(batcher.events, 1), // Take only 1 batch
            event => Effect.sync(() => collectedEvents.push(event))
          )
        )

      // Schedule updates
      yield* batcher.scheduleUpdate(EntityId("tab-1"), { url: "https://example.com" })
      yield* batcher.scheduleUpdate(EntityId("tab-2"), { url: "https://test.com" })

      // Wait for batch window to flush
      yield* Effect.sleep(Duration.millis(100))

      // Wait for stream to collect
      yield* Effect.sleep(Duration.millis(50))

      yield* batcher.shutdown

      // Should have collected batched events
      expect(collectedEvents.length).toBeGreaterThan(0)
    })

    await Effect.runPromise(program)
  })

  test("flushes on shutdown", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 1000 }) // Long window

      const collectedEvents: any[] = []

      const streamFiber = yield* 
        Effect.fork(
          Stream.runForEach(batcher.events, event =>
            Effect.sync(() => collectedEvents.push(event))
          )
        )

      yield* batcher.scheduleUpdate(EntityId("tab-1"), { url: "https://example.com" })

      // Shutdown without waiting for batch window
      yield* batcher.shutdown

      // Give stream time to process final flush
      yield* Effect.sleep(Duration.millis(50))

      // Events should still be flushed
      expect(collectedEvents.length).toBeGreaterThan(0)
    })

    await Effect.runPromise(program)
  })

  test("handles rapid successive updates (stress test)", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 16 })

      // Simulate 100 rapid updates to 10 tabs
      for (let i = 0; i < 100; i++) {
        const tabId = EntityId(`tab-${i % 10}`)
        yield* batcher.scheduleUpdate(tabId, { updateCount: i })
      }

      const events = yield* batcher.flush

      // Should batch into 10 events (one per tab)
      expect(events.length).toBe(10)

      // Each tab should have the last update for that tab
      for (let tabNum = 0; tabNum < 10; tabNum++) {
        const tabEvent = events.find(e => e.entityId === EntityId(`tab-${tabNum}`))
        expect(tabEvent).toBeDefined()

        if (tabEvent?.type === "EntityUpdated") {
          // Last update for this tab would be when i = 90 + tabNum (for tab 0: 90, tab 1: 91, etc.)
          const expectedLastUpdate = 90 + tabNum
          expect(tabEvent.changes.updateCount).toBe(expectedLastUpdate)
        }
      }

      yield* batcher.shutdown
    })

    await Effect.runPromise(program)
  })

  test("multiple flush cycles work correctly", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 16 })

      // First batch
      yield* batcher.scheduleUpdate(EntityId("tab-1"), { batch: 1 })
      const events1 = yield* batcher.flush
      expect(events1.length).toBe(1)

      // Second batch
      yield* batcher.scheduleUpdate(EntityId("tab-2"), { batch: 2 })
      const events2 = yield* batcher.flush
      expect(events2.length).toBe(1)

      // Third batch with multiple tabs
      yield* batcher.scheduleUpdate(EntityId("tab-3"), { batch: 3 })
      yield* batcher.scheduleUpdate(EntityId("tab-4"), { batch: 3 })
      const events3 = yield* batcher.flush
      expect(events3.length).toBe(2)

      yield* batcher.shutdown
    })

    await Effect.runPromise(program)
  })

  test("empty flush returns no events", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 16 })

      const events = yield* batcher.flush
      expect(events.length).toBe(0)

      yield* batcher.shutdown
    })

    await Effect.runPromise(program)
  })

  test("batches nested property changes", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 16 })

      yield* 
        batcher.scheduleUpdate(EntityId("tab-1"), {
          metadata: { notes: "First note" },
        })

      yield* 
        batcher.scheduleUpdate(EntityId("tab-1"), {
          metadata: { tags: ["important"] },
        })

      const events = yield* batcher.flush

      expect(events.length).toBe(1)

      if (events[0].type === "EntityUpdated") {
        // Later update should override
        expect(events[0].changes.metadata).toEqual({ tags: ["important"] })
      }

      yield* batcher.shutdown
    })

    await Effect.runPromise(program)
  })
})

describe("Batching with Custom Window Sizes", () => {
  test("50ms window batches correctly", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 50 })

      const collectedEvents: any[] = []

      const streamFiber = yield* 
        Effect.fork(
          Stream.runForEach(
            Stream.take(batcher.events, 1),
            event => Effect.sync(() => collectedEvents.push(event))
          )
        )

      yield* batcher.scheduleUpdate(EntityId("tab-1"), { test: true })

      // Wait for window to flush
      yield* Effect.sleep(Duration.millis(100))

      expect(collectedEvents.length).toBeGreaterThan(0)

      yield* batcher.shutdown
    })

    await Effect.runPromise(program)
  })

  test("100ms window batches correctly", async () => {
    const program = Effect.gen(function* () {
      const batcher = yield* makeBatcher({ windowMs: 100 })

      const collectedEvents: any[] = []

      const streamFiber = yield* 
        Effect.fork(
          Stream.runForEach(
            Stream.take(batcher.events, 1),
            event => Effect.sync(() => collectedEvents.push(event))
          )
        )

      yield* batcher.scheduleUpdate(EntityId("tab-1"), { test: true })

      // Wait for window to flush
      yield* Effect.sleep(Duration.millis(150))

      expect(collectedEvents.length).toBeGreaterThan(0)

      yield* batcher.shutdown
    })

    await Effect.runPromise(program)
  })
})
