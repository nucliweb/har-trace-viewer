// A page's steps follow the real order of events. Each candidate step carries
// the timestamp of the event it narrates and a rank that breaks ties the way
// the classic 7-step narrative does (critical → FCP → secondary → LCP → third
// parties), so pages whose events share a timestamp keep a stable story.
export interface TimedItem<T> {
  item: T;
  timestamp: number;
  rank: number;
}

export function sortByTimeline<T>(items: TimedItem<T>[]): T[] {
  // Array.prototype.sort is stable, so equal timestamp and rank keep insertion order.
  return [...items]
    .sort((a, b) => a.timestamp - b.timestamp || a.rank - b.rank)
    .map((entry) => entry.item);
}

// When a group has no resources it keeps its classic place: right after the
// event that precedes it in the narrative.
export function firstStart(startTimes: number[], fallback: number): number {
  return startTimes.length > 0 ? Math.min(...startTimes) : fallback;
}
