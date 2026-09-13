import { describe, expect, it } from "vitest";
import {
  colorsTakenOn,
  dyadsOn,
  emptyBoard,
  findByColor,
  mergeBoards,
  nextDyadId,
  seatParityHolds,
  suggestSeatIds,
} from "./sessionBoard";
import type { DyadEntry, SessionBoard } from "./sessionBoard";

function dyad(
  dyadId: string,
  date: string,
  leftColor: string,
  rightColor: string,
  time = "10:00"
): DyadEntry {
  const ids = suggestSeatIds(dyadId) ?? { left: `${dyadId}L`, right: `${dyadId}R` };
  return {
    dyadId,
    date,
    time,
    left: { color: leftColor as DyadEntry["left"]["color"], participantId: ids.left },
    right: { color: rightColor as DyadEntry["right"]["color"], participantId: ids.right },
    createdAt: "2026-08-22T09:00:00.000Z",
  };
}

function board(...dyads: DyadEntry[]): SessionBoard {
  return { version: 1, dyads };
}

describe("seat IDs", () => {
  it("gives the left seat the odd ID, which is what the protocol keys off", () => {
    expect(suggestSeatIds("1")).toEqual({ left: "1", right: "2" });
    expect(suggestSeatIds("14")).toEqual({ left: "27", right: "28" });
    // The rule that matters, stated as the rule rather than as three examples.
    for (let n = 1; n <= 60; n += 1) {
      const ids = suggestSeatIds(String(n))!;
      expect(Number(ids.left) % 2).toBe(1);
      expect(Number(ids.right) % 2).toBe(0);
      expect(Number(ids.right) - Number(ids.left)).toBe(1);
    }
  });

  it("suggests nothing for an ID it cannot reason about", () => {
    expect(suggestSeatIds("pilot-a")).toBeNull();
    expect(suggestSeatIds("0")).toBeNull();
    expect(suggestSeatIds("")).toBeNull();
  });

  it("flags a hand-typed dyad that broke the odd-left rule", () => {
    const bad = dyad("3", "2026-09-02", "red", "blue");
    bad.left.participantId = "6";
    expect(seatParityHolds(bad)).toBe(false);
    expect(seatParityHolds(dyad("3", "2026-09-02", "red", "blue"))).toBe(true);
  });

  it("does not flag a dyad whose IDs are not numbers at all", () => {
    const entry = dyad("pilot-a", "2026-09-02", "red", "blue");
    expect(seatParityHolds(entry)).toBe(true);
  });
});

describe("the day's board", () => {
  const b = board(
    dyad("1", "2026-09-02", "red", "blue", "09:00"),
    dyad("2", "2026-09-02", "green", "yellow", "11:00"),
    dyad("3", "2026-09-03", "red", "blue", "09:00")
  );

  it("shows one day at a time, in time order", () => {
    expect(dyadsOn(b, "2026-09-02").map((d) => d.dyadId)).toEqual(["1", "2"]);
    expect(dyadsOn(b, "2026-09-03").map((d) => d.dyadId)).toEqual(["3"]);
    expect(dyadsOn(b, "2026-09-04")).toEqual([]);
  });

  it("finds the dyad and seat a nametag colour belongs to", () => {
    expect(findByColor(b, "2026-09-02", "yellow")).toEqual({
      entry: b.dyads[1],
      seat: "right",
    });
    expect(findByColor(b, "2026-09-02", "red")).toEqual({
      entry: b.dyads[0],
      seat: "left",
    });
    // Same colour, different day — a colour is only unique within a day.
    expect(findByColor(b, "2026-09-03", "red")?.entry.dyadId).toBe("3");
    expect(findByColor(b, "2026-09-02", "teal")).toBeNull();
  });

  it("knows which colours are already out on a given day", () => {
    expect([...colorsTakenOn(b, "2026-09-02")].sort()).toEqual([
      "blue",
      "green",
      "red",
      "yellow",
    ]);
    expect([...colorsTakenOn(b, "2026-09-03")].sort()).toEqual(["blue", "red"]);
  });

  it("suggests the next unused dyad number", () => {
    expect(nextDyadId(emptyBoard())).toBe("1");
    expect(nextDyadId(b)).toBe("4");
    // Non-numeric entries are ignored rather than breaking the count.
    expect(nextDyadId(board(dyad("pilot-a", "2026-09-02", "red", "blue")))).toBe("1");
  });
});

describe("merging what two stations wrote", () => {
  it("keeps the other machine's entry instead of erasing it", () => {
    const disk = board(dyad("1", "2026-09-02", "red", "blue"));
    const memory = board(dyad("2", "2026-09-02", "green", "yellow"));
    const merged = mergeBoards(disk, memory);
    expect(merged.dyads.map((d) => d.dyadId).sort()).toEqual(["1", "2"]);
  });

  it("lets the file on disk win a conflict, so a save cannot roll one back", () => {
    const disk = board(dyad("1", "2026-09-02", "red", "blue", "09:30"));
    const stale = board(dyad("1", "2026-09-02", "red", "blue", "09:00"));
    expect(mergeBoards(disk, stale).dyads[0].time).toBe("09:30");
  });
});
