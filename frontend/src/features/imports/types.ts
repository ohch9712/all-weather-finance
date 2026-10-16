export type FieldType = "date" | "datetime" | "amount" | "decimal" | "text" | "enum";
export interface TargetField { key: string; label: string; type: FieldType; required: boolean }
export interface ImportKind { key: string; label: string; fields: TargetField[]; presets: { key: string; label: string }[] }
export type Mapping = Record<string, number | null>;
export interface RowError { rowNumber: number; field: string | null; message: string }
export interface PreviewRow { rowNumber: number; values: Record<string, string | number | null>; errors: RowError[] }
export interface ImportPreview { validCount: number; invalidCount: number; rows: PreviewRow[]; page: number; pageSize: number; total: number }
export interface ImportResult { inserted: number; skippedDuplicates: number; failed: number; errors: RowError[] }
export interface ImportJob {
  id: string; kind: string; status: "parsed" | "mapped" | "committed";
  fileName: string; fileType: "csv" | "xlsx" | "xls" | "html";
  sheetNames: string[]; sheetName: string | null; headerRow: number;
  columns: { index: number; header: string; samples: string[] }[];
  fields: TargetField[]; mapping: Mapping; mappingSource: "preset" | "synonym" | "llm" | "user";
  presetKey: string | null; rowCount: number; skippedRowCount: number; warnings: string[];
  expiresAt: string; preview: ImportPreview | null; result: ImportResult | null;
}
