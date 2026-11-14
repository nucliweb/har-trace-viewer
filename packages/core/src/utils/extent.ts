/**
 * The largest value, or `initial` when it is larger or the array is empty. A loop instead of
 * `Math.max(...values)`, which throws a RangeError once the array passes about 100k elements.
 */
export function maxOf(values: readonly number[], initial = -Infinity): number {
  let max = initial;
  for (const value of values) if (value > max) max = value;
  return max;
}

/** The smallest value, or `initial` when it is smaller or the array is empty. See maxOf. */
export function minOf(values: readonly number[], initial = Infinity): number {
  let min = initial;
  for (const value of values) if (value < min) min = value;
  return min;
}
