import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TileNav } from "../TileNav";

describe("TileNav", () => {
  it("renders a tile as a link to its href", () => {
    render(<TileNav tiles={[{ title: "Browse Systems", description: "All of them.", href: "/systems" }]} />);
    expect(screen.getByRole("link", { name: /Browse Systems/ })).toHaveAttribute("href", "/systems");
  });

  it("renders a disabled tile as text with its foot, never as a link (#147)", () => {
    render(
      <TileNav
        tiles={[
          { title: "Internal Audits", description: "Your audits will be listed here.", href: "/internal-audits", foot: "Coming soon", disabled: true },
          { title: "Browse Systems", description: "All of them.", href: "/systems" },
        ]}
      />,
    );
    expect(screen.getByText("Internal Audits")).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Internal Audits/ })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/internal-audits"]')).toBeNull();
    expect(screen.getByRole("link", { name: /Browse Systems/ })).toBeInTheDocument();
  });
});

describe("TileNav, Register look", () => {
  it("does not number the tiles and marks a disabled tile as dashed", () => {
    render(
      <TileNav
        tiles={[
          { title: "Internal Audits", description: "Soon.", href: "/internal-audits", disabled: true },
          { title: "Browse Systems", description: "All of them.", href: "/systems" },
        ]}
      />,
    );
    expect(screen.queryByText("01")).not.toBeInTheDocument();
    expect(screen.queryByText("02")).not.toBeInTheDocument();
    expect(screen.getByText("Internal Audits").closest("[aria-disabled]")).toHaveClass("border-dashed");
  });
});
