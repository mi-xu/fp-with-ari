import { Effect } from "effect";

/**
 * A simple Effect program that adds two numbers
 */
export const addNumbers = (a: number, b: number): Effect.Effect<number> => {
  return Effect.succeed(a + b);
};

/**
 * Main program that adds 5 and 3
 */
const program = Effect.gen(function* () {
  const result = yield* addNumbers(5, 3);
  console.log(`The sum of 5 and 3 is: ${result}`);
  return result;
});

// Run the program if this file is executed directly
if (import.meta.main) {
  Effect.runPromise(program)
    .then((result) => {
      console.log(`Program completed successfully with result: ${result}`);
    })
    .catch((error) => {
      console.error("Program failed:", error);
      process.exit(1);
    });
}
