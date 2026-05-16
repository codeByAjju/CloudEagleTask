import type { Column, Row } from "@tanstack/react-table";

type CsvCellValue = boolean | Date | null | number | string | undefined;

export type CsvValueFormatter<TData> = (params: {
  column: Column<TData, unknown>;
  row: Row<TData>;
  value: unknown;
}) => CsvCellValue;

type ExportRowsToCsvOptions<TData> = {
  columns: Column<TData, unknown>[];
  filename: string;
  formatters?: Partial<Record<string, CsvValueFormatter<TData>>>;
  rows: Row<TData>[];
};

const csvMimeType = "text/csv;charset=utf-8;";

const humanizeColumnId = (columnId: string) =>
  columnId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const getColumnHeader = <TData>(column: Column<TData, unknown>) => {
  const header = column.columnDef.header;

  return typeof header === "string"
    ? header
    : humanizeColumnId(column.id);
};

const normalizeCellValue = (value: CsvCellValue) => {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleDateString();

  return String(value);
};

const escapeCsvValue = (value: CsvCellValue) => {
  const normalizedValue = normalizeCellValue(value);
  const shouldQuote = /[",\n\r]/.test(normalizedValue);
  const escapedValue = normalizedValue.replace(/"/g, '""');

  return shouldQuote ? `"${escapedValue}"` : escapedValue;
};

const buildCsvContent = <TData>({
  columns,
  formatters,
  rows,
}: Omit<ExportRowsToCsvOptions<TData>, "filename">) => {
  const headerRow = columns.map(getColumnHeader).map(escapeCsvValue);
  const bodyRows = rows.map((row) =>
    columns
      .map((column) => {
        const formatter = formatters?.[column.id];
        const value = row.getValue(column.id);

        return escapeCsvValue(
          formatter ? formatter({ column, row, value }) : value as CsvCellValue
        );
      })
      .join(",")
  );

  return [headerRow.join(","), ...bodyRows].join("\n");
};

export const exportRowsToCsv = <TData>({
  columns,
  filename,
  formatters,
  rows,
}: ExportRowsToCsvOptions<TData>) => {
  const csvContent = buildCsvContent({ columns, formatters, rows });
  const blob = new Blob([`\uFEFF${csvContent}`], { type: csvMimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
