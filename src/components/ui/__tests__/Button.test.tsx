import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, buttonClassName } from "../Button";

describe("Button", () => {
  it("is a plain button by default, with the outline look", () => {
    render(<Button>Remove</Button>);
    const button = screen.getByRole("button", { name: "Remove" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("border-rg-line");
  });

  it("fills the primary variant with the accent and on-accent text", () => {
    render(<Button variant="primary">Submit for review</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-rg-accent", "text-rg-on-accent");
  });

  it("outlines the secondary variant in the accent", () => {
    expect(buttonClassName("secondary")).toContain("border-rg-accent");
  });

  it("passes extra classes and the disabled attribute through", () => {
    render(
      <Button disabled className="mt-2">
        Save
      </Button>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByRole("button")).toHaveClass("mt-2");
  });
});
