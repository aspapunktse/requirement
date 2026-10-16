import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskTable, type TaskRow } from "../TaskTable";

const row: TaskRow = {
  id: "r1",
  kind: "System",
  title: "Payroll",
  subtitle: "Needs an owner",
  tone: "warn",
  status: "Draft",
  href: "/systems/s1",
};

describe("TaskTable", () => {
  it("renders a table with the column headers and one row per task", () => {
    render(<TaskTable rows={[row, { ...row, id: "r2", title: "CRM", href: "/systems/s2" }]} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Task", "Status", "Updated", "Action"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    const first = screen.getAllByRole("row")[1]!;
    expect(within(first).getByText("Payroll")).toBeInTheDocument();
    expect(within(first).getByText("System")).toBeInTheDocument();
    expect(within(first).getByText("Draft")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "View →" })).toHaveAttribute("href", "/systems/s1");
  });

  it("says so when nothing needs attention", () => {
    render(<TaskTable rows={[]} />);
    expect(screen.getByText("Nothing needs your attention.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
