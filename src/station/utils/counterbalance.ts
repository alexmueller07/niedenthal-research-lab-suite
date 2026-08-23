// Which perspective a participant starts the continuous-rating task with.
//
// The protocol yokes this to the seat: the left seat takes the odd study ID and
// starts by rating their own feelings, the right seat takes the even ID and
// starts with their partner's. Within a dyad the two are therefore always on
// opposite perspectives for the same stretch of the conversation, which is what
// makes the two traces comparable at all — an empathic-accuracy score is the
// difference between one person's partner-trace and the other person's
// self-trace over the same seconds.
//
// This lives in its own file because it is a rule, not a detail: it belongs
// somewhere it can be read and tested on its own, and the lab's own
// documentation states it as a rule ("left seat = odd participant ID = starts
// with self").

export type RatingTarget = "self" | "partner";

/**
 * The starting perspective for a participant, and why it was chosen.
 *
 * A study ID that is not a number — a pilot, a make-good, a test run — has no
 * parity to key off, so it falls back to the seat the RA selected. If neither
 * says anything, it starts with "self", which is what the app did for every
 * participant before this rule was implemented.
 */
export function startingTarget(
  participantId: string,
  computer: string
): { target: RatingTarget; basis: string } {
  const numeric = Number(String(participantId).trim());
  if (Number.isInteger(numeric) && numeric > 0) {
    return {
      target: numeric % 2 === 1 ? "self" : "partner",
      basis: `participant_id_parity(${numeric})`,
    };
  }
  const seat = String(computer).trim().toLowerCase();
  if (seat === "left") return { target: "self", basis: "seat(left)" };
  if (seat === "right") return { target: "partner", basis: "seat(right)" };
  return { target: "self", basis: "default" };
}
