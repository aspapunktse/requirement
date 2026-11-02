import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SensitivityChip } from "../SensitivityChip";

describe("SensitivityChip (#291)", () => {
  it("shows the label, no number, with an accessible name and bars filled up to the level", () => {
    const { container } = render(<SensitivityChip level={3} label="Sensitive" />);
    const chip = screen.getByRole("img", { name: "Sensitivity Level: Sensitive" });
    expect(chip).toHaveTextContent("Sensitive");
    expect(chip).not.toHaveTextContent("3");
    expect([...container.querySelectorAll("i")].map((bar) => bar.getAttribute("data-on"))).toEqual(["true", "true", "true", "false", "false"]);
    expect(chip.getAttribute("style")).toContain("var(--rg-sensitivity-3-fg)");
    expect(chip.getAttribute("style")).toContain("var(--rg-sensitivity-3-bg)");
  });

  it("has a neutral Not set state that uses none of the level tokens", () => {
    const { container } = render(<SensitivityChip level={null} />);
    const chip = screen.getByRole("img", { name: "Sensitivity Level: Not set" });
    expect(chip).toHaveTextContent("Not set");
    expect(chip.getAttribute("style") ?? "").not.toContain("--rg-sensitivity");
    expect([...container.querySelectorAll("i")].every((bar) => bar.getAttribute("data-on") === "false")).toBe(true);
  });

  it("takes explicit colours for previews and drops the bars at the small size", () => {
    const { container } = render(<SensitivityChip level={5} label="Critical" size="sm" colors={{ textColor: "#112233", backgroundColor: "#445566" }} />);
    expect(container.querySelectorAll("i")).toHaveLength(0);
    expect(screen.getByRole("img").style.color).toBe("rgb(17, 34, 51)");
  });
});
