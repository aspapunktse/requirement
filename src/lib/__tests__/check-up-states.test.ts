import { describe, expect, it } from "vitest";
import {
  addCheckUpState,
  checkUpState,
  countCheckUpStates,
  emptyCheckUpStateCounts,
  isOpenCheckUpState,
  isReadyToClose,
  sumCheckUpStateCounts,
  type CheckUpFacts,
} from "../check-up-states";
import { calendarDaysUntil } from "../internal-audit-rules";

const NOW = new Date("2026-11-19T10:00:00Z");
const PAST = "2026-11-18";
const TODAY = "2026-11-19";
const FUTURE = "2026-12-01";
const launched = (dueDate: string) => ({ status: "LAUNCHED" as const, dueDate });
const unanswered: CheckUpFacts = { answered: false, evaluated: false, withdrawn: false };

describe("checkUpState (#398)", () => {
  it("withdrawn beats everything: evaluated, answered and overdue", () => {
    expect(checkUpState({ answered: true, evaluated: true, withdrawn: true }, launched(PAST), NOW)).toBe("withdrawn");
    expect(checkUpState({ answered: true, evaluated: false, withdrawn: true }, launched(FUTURE), NOW)).toBe("withdrawn");
    expect(checkUpState({ ...unanswered, withdrawn: true }, launched(PAST), NOW)).toBe("withdrawn");
  });

  it("an evaluation makes it evaluated, past due or not", () => {
    expect(checkUpState({ answered: true, evaluated: true, withdrawn: false }, launched(PAST), NOW)).toBe("evaluated");
    expect(checkUpState({ answered: true, evaluated: true, withdrawn: false }, launched(FUTURE), NOW)).toBe("evaluated");
  });

  it("answered and not evaluated is awaiting evaluation, even past due", () => {
    expect(checkUpState({ answered: true, evaluated: false, withdrawn: false }, launched(FUTURE), NOW)).toBe("awaiting");
    expect(checkUpState({ answered: true, evaluated: false, withdrawn: false }, launched(PAST), NOW)).toBe("awaiting");
  });

  it("is overdue only when unanswered in a launched audit past its due date", () => {
    expect(checkUpState(unanswered, launched(PAST), NOW)).toBe("overdue");
    expect(checkUpState(unanswered, launched(TODAY), NOW)).toBe("notAnswered");
    expect(checkUpState(unanswered, launched(FUTURE), NOW)).toBe("notAnswered");
    expect(checkUpState(unanswered, { status: "CLOSED", dueDate: PAST }, NOW)).toBe("notAnswered");
    expect(checkUpState(unanswered, { status: "DRAFT", dueDate: PAST }, NOW)).toBe("notAnswered");
  });

  it("reads a due date given as a Date at UTC midnight like the string", () => {
    expect(checkUpState(unanswered, launched(PAST), NOW)).toBe(checkUpState(unanswered, { status: "LAUNCHED", dueDate: new Date(`${PAST}T00:00:00Z`) }, NOW));
  });

  it("agrees with calendarDaysUntil on the day boundaries", () => {
    expect(calendarDaysUntil(TODAY, NOW)).toBe(0);
    expect(calendarDaysUntil(PAST, NOW)).toBe(-1);
    expect(calendarDaysUntil(FUTURE, NOW)).toBe(12);
    expect(calendarDaysUntil("nonsense", NOW)).toBeNull();
    expect(calendarDaysUntil(TODAY, new Date("2026-11-19T23:59:59Z"))).toBe(0);
  });
});

describe("counting Check-up states (#398)", () => {
  it("open means neither evaluated nor withdrawn", () => {
    expect(["evaluated", "withdrawn"].map((s) => isOpenCheckUpState(s as never))).toEqual([false, false]);
    expect(["awaiting", "overdue", "notAnswered"].map((s) => isOpenCheckUpState(s as never))).toEqual([true, true, true]);
  });

  it("counts every state, the total and the open ones", () => {
    const counts = countCheckUpStates(["evaluated", "evaluated", "withdrawn", "awaiting", "overdue", "overdue", "notAnswered"]);
    expect(counts).toEqual({ evaluated: 2, withdrawn: 1, awaiting: 1, overdue: 2, notAnswered: 1, total: 7, open: 4 });
  });

  it("starts empty and adds one state at a time", () => {
    const counts = emptyCheckUpStateCounts();
    expect(counts.total).toBe(0);
    addCheckUpState(counts, "awaiting");
    expect(counts).toMatchObject({ awaiting: 1, total: 1, open: 1 });
  });

  it("sums several audits", () => {
    const sum = sumCheckUpStateCounts([countCheckUpStates(["evaluated", "overdue"]), countCheckUpStates(["awaiting", "withdrawn"]), emptyCheckUpStateCounts()]);
    expect(sum).toEqual({ evaluated: 1, withdrawn: 1, awaiting: 1, overdue: 1, notAnswered: 0, total: 4, open: 2 });
  });

  it("is ready to close when nothing is open", () => {
    expect(isReadyToClose(countCheckUpStates(["evaluated", "withdrawn"]))).toBe(true);
    expect(isReadyToClose(countCheckUpStates(["evaluated", "awaiting"]))).toBe(false);
  });
});
