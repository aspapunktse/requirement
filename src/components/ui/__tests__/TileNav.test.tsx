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
