/** Supplies the current time. Injected so callers and tests control it. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** Returns a function producing `prefix_1`, `prefix_2`, … */
export function sequentialIds(prefix: string): () => string {
  let next = 1;
  return () => `${prefix}_${String(next++)}`;
}
