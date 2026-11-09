import { describe, expect, it } from "vitest";
import { evaluationSteps, stepKeysFor } from "../evaluation-stages";

describe("evaluation stages (#328)", () => {
  it("has the three shared steps and a fork until a Track is chosen", () => {
    expect(stepKeysFor(null)).toEqual(["FIRST_ROUND", "RISK_ANALYSIS_1", "OG1", "TRACK"]);
  });

  it("follows the Track's steps once chosen", () => {
    expect(stepKeysFor("SELF").slice(3)).toEqual(["SECOND_ROUND", "RISK_ANALYSIS_2", "OG3"]);
    expect(stepKeysFor("FULL")[3]).toBe("QUALIFICATION");
    expect(stepKeysFor("FULL")).toContain("OG2");
  });

  it("marks the current stage, what is behind as done, and a completed Risk Analysis as done", () => {
    const first = evaluationSteps({ stage: "FIRST_ROUND", track: null, riskAnalysisCompleted: false });
    expect(first.map((s) => s.state)).toEqual(["now", "todo", "todo", "todo"]);
    const withRa = evaluationSteps({ stage: "FIRST_ROUND", track: null, riskAnalysisCompleted: true });
    expect(withRa.find((s) => s.key === "RISK_ANALYSIS_1")?.state).toBe("done");
    const og1 = evaluationSteps({ stage: "OG1", track: null, riskAnalysisCompleted: true });
    expect(og1.map((s) => s.state)).toEqual(["done", "done", "now", "todo"]);
    const qualification = evaluationSteps({ stage: "QUALIFICATION", track: "FULL", riskAnalysisCompleted: true });
    expect(qualification.find((s) => s.key === "QUALIFICATION")?.state).toBe("now");
    expect(qualification.find((s) => s.key === "OG1")?.state).toBe("done");
  });
});
