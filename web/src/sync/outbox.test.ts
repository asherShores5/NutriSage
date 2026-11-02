import { describe, expect, it } from "vitest";
import type { Day } from "@nutrisage/shared";
import { NetworkError } from "../api/errors";
import { createOutbox, type Op } from "./outbox";

const day = (date: string, water: number): Day => ({ date, entries: [], water, weight: null });

/** A server that is offline until `online` is set, recording what reached it. */
function fakeServer() {
  const s = {
    online: false,
    received: [] as Op[],
    reject: undefined as string | undefined,
    async send(op: Op) {
      if (!s.online) throw new NetworkError("offline");
      if (s.reject) throw new Error(s.reject);
      s.received.push(op);
      return op.type === "putDay" ? op.day : op.goals;
    },
  };
  return s;
}

function memoryStorage() {
  let saved: Op[] = [];
  return { load: () => saved, save: (ops: Op[]) => void (saved = ops), get saved() { return saved; } };
}

describe("outbox", () => {
  it("keeps a Day write queued (and saved on the device) while offline", async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    const outbox = createOutbox({ ...storage, send: server.send });
    await outbox.enqueue({ type: "putDay", day: day("2026-11-02", 1) });
    expect(outbox.pending()).toHaveLength(1);
    expect(storage.saved).toHaveLength(1);
    expect(server.received).toEqual([]);
  });

  it("sends queued writes in the order they were made once the API answers again", async () => {
    const server = fakeServer();
    const outbox = createOutbox({ ...memoryStorage(), send: server.send });
    await outbox.enqueue({ type: "putDay", day: day("2026-11-01", 3) });
    await outbox.enqueue({ type: "putGoals", goals: { carbs: 1, protein: 2, fat: 3, fiber: 4, sodium: 5, iron: 6, calories: 7, water: 8 } });
    await outbox.enqueue({ type: "putDay", day: day("2026-11-02", 1) });
    server.online = true;
    await outbox.flush();
    expect(server.received.map((o) => (o.type === "putDay" ? o.day.date : "goals"))).toEqual(["2026-11-01", "goals", "2026-11-02"]);
    expect(outbox.pending()).toEqual([]);
  });

  it("picks up writes saved by an earlier session (the app was closed offline)", async () => {
    const server = fakeServer();
    const storage = memoryStorage();
    await createOutbox({ ...storage, send: server.send }).enqueue({ type: "putDay", day: day("2026-11-02", 2) });
    server.online = true;
    const reopened = createOutbox({ ...storage, send: server.send });
    await reopened.flush();
    expect(server.received).toHaveLength(1);
    expect(storage.saved).toEqual([]);
  });

  it("sends only the latest queued copy of a Day (last write wins per Day)", async () => {
    const server = fakeServer();
    const outbox = createOutbox({ ...memoryStorage(), send: server.send });
    for (const cups of [1, 2, 3]) await outbox.enqueue({ type: "putDay", day: day("2026-11-02", cups) });
    expect(outbox.pending()).toHaveLength(1);
    server.online = true;
    await outbox.flush();
    expect(server.received.map((o) => o.type === "putDay" && o.day.water)).toEqual([3]);
  });

  it("a newer write made while the older one is in flight still goes out after it", async () => {
    const server = fakeServer();
    server.online = true;
    const sent: { op: Op; stillPending: boolean }[] = [];
    const outbox = createOutbox({ ...memoryStorage(), send: server.send, onSent: (op, _r, stillPending) => sent.push({ op, stillPending }) });
    const first = outbox.enqueue({ type: "putDay", day: day("2026-11-02", 1) });
    const second = outbox.enqueue({ type: "putDay", day: day("2026-11-02", 2) });
    await Promise.all([first, second]);
    expect(server.received.map((o) => o.type === "putDay" && o.day.water)).toEqual([1, 2]);
    // The first reply is stale by the time it arrives, so the store must not show it over cup 2.
    expect(sent.map((s) => s.stillPending)).toEqual([true, false]);
  });

  it("drops a write the server refuses and reports it, so later writes still go out", async () => {
    const server = fakeServer();
    server.online = true;
    server.reject = "ValidationError: too many Entries";
    const rejected: string[] = [];
    const outbox = createOutbox({ ...memoryStorage(), send: server.send, onRejected: (_op, e) => rejected.push(e.message) });
    await outbox.enqueue({ type: "putDay", day: day("2026-11-01", 1) });
    server.reject = undefined;
    await outbox.enqueue({ type: "putDay", day: day("2026-11-02", 1) });
    expect(rejected).toEqual(["ValidationError: too many Entries"]);
    expect(server.received).toHaveLength(1);
    expect(outbox.pending()).toEqual([]);
  });

  it("reports when the API stops and starts answering", async () => {
    const server = fakeServer();
    const reach: boolean[] = [];
    const outbox = createOutbox({ ...memoryStorage(), send: server.send, onReachable: (r) => reach.push(r) });
    await outbox.enqueue({ type: "putDay", day: day("2026-11-02", 1) });
    server.online = true;
    await outbox.flush();
    expect(reach).toEqual([false, true]);
  });
});
