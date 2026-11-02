import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SensitivityChip } from "../SensitivityChip";
import { SensitivityLevelPicker } from "../SensitivityLevelPicker";
import { DEFAULT_SENSITIVITY_LEVELS } from "@/lib/sensitivity-level-defaults";

afterEach(cleanup);

function renderPicker(props: Partial<React.ComponentProps<typeof SensitivityLevelPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <>
      <b id="lbl">Sensitivity Level</b>
      <SensitivityLevelPicker
        levels={DEFAULT_SENSITIVITY_LEVELS}
        value={3}
        onChange={onChange}
        name="test-level"
        labelledBy="lbl"
        noneLabel={<SensitivityChip level={null} />}
        noneDescription="Nothing declared."
        {...props}
      />
    </>,
  );
  return onChange;
}

describe("SensitivityLevelPicker", () => {
  it("is a radio group of the chips, each with its description, plus the none row", () => {
    renderPicker();
    expect(screen.getByRole("radiogroup", { name: "Sensitivity Level" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(6);
    expect(screen.getByRole("radio", { name: "Sensitivity Level: Sensitive" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Sensitivity Level: Public" })).toHaveAccessibleDescription(/anyone may see/);
    expect(screen.getByRole("radio", { name: "Sensitivity Level: Not set" })).toHaveAccessibleDescription("Nothing declared.");
  });

  it("shows an Admin's label, not the default", () => {
    renderPicker({ levels: DEFAULT_SENSITIVITY_LEVELS.map((level) => (level.level === 1 ? { ...level, label: "Open" } : level)) });
    expect(screen.getByRole("radio", { name: "Sensitivity Level: Open" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Sensitivity Level: Public" })).not.toBeInTheDocument();
  });

  it("reports the picked level, and null for the none row", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();
    await user.click(screen.getByRole("radio", { name: "Sensitivity Level: Critical Sensitivity" }));
    expect(onChange).toHaveBeenLastCalledWith(5);
    await user.click(screen.getByRole("radio", { name: "Sensitivity Level: Not set" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("moves between the rows with the arrow keys", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();
    screen.getByRole("radio", { name: "Sensitivity Level: Sensitive" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it("can't be changed when disabled", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker({ disabled: true });
    await user.click(screen.getByRole("radio", { name: "Sensitivity Level: Public" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Sensitivity Level: Public" })).toBeDisabled();
  });
});
