/** Number of random values generated in one browser-crypto call. */
const RANDOM_BUFFER_SIZE = 256

/** Converts an unsigned 32-bit integer into a value in the half-open interval [0, 1). */
const UINT32_RANGE = 2 ** 32

/**
 * Supplies buffered random values without repeatedly allocating typed arrays.
 * Browser crypto avoids security hotspots while buffering keeps effects inexpensive.
 */
class RandomSource {
  /** Reusable storage filled by the browser's cryptographic random generator. */
  private readonly values = new Uint32Array(RANDOM_BUFFER_SIZE)

  /** Index of the next unused buffered value. */
  private index = RANDOM_BUFFER_SIZE

  /** Returns a random value in the half-open interval [0, 1). */
  public next(): number {
    if (this.index >= this.values.length) {
      crypto.getRandomValues(this.values)
      this.index = 0
    }

    const value = this.values[this.index]
    this.index += 1
    return value / UINT32_RANGE
  }
}

/** Shared random source used by non-deterministic game and audio effects. */
const RANDOM_SOURCE = new RandomSource()

/** Returns a random value in the half-open interval [0, 1). */
export function randomUnit(): number {
  return RANDOM_SOURCE.next()
}
