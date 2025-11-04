import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { addNumbers } from "./main"

describe("addNumbers", () => {
  test("should add two positive numbers correctly", async () => {
    const result = await Effect.runPromise(addNumbers(5, 3))
    expect(result).toBe(8)
  })

  test("should add negative numbers correctly", async () => {
    const result = await Effect.runPromise(addNumbers(-5, -3))
    expect(result).toBe(-8)
  })

  test("should add mixed positive and negative numbers", async () => {
    const result = await Effect.runPromise(addNumbers(10, -3))
    expect(result).toBe(7)
  })

  test("should handle zero correctly", async () => {
    const result = await Effect.runPromise(addNumbers(0, 0))
    expect(result).toBe(0)
  })

  test("should handle floating point numbers", async () => {
    const result = await Effect.runPromise(addNumbers(2.5, 3.7))
    expect(result).toBeCloseTo(6.2)
  })
})
