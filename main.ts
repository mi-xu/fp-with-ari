import { Effect, Console, Exit, Cause } from "effect"

/**
 * A simple Effect program that adds two numbers
 */
export const addNumbers = (a: number, b: number): Effect.Effect<number> => {
  return Effect.succeed(a + b)
}

/**
 * Main program that adds 5 and 3
 */
const program = Effect.gen(function* () {
  const result = yield* addNumbers(5, 3)
  yield* Console.log(`The sum of 5 and 3 is: ${result}`)
  return result
})

// Run the program if this file is executed directly
if (import.meta.main) {
  program
    .pipe(
      Effect.tap(result => Console.log(`Program completed successfully with result: ${result}`)),
      Effect.runPromiseExit
    )
    .then(
      Exit.match({
        onFailure: cause => {
          console.error("Program failed:")
          console.error(Cause.pretty(cause))
          process.exit(1)
        },
        onSuccess: () => {
          // Program completed successfully, exit code 0 by default
        },
      })
    )
}
