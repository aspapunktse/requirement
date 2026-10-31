"use client";

import { useEffect, useRef } from "react";

/**
 * The print page's two on-screen controls (hidden in print): a "Print / Save as PDF" button, and the print
 * dialog opened once as the page loads. The ref keeps React's dev double-mount from opening it twice.
 */
export function AutoPrint() {
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    window.print();
  }, []);

  return (
    <div className="soa-screen-only">
      <button type="button" className="soa-print-button" onClick={() => window.print()}>
        Print / Save as PDF
      </button>
      <p>
        Choose &ldquo;Save as PDF&rdquo; as the destination. Headers and footers and page numbers are best in Chrome or Edge.
      </p>
    </div>
  );
}
