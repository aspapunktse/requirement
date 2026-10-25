/**
 * Hands a CSV built in the browser to the user as a file download. The CSV comes from rows already on
 * the page (`systemsCsv`), so nothing leaves the page and the file never holds more than the user sees.
 */
export function downloadCsv(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
