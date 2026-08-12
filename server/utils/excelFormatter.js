/**
 * excelFormatter.js
 * -----------------
 * Centralised ExcelJS formatting middleware for every generated workbook.
 *
 * Rules:
 *  1. Global font: Calibri 14 pt
 *  2. Header row: bold, yellow (#FFFF00), frozen, wrapText, centered, all-borders
 *  3. Data cells: wrapText, centered (H + V), all-borders
 *  4. Column width: sized on DATA only (header wraps — excluded from width calc)
 *       · Width accounts for 14 pt font being wider than the 11 pt Excel baseline
 *       · Cell margin padding is included so full values are never clipped
 *       · Alphanumeric / text columns: capped at ~250 px
 *       · Empty columns: ~70 px
 *  5. Header row height: computed dynamically from wrap line count
 *  6. Data row height:   computed dynamically from wrap line count
 *  7. Integer numbers:  numFmt = '0'  (prevents "1.83E+08" scientific notation)
 *  8. Print titles: row 1 repeats on every printed page
 */

import ExcelJS from 'exceljs'

// ── Constants ──────────────────────────────────────────────────────────────────
const FONT_SIZE = 14
const HEADER_BG_ARGB = 'FFFFFF00'   // Yellow
const LINE_HEIGHT_PT = 22            // pt per wrapped text line at 14 pt

// Excel column-width is measured in Calibri 11 pt "character units" (~6.5 px each).
// At 14 pt each character is ~8.3 px wide → ratio ≈ 8.3/6.5 ≈ 1.28.
// Using 1.5 gives a comfortable safety margin so content never clips.
const WIDTH_FACTOR = 1.5   // char_count × factor = units needed
const CELL_PADDING_UNITS = 2     // ~1 char-unit margin on each side of a cell
const MAX_COL_UNITS = 28    // hard cap: 28 × 6.5 px ≈ 182 px raw (≈ 250 px at 14 pt)
const EMPTY_COL_UNITS = 8     // for columns with no data (~70 px)
const MIN_COL_UNITS = 10    // minimum for very short data

// ── Border definition ─────────────────────────────────────────────────────────
const THIN = { style: 'thin', color: { argb: 'FF000000' } }
const ALL_BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN }

// ── Value helpers ──────────────────────────────────────────────────────────────

/**
 * Always returns a plain string — used for width calculation and row-height
 * estimation only. Date objects become "DD-MM-YYYY" (avoids the 52-char
 * JS Date.toString() that would explode column widths).
 */
function toWidthString(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    const dd = String(v.getDate()).padStart(2, '0')
    const mm = String(v.getMonth() + 1).padStart(2, '0')
    return `${dd}-${mm}-${v.getFullYear()}`
  }
  return String(v)
}

/**
 * Returns the value that will be written into the ExcelJS cell.
 *  · JS number   → kept as number  (ExcelJS numeric cell — avoids "stored as text" warning)
 *  · Date object → "DD-MM-YYYY" string using LOCAL date components
 *  · Everything  → String()
 *
 * Why a string, and why local components?
 *
 * SheetJS (cellDates:true) converts Excel date serials to JS Date objects at
 * LOCAL midnight. For example, 08-08-2026 in a UTC+5:30 machine becomes
 * 2026-08-07T18:30:00.000Z internally. If we pass that Date object to ExcelJS,
 * it serialises it in UTC → Excel sees serial for 2026-08-07 18:30 → formula
 * bar shows "07-08-2026 06:30:00 PM". Wrong date, wrong time.
 *
 * Formatting as a plain "DD-MM-YYYY" string with local components recovers the
 * original calendar date (getDate() = 8) and writes it as text — no further
 * timezone conversion possible.
 */
function toCellValue(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return ''
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds(), v.getMilliseconds()))
  }
  if (typeof v === 'number') return v   // preserve numeric type
  return String(v)
}

// ── Column helpers ─────────────────────────────────────────────────────────────

/**
 * True when >20 % of non-empty formatted values contain at least one letter.
 * Text columns are capped at MAX_COL_UNITS; numeric/date ones are not.
 */
function isAlphanumericColumn(nonEmptyStrs) {
  if (nonEmptyStrs.length === 0) return false
  let count = 0
  for (const s of nonEmptyStrs) { if (/[a-zA-Z]/.test(s)) count++ }
  return count / nonEmptyStrs.length > 0.2
}

/**
 * Column width in Excel units, based on DATA only (no header contribution).
 * Includes CELL_PADDING_UNITS so that the rightmost character is never clipped.
 *
 * @param {string[]} dataWidthStrs – toWidthString() of every data-row value
 */
