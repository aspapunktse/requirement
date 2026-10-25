import { downloadCsv } from "./systems-download";
import { systemsCsv, systemsCsvFilename } from "./systems-logic";
import type { SystemRow } from "./systems-types";

/**
 * The buttons of the bulk bar, which appears when rows are selected. Today only "Export CSV".
 *
 * EXTENSION POINT: "Change owner" (#233) and "Add to Internal Audit" (#234) are added here as further
 * entries, each in its own issue. An entry that needs a dialog or a call to the server renders it from
 * `SystemsRegister` (the bar passes the selected rows and a way to clear the selection); it must check the
 * acting user's right on the server, as the list itself only shows rows. Their buttons are not shown until
 * those issues land.
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
