import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusChip, type ChipTone } from "../StatusChip";

describe("StatusChip", () => {
  it("shows the label as written, in sentence case, with a dot", () => {
    const { container } = render(<StatusChip tone="success">In review</StatusChip>);
    const pill = screen.getByText("In review");
    expect(pill).not.toHaveClass("uppercase");
    expect(pill).not.toHaveClass("ems-mono-label");
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it.each<[ChipTone, string]>([
    ["success", "bg-rg-success-soft"],
    ["warn", "bg-rg-gold-soft"],
    ["danger", "bg-rg-danger-soft"],
    ["neutral", "bg-rg-paper"],
    ["accent", "bg-rg-accent-soft"],
  ])("fills the %s tone with %s", (tone, fill) => {
    render(<StatusChip tone={tone}>State</StatusChip>);
    expect(screen.getByText("State")).toHaveClass(fill);
  });
});
