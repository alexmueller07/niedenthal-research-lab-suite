import { describe, expect, it } from "vitest";
import {
  emptyLedger,
  mergeLedgers,
  nextRoundNumber,
  ratingsFileName,
  roundsFor,
  transitionsFileName,
} from "./rounds";
import type { RoundRecord, RoundsLedger } from "./rounds";

function record(overrides: Partial<RoundRecord> = {}): RoundRecord {
  return {
    participantId: "101",
    participantColor: "green",
    partnerId: "102",
    partnerColor: "orange",
    seat: "Left",
    dyadId: "51",
    round: 1,
    date: "2026-09-19",
    time: "14:05",
    folder: "R:/niedenthal/pps-data/51_101_102_AB",
    ratingsFile: "ratings_R1.csv",
    transitionsFile: "transitions_R1.csv",
    completedAt: "2026-09-19T19:05:00.000Z",
    raName: "Reese",
    groupId: "A",
    ...overrides,
  };
}

function ledger(...rounds: RoundRecord[]): RoundsLedger {
  return { version: 1, rounds };
}

describe("round file names", () => {
  it("names one pair of files per round", () => {
    expect(ratingsFileName(1)).toBe("ratings_R1.csv");
    expect(transitionsFileName(1)).toBe("transitions_R1.csv");
    expect(ratingsFileName(12)).toBe("ratings_R12.csv");
    expect(transitionsFileName(12)).toBe("transitions_R12.csv");
  });

  it("never gives two rounds the same file", () => {
    const names = new Set<string>();
    for (let round = 1; round <= 20; round += 1) {
      names.add(ratingsFileName(round));
      names.add(transitionsFileName(round));
    }
    expect(names.size).toBe(40);
  });
});

describe("nextRoundNumber", () => {
  it("starts a participant nobody has seen on R1", () => {
    expect(nextRoundNumber(emptyLedger(), "101")).toBe(1);
  });

  it("follows on from the rounds a participant has done", () => {
    const l = ledger(record({ round: 1 }), record({ round: 2, partnerId: "104" }));
    expect(nextRoundNumber(l, "101")).toBe(3);
  });

  it("counts only this participant's rounds", () => {
    const l = ledger(
      record({ participantId: "101", round: 1 }),
      record({ participantId: "102", round: 1 }),
      record({ participantId: "102", round: 2 })
    );
    expect(nextRoundNumber(l, "101")).toBe(2);
    expect(nextRoundNumber(l, "102")).toBe(3);
  });

  it("carries across days", () => {
    const l = ledger(
      record({ round: 1, date: "2026-09-10" }),
      record({ round: 2, date: "2026-09-12" })
    );
    expect(nextRoundNumber(l, "101")).toBe(3);
  });

  // The reason it is max+1 and not count+1: a ledger this station has only
  // partly seen must never hand out a number another station already used.
  it("takes the highest round, not the count, when a round is missing", () => {
    const l = ledger(record({ round: 1 }), record({ round: 3 }));
    expect(nextRoundNumber(l, "101")).toBe(4);
  });

  it("treats a blank participant id as nobody", () => {
    const l = ledger(record({ round: 4 }));
    expect(nextRoundNumber(l, "")).toBe(1);
    expect(roundsFor(l, "   ")).toEqual([]);
  });
});

describe("roundsFor", () => {
  it("returns a participant's rounds oldest first", () => {
    const l = ledger(record({ round: 3 }), record({ round: 1 }), record({ round: 2 }));
    expect(roundsFor(l, "101").map((r) => r.round)).toEqual([1, 2, 3]);
  });
});

describe("mergeLedgers", () => {
  it("keeps rounds only one side knows about", () => {
    const disk = ledger(record({ round: 1 }));
    const memory = ledger(record({ round: 2, partnerId: "104" }));
    const merged = mergeLedgers(disk, memory);
    expect(merged.rounds.map((r) => r.round).sort()).toEqual([1, 2]);
  });

  it("lets the disk win on the same participant and round", () => {
    const disk = ledger(record({ round: 1, raName: "Melia" }));
    const memory = ledger(record({ round: 1, raName: "Reese" }));
    expect(mergeLedgers(disk, memory).rounds).toHaveLength(1);
    expect(mergeLedgers(disk, memory).rounds[0].raName).toBe("Melia");
  });

  it("does not confuse two participants on the same round number", () => {
    const disk = ledger(record({ participantId: "101", round: 1 }));
    const memory = ledger(record({ participantId: "102", round: 1 }));
    expect(mergeLedgers(disk, memory).rounds).toHaveLength(2);
  });
});