function calcColumnWidth(dataWidthStrs) {
  const nonEmpty = dataWidthStrs.filter((s) => s !== '')
  if (nonEmpty.length === 0) return EMPTY_COL_UNITS

  const maxDataLen = Math.max(...nonEmpty.map((s) => s.length))
  const rawUnits = Math.ceil(maxDataLen * WIDTH_FACTOR) + CELL_PADDING_UNITS
  const cap = isAlphanumericColumn(nonEmpty) ? MAX_COL_UNITS : MAX_COL_UNITS
  return Math.max(MIN_COL_UNITS, Math.min(rawUnits, cap))
}

// ── Row height ─────────────────────────────────────────────────────────────────

/**
 * Estimate how many wrapped lines a string produces in a column of given width.
 *
 * @param {string} str
 * @param {number} colWidth – column width in Excel units
 */
function lineCount(str, colWidth) {
  if (!str) return 1
  // Effective characters that fit in one line at 14 pt (subtract cell padding)
  const charsPerLine = Math.max(1, Math.floor((colWidth - CELL_PADDING_UNITS) / WIDTH_FACTOR))
  return Math.ceil(str.length / charsPerLine)
}

/**
 * Estimate row height (pt) from the maximum wrapped-line count across all cells.
 *
 * @param {string[]} displayStrs – parallel toWidthString() values for each cell
 * @param {number[]} colWidths   – column widths in Excel units
 * @param {number}   minHeight   – minimum height in pt
 */
function estimateRowHeight(displayStrs, colWidths, minHeight = 24) {
  let maxLines = 1
  for (let i = 0; i < displayStrs.length; i++) {
    const lines = lineCount(displayStrs[i], colWidths[i] || MIN_COL_UNITS)
    if (lines > maxLines) maxLines = lines
  }
  return Math.max(minHeight, maxLines * LINE_HEIGHT_PT + 4)
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Build a formatted ExcelJS workbook from sheet data.
 *
 * @param {Array<{ name: string, headers: string[], rows: object[] }>} sheets
 * @returns {Promise<ExcelJS.Workbook>}
 */
export async function formatWorkbook(sheets) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Recovr'
  wb.lastModifiedBy = 'Recovr'
  wb.created = new Date()
  wb.modified = new Date()

  for (const { name, headers, rows } of sheets) {
    const safeName = String(name).replace(/[\\/*?:[\]]/g, '_').slice(0, 31)
    const ws = wb.addWorksheet(safeName)

    // ── 1. Column widths (data-driven only) ──────────────────────────────────
    const colWidths = headers.map((h) => {
      const strs = rows.map((r) => toWidthString(r[h]))
      return calcColumnWidth(strs)
    })

    ws.columns = headers.map((h, i) => ({ key: h, width: colWidths[i] }))

    // ── 2. Header row ────────────────────────────────────────────────────────
    const headerRow = ws.addRow(headers)

    // Dynamic header height: header labels may wrap in data-width columns
    const headerDisplayStrs = headers.map((h) => String(h))
    headerRow.height = estimateRowHeight(headerDisplayStrs, colWidths, 28)

    headerRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Calibri', size: FONT_SIZE, bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG_ARGB } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = ALL_BORDERS
    })

    // ── 3. Freeze row 1 ──────────────────────────────────────────────────────
    ws.views = [
      { state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' },
    ]

    // ── 4. Data rows ─────────────────────────────────────────────────────────
    for (const rowData of rows) {
      const cellValues = headers.map((h) => toCellValue(rowData[h]))
      const displayStrs = headers.map((h) => toWidthString(rowData[h]))

      const row = ws.addRow(cellValues)
      row.height = estimateRowHeight(displayStrs, colWidths)

      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Calibri', size: FONT_SIZE }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        cell.border = ALL_BORDERS

        // ── Prevent scientific notation for integer numbers ──────────────────
        // With ExcelJS "General" numFmt, Excel renders e.g. 183012714 as "1.83E+08"
        // when the column is narrower than the full digit string.
        // numFmt '0' forces the full integer display (shows ##### only if truly
        // too narrow, but our WIDTH_FACTOR + CELL_PADDING_UNITS prevents that).
        if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
          cell.numFmt = Number.isInteger(cell.value) ? '0' : 'General'
        } else if (cell.value instanceof Date) {
          cell.numFmt = 'dd-mm-yyyy'
        }
      })
    }

    // ── 5. Print titles ──────────────────────────────────────────────────────
    ws.pageSetup.printTitlesRow = '1:1'

    // Note: No extra blank rows are added.
    // Excel always provides rows up to 1,048,576 beyond the used range.
  }

  return wb
}

/**
 * Build a formatted workbook and write it to disk.
 *
 * @param {Array<{ name: string, headers: string[], rows: object[] }>} sheets
 * @param {string} filePath
 */
export async function buildAndWriteExcel(sheets, filePath) {
  const wb = await formatWorkbook(sheets)
  await wb.xlsx.writeFile(filePath)
}
