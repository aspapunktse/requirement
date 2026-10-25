import { downloadCsv } from "./systems-download";
import { systemsCsv, systemsCsvFilename } from "./systems-logic";
import type { UserRole } from "@prisma/client";
import { canChangeOwner } from "@/lib/system-permissions";
import type { SystemRow } from "./systems-types";

/**
 * The buttons of the bulk bar, which appears when rows are selected. Today only "Export CSV".
 *
 * "Change owner" (#233) needs a dialog, so it is not an entry here: `SystemsRegister` renders its button
 * (shown when `canChangeAnyOwner` holds for the selection) and the dialog; the server checks the right again.
 *
 * EXTENSION POINT: "Add to Internal Audit" (#234) is added here as a further entry. An entry that needs a
 * dialog or a call to the server renders it from `SystemsRegister` (the bar passes the selected rows and a
 * way to clear the selection); it must check the acting user's right on the server, as the list itself
 * only shows rows. Its button is not shown until that issue lands.
 */
export type BulkAction = {
  key: string;
  label: string;
  run: (selected: SystemRow[]) => void;
};

export const BULK_ACTIONS: BulkAction[] = [
  {
    key: "export-csv",
    label: "Export CSV",
    run: (selected) => downloadCsv(systemsCsv(selected), systemsCsvFilename("selection", new Date())),
  },
];

/** Does the acting user own, or administer, at least one of the selected Systems (#233)? */
export function canChangeAnyOwner(selected: SystemRow[], actor: { id: string; role: UserRole }) {
  return selected.some((row) => canChangeOwner(actor, row));
}
