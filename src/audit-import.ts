import * as XLSX from "xlsx";
import {
  AUDIT_FIELDS,
  AUDIT_LIST_LIMIT,
  blankAuditLead,
  type AuditField,
  type AuditLeadInput,
} from "./audits";
export type ImportWorkbook = { sheets: string[]; workbook: XLSX.WorkBook };
export function readLeadFile(
  bytes: ArrayBuffer | Uint8Array,
  name: string,
): ImportWorkbook {
  if (bytes.byteLength > 5 * 1024 * 1024)
    throw new Error("Choose a CSV or Excel file smaller than 5 MB.");
  if (!/\.(csv|xlsx|xls)$/i.test(name))
    throw new Error("Choose a .csv, .xlsx, or .xls file.");
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      sheetRows: AUDIT_LIST_LIMIT + 2,
      cellFormula: true,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false,
      raw: true,
    });
  } catch {
    throw new Error(
      "This file could not be read. Export a CSV or an unprotected Excel workbook and try again.",
    );
  }
  if (!workbook.SheetNames.length)
    throw new Error("This workbook has no sheets.");
  return { workbook, sheets: workbook.SheetNames };
}
export function importGrid(file: ImportWorkbook, sheet: string) {
  const ws = file.workbook.Sheets[sheet];
  if (!ws) throw new Error("Choose a worksheet.");
  const full = XLSX.utils.decode_range(ws["!fullref"] || ws["!ref"] || "A1");
  if (full.e.r - full.s.r > AUDIT_LIST_LIMIT)
    throw new Error(
      `Each list supports ${AUDIT_LIST_LIMIT} leads. Split this sheet into smaller files.`,
    );
  const grid = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  });
  const headerRow = grid.findIndex((row) =>
    row.some((v) => String(v ?? "").trim()),
  );
  const firstColumn =
    headerRow < 0
      ? 0
      : grid[headerRow].findIndex((v) => String(v ?? "").trim());
  if (headerRow < 0 || grid.length < headerRow + 2)
    throw new Error("Add a header row followed by at least one lead.");
  const headers = (grid[headerRow] as any[])
    .slice(firstColumn)
    .map((v, i) => String(v || `Column ${i + 1}`).trim());
  if (headers.length > 50)
    throw new Error("Choose a sheet with at most 50 columns.");
  const origin = XLSX.utils.decode_range(ws["!ref"] || "A1").s;
  origin.r += headerRow;
  origin.c += firstColumn;
  return {
    headers,
    rows: grid
      .slice(headerRow + 1)
      .map((row) =>
        (row as any[]).slice(firstColumn).map((v) => String(v ?? "")),
      ),
    sheet: ws,
    origin,
  };
}
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases: Record<AuditField, string[]> = {
  first_name: ["firstname", "first", "givenname", "contactfirstname"],
  last_name: ["lastname", "last", "surname", "familyname"],
  email: ["email", "emailaddress", "contactemail", "e-mail"],
  company: [
    "company",
    "companyname",
    "businessname",
    "storebusinessname",
    "storename",
    "business",
    "store",
  ],
  website: [
    "website",
    "websiteurl",
    "storewebsiteurl",
    "storeurl",
    "url",
    "domain",
    "storewebsite",
  ],
  instagram_url: ["instagram", "instagramurl", "instagramlink"],
  tiktok_url: ["tiktok", "tiktokurl", "tiktoklink"],
  facebook_url: ["facebook", "facebookurl", "facebookpageurl", "facebookpage"],
  linkedin: ["linkedin", "linkedinurl", "linkedinlink"],
};
export function guessMapping(headers: string[]): Record<AuditField, number> {
  return Object.fromEntries(
    AUDIT_FIELDS.map(([key]) => [
      key,
      headers.findIndex((h) =>
        aliases[key].map(normalize).includes(normalize(h)),
      ),
    ]),
  ) as Record<AuditField, number>;
}
export function mapLeadRows(
  grid: ReturnType<typeof importGrid>,
  mapping: Record<AuditField, number>,
  newId: () => string,
): AuditLeadInput[] {
  const selected = Object.values(mapping).filter((i) => i >= 0);
  if (new Set(selected).size !== selected.length)
    throw new Error("Map each source column to only one lead field.");
  return grid.rows
    .map((values, rowIndex) => {
      const row = blankAuditLead(newId());
      for (const [key] of AUDIT_FIELDS) {
        const col = mapping[key];
        if (col < 0) continue;
        const cell =
          grid.sheet[
            XLSX.utils.encode_cell({
              r: grid.origin.r + rowIndex + 1,
              c: grid.origin.c + col,
            })
          ];
        if (cell?.f)
          throw new Error(
            `Row ${grid.origin.r + rowIndex + 2} contains a formula. Replace formula cells with plain values before importing.`,
          );
        row[key] = String(values[col] || "").trim();
      }
      return row;
    })
    .filter((row) => AUDIT_FIELDS.some(([key]) => row[key]));
}
export const AUDIT_CSV_TEMPLATE =
  "Firstname,Lastname,Email,Store/Business name,Store/website url,Instagram url,Tiktok url,Facebook page url,Linkedin url\n";
