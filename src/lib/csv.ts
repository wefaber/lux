export type CsvCell = string | number | boolean | null | undefined;

// Punto y coma como separador: Excel en es-UY usa coma decimal y no separa
// columnas con coma.
const SEPARATOR = ";";

function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  const text = String(cell);
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(escapeCell).join(SEPARATOR)).join("\r\n");
} // Serializa filas a CSV

export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  // El BOM hace que Excel abra el archivo como UTF-8 y respete los acentos
  const blob = new Blob(["﻿", toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
} // Descarga un CSV desde el navegador
