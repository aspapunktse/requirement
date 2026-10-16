import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHead } from "../PageHead";

describe("PageHead", () => {
  it("joins the breadcrumb with ' / ' as the eyebrow, above the title and lede", () => {
    render(
      <PageHead breadcrumb={["Home", "System Owner"]} pageId="HOME . SYSTEM OWNER" title="Welcome, Ada." lede="Start here." />,
    );
    expect(screen.getByText("Home / System Owner")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome, Ada." })).toBeInTheDocument();
    expect(screen.getByText("Start here.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("falls back to the page id as the eyebrow when there is no breadcrumb", () => {
    render(<PageHead pageId="HOME . ADMIN" title="Welcome." lede="Hi." />);
    expect(screen.getByText("HOME . ADMIN")).toBeInTheDocument();
  });

  it("shows each stat as a figure over its label, with no '//' prefix", () => {
    render(<PageHead pageId="X" title="T" lede="L" stats={[{ label: "Open tasks", value: 4 }]} />);
    expect(screen.getByText("Open tasks")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByText(/\/\//)).not.toBeInTheDocument();
  });
});
