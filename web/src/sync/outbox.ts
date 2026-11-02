// The Member's outbox: whole-row writes (a Day, the goals, one Favorite) saved on the device first, then sent to
// the API one at a time, oldest first. Offline, or on a weak signal, the writes wait on the device
// and go out when the API answers again. Copied in shape from Honey Do (web/src/outbox.ts +
// store.ts flush) but simpler: every write carries the whole row and the last write wins, so
// there is no conflict replay. Pure: storage and the network are passed in, so tests drive it.
import type { Day, Favorite, Goals } from "@nutrisage/shared";
import { NetworkError } from "../api/errors";

export type Op =
  | { id: string; type: "putDay"; day: Day }
  | { id: string; type: "putGoals"; goals: Goals }
  | { id: string; type: "putFavorite"; favorite: Favorite }
  | { id: string; type: "deleteFavorite"; libraryId: string };
export type NewOp = Op extends infer O ? (O extends Op ? Omit<O, "id"> : never) : never;

/** The row an op writes. A newer op for the same row replaces an older queued one. */
export function opRow(op: NewOp | Op): string {
  switch (op.type) {
    case "putDay": return `DAY#${op.day.date}`;
    case "putGoals": return "GOALS";
    case "putFavorite": return `FAV#${op.favorite.libraryId}`;
    case "deleteFavorite": return `FAV#${op.libraryId}`;
  }
}

export interface OutboxDeps {
  /** Ops saved on this device by an earlier session. */
  load(): Op[];
  save(ops: Op[]): void;
  /** Sends one op; resolves with the server's copy of the row. Throws NetworkError to retry later. */
  send(op: Op): Promise<unknown>;
  /** An op reached the server. `stillPending` when a newer write to the same row is queued behind it. */
  onSent?(op: Op, result: unknown, stillPending: boolean): void;
  /** The server refused an op (e.g. validation). It is dropped so it can't block the queue. */
  onRejected?(op: Op, error: Error): void;
  /** Called with false when a send hits the network, true when one gets through. */
  onReachable?(reachable: boolean): void;
}

export function createOutbox(deps: OutboxDeps) {
  let ops: Op[] = deps.load();
  let flushing: Promise<void> | undefined;
  let seq = 0;

  const set = (next: Op[]) => {
    ops = next;
    deps.save(ops);
  };

  async function run() {
    while (ops.length) {
      const op = ops[0];
      try {
        const result = await deps.send(op);
        set(ops.filter((o) => o.id !== op.id));
        deps.onReachable?.(true);
        deps.onSent?.(op, result, ops.some((o) => opRow(o) === opRow(op)));
      } catch (e) {
        if (e instanceof NetworkError) {
          deps.onReachable?.(false);
          return;
        }
        set(ops.filter((o) => o.id !== op.id));
        deps.onReachable?.(true);
        deps.onRejected?.(op, e as Error);
      }
    }
  }

  /** Send everything queued, in order. One run at a time; resolves when empty or the network fails. */
  function flush(): Promise<void> {
    flushing ??= run().finally(() => (flushing = undefined));
    return flushing;
  }

  return {
    /** Queue a write (replacing an older queued write to the same row) and try to send it. */
    enqueue(op: NewOp): Promise<void> {
      const full = { ...op, id: `${Date.now().toString(36)}-${(seq++).toString(36)}` } as Op;
      // If the replaced op is the one being sent right now, it still lands first (the run removes
      // ops by id) and this newer write goes out after it, so the server ends on the latest copy.
      set([...ops.filter((o) => opRow(o) !== opRow(full)), full]);
      return flush();
    },
    flush,
    pending: () => ops,
    /** The newest queued write to a row, if any. */
    pendingFor: (row: string) => [...ops].reverse().find((o) => opRow(o) === row),
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
