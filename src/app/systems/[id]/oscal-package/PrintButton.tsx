"use client";

/** The review page's on-screen "Print / Save as PDF" button (hidden in print). Unlike the Statement page, it doesn't open the dialog on load. */
export function PrintButton() {
  return (
    <button type="button" className="oscal-print-button oscal-screen-only" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
