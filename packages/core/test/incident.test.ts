import { describe, expect, it } from "vitest";
import { INITIAL_COUNTERS, nextState, replay, type CheckCounters } from "../src/incident";

const up: CheckCounters = { state: "up", consecutiveFailures: 0, consecutiveSuccesses: 5 };
const down: CheckCounters = { state: "down", consecutiveFailures: 3, consecutiveSuccesses: 0 };

describe("incident state machine", () => {
  it("first pass moves unknown -> up without a transition", () => {
    const r = nextState(INITIAL_COUNTERS, true);
    expect(r).toMatchObject({ state: "up", consecutiveSuccesses: 1, transition: null });
  });

  it("a single failure does not open an incident", () => {
    const r = nextState(up, false);
    expect(r).toMatchObject({ state: "up", consecutiveFailures: 1, consecutiveSuccesses: 0, transition: null });
  });

  it("two consecutive failures open an incident", () => {
    const { final, transitions } = replay([false, false], up);
    expect(final.state).toBe("down");
    expect(transitions).toEqual([{ index: 1, transition: "opened" }]);
  });

  it("an unknown check that fails twice opens an incident", () => {
    const { final, transitions } = replay([false, false]);
    expect(final.state).toBe("down");
    expect(transitions).toEqual([{ index: 1, transition: "opened" }]);
  });

  it("further failures while down do not re-open", () => {
    const { transitions, final } = replay([false, false, false, false], up);
    expect(transitions).toHaveLength(1);
    expect(final.consecutiveFailures).toBe(4);
  });

  it("one pass while down does not resolve", () => {
    const r = nextState(down, true);
    expect(r).toMatchObject({ state: "down", consecutiveSuccesses: 1, consecutiveFailures: 0, transition: null });
  });

  it("two consecutive passes resolve", () => {
    const { final, transitions } = replay([true, true], down);
    expect(final.state).toBe("up");
    expect(transitions).toEqual([{ index: 1, transition: "resolved" }]);
  });

  it("alternating results (flapping) never opens or resolves", () => {
    expect(replay([false, true, false, true, false, true], up).transitions).toEqual([]);
    expect(replay([true, false, true, false, true, false], down).transitions).toEqual([]);
  });

  it("a pass-fail-pass-pass recovery sequence resolves only at the final pass", () => {
    const { transitions } = replay([true, false, true, true], down);
    expect(transitions).toEqual([{ index: 3, transition: "resolved" }]);
  });

  it("full lifecycle: up -> blip -> outage -> recovery", () => {
    const seq = [true, false, true, false, false, false, true, false, true, true, true];
    const { transitions, final } = replay(seq);
    expect(transitions).toEqual([
      { index: 4, transition: "opened" },
      { index: 9, transition: "resolved" },
    ]);
    expect(final).toEqual({ state: "up", consecutiveFailures: 0, consecutiveSuccesses: 3 });
  });

  it("supports custom thresholds", () => {
    expect(replay([false, false], up, { failureThreshold: 3 }).transitions).toEqual([]);
    expect(replay([false, false, false], up, { failureThreshold: 3 }).transitions).toEqual([{ index: 2, transition: "opened" }]);
    expect(replay([true], down, { recoveryThreshold: 1 }).transitions).toEqual([{ index: 0, transition: "resolved" }]);
  });

  it("clamps nonsensical thresholds to 1", () => {
    expect(nextState(up, false, { failureThreshold: 0 }).transition).toBe("opened");
  });

  it("is pure (does not mutate input)", () => {
    const prev = { ...up };
    nextState(prev, false);
    expect(prev).toEqual(up);
  });
});
