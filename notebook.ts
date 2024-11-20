// A janky API to make sections of a typescript file runnable as notebook cells
export const cell = function (f: () => void) {
  f()
}
cell.disabled = (_: () => void) => {}
