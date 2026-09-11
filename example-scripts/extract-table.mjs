#!/usr/bin/env node
/**
 * extract-table.js
 *
 * Extracts table-like rows from every page of a PDF and writes them to a CSV.
 *
 * How it works (no assumptions about a specific bank/layout):
 *   1. Reads the raw text of every page along with each text chunk's (x, y) position.
 *   2. Groups chunks into "rows" using their y position (chunks on the same
 *      horizontal line belong to the same row).
 *   3. Looks across the WHOLE document for x positions where text chunks
 *      commonly start -> these become the table's "columns".
 *   4. Places each chunk into the column whose start position it's closest to,
 *      and writes one CSV row per PDF row.
 *
 * Usage:
 *   node extract-table.js <input.pdf> [output.csv] [--gap=10] [--min-cols=2]
 *
 *   input.pdf     Path to the source PDF (required)
 *   output.csv    Path to write the CSV (default: <input>.csv)
 *   --gap=N       Column-clustering tolerance in points (default: 10)
 *   --min-cols=N  Skip rows with fewer than N non-empty columns (default: 1,
 *                 i.e. keep everything). Raise this to drop stray headers/
 *                 footers/page numbers that aren't really table rows.
 *   --y-tol=N     Vertical tolerance in points for grouping chunks into the
 *                 same row (default: 3)
 *   --min-fraction=N  A candidate column must start at roughly the same x
 *                 position on at least this fraction of rows to count as a
 *                 real column (default: 0.2). Lower it if a genuine column
 *                 is being missed; raise it if free-text fields are being
 *                 split into too many columns.
 *   --keep-cols=0,2,3,4  Only keep these 0-based column indices, in this
 *                 order, in the final CSV (default: keep all columns, in
 *                 detected order). Run once without this flag first to see
 *                 the detected column indices, then re-run with the ones
 *                 you actually want.
 *   --skip-rows=N Skip the first N detected rows entirely (useful when a
 *                 table's header wraps across multiple lines in the PDF,
 *                 producing several junk header rows instead of one).
 *   --header="Date,Description,Location,Amount"
 *                 Prepend exactly this single header row to the CSV
 *                 instead of whatever the PDF's own (possibly multi-line)
 *                 header looked like.
 *   --merge-cols=2-8  Merge detected column indices 2 through 8 (inclusive)
 *                 into a single column at position 2, joining their text
 *                 with a space. Useful when a free-text field (like a long
 *                 transaction description) gets split into several
 *                 columns because its words don't line up with any other
 *                 row. Applied BEFORE --keep-cols, so --keep-cols indices
 *                 should refer to the column numbers AFTER merging.
 *   --exclude-pattern="regex"
 *                 Drop any row whose full reconstructed text matches this
 *                 regex (case-insensitive). Handy for repeated letterhead/
 *                 address lines that show up mid-table on page breaks.
 *   --money-cols=3,4  Normalize these column indices (after merging) into
 *                 plain decimal numbers: strips currency symbols and
 *                 thousands separators, and handles either "1.234,56" or
 *                 "1,234.56" style numbers, plus a trailing "-" (a common
 *                 European banking convention for negative values).
 *                 Output is always plain, e.g. "1234.56" or "-1234.56".
 *   --force-sign="3:negative"  Force column index 3 (after merging) to be
 *                 negative (or "positive"). Useful for a statement that's
 *                 entirely one direction of money movement, e.g. a credit
 *                 card statement where every line is a charge.
 *   --sign-from-balance="3,4"  Column 3 is an amount, column 4 is a running
 *                 balance. For each row, compares this row's balance to the
 *                 previous row's balance: if the balance went up, the
 *                 amount is written as positive (money in); if it went
 *                 down, negative (money out). Add ",initialBalance" as a
 *                 third value if the statement doesn't include an opening
 *                 balance row, e.g. --sign-from-balance="3,4,5986.03".
 */

import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    const m = a.match(/^--([\w-]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
    else args._.push(a);
  }
  return args;
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Parses a money string in either European (1.234,56) or US (1,234.56)
// style, plus a trailing "-" for negative (common in Portuguese banking).
// Returns a plain JS number, or null if it doesn't look like a number.
function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Drop anything that isn't a digit, comma, period, minus, or space
  // (currency symbols, stray letters, etc.)
  s = s.replace(/[^0-9.,\-\s]/g, '');
  let negative = false;
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, '');
  }
  if (/^\s*-/.test(s)) {
    negative = true;
    s = s.replace(/^\s*-/, '');
  }
  s = s.replace(/\s+/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized = s;
  if (lastComma === -1 && lastDot === -1) {
    // plain integer
  } else if (lastComma > lastDot) {
    // comma is the decimal separator; dots (if any) are thousands separators
    normalized = s.split('.').join('').replace(',', '.');
  } else {
    // dot is the decimal separator; commas (if any) are thousands separators
    normalized = s.split(',').join('');
  }

  const num = parseFloat(normalized);
  if (Number.isNaN(num)) return null;
  return negative ? -num : num;
}

function formatAmount(num) {
  return num.toFixed(2);
}

async function extractChunks(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  const pages = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();

    const chunks = content.items
      .filter((item) => item.str && item.str.trim().length > 0)
      .map((item) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
      }));

    pages.push({ pageNum, chunks });
  }
  return pages;
}

function groupIntoRows(chunks, yTol) {
  // Sort top-to-bottom (PDF y grows upward, so descending y = reading order),
  // then left-to-right.
  const sorted = [...chunks].sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  for (const chunk of sorted) {
    let row = rows.find((r) => Math.abs(r.y - chunk.y) <= yTol);
    if (!row) {
      row = { y: chunk.y, chunks: [] };
      rows.push(row);
    }
    row.chunks.push(chunk);
  }
  // Keep chunks within a row left-to-right
  for (const row of rows) row.chunks.sort((a, b) => a.x - b.x);
  return rows;
}

function findColumnAnchors(allRows, gapTol, minFraction) {
  // Only the FIRST chunk on a line reliably marks where a real column
  // starts (later chunks on the same row are often just a variable-length
  // free-text field spilling further right, e.g. a merchant name followed
  // by a city). So candidate anchors come from every chunk, but we only
  // keep the ones that recur across many rows -- a real table column shows
  // up at roughly the same x on most rows; a stray wrapped word doesn't.
  const freq = new Map(); // roundedX -> count
  for (const row of allRows) {
    for (const c of row.chunks) {
      const rx = Math.round(c.x / gapTol) * gapTol;
      freq.set(rx, (freq.get(rx) || 0) + 1);
    }
  }

  // Cluster nearby rounded x values together, summing their counts.
  const sortedX = [...freq.keys()].sort((a, b) => a - b);
  const clusters = [];
  for (const x of sortedX) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.x <= gapTol) {
      last.count += freq.get(x);
      last.x = (last.x + x) / 2; // recenter
    } else {
      clusters.push({ x, count: freq.get(x) });
    }
  }

  const numRows = allRows.length || 1;
  const threshold = Math.max(2, Math.ceil(numRows * minFraction));
  const anchors = clusters
    .filter((c) => c.count >= threshold)
    .map((c) => c.x)
    .sort((a, b) => a - b);

  // Fallback: if nothing met the threshold (e.g. a very short/irregular
  // document), fall back to the old "every gap is a column" behavior so we
  // still produce output.
  if (anchors.length === 0) return sortedX;
  return anchors;
}

function nearestAnchorIndex(x, anchors) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const d = Math.abs(anchors[i] - x);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function rowToColumns(row, anchors) {
  const cols = new Array(anchors.length).fill('');
  for (const chunk of row.chunks) {
    const idx = nearestAnchorIndex(chunk.x, anchors);
    cols[idx] = cols[idx] ? `${cols[idx]} ${chunk.text}` : chunk.text;
  }
  // Trim trailing empty columns (common when a row uses fewer columns than
  // the widest row in the document)
  while (cols.length && cols[cols.length - 1] === '') cols.pop();
  return cols.map((c) => c.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args._[0];
  if (!inputPath) {
    console.error('Usage: node extract-table.js <input.pdf> [output.csv] [--gap=10] [--min-cols=1] [--y-tol=3]');
    process.exit(1);
  }
  const outputPath = args._[1] || inputPath.replace(/\.pdf$/i, '') + '.csv';
  const gapTol = args.gap ? Number(args.gap) : 10;
  const minCols = args['min-cols'] ? Number(args['min-cols']) : 1;
  const yTol = args['y-tol'] ? Number(args['y-tol']) : 3;

  const pages = await extractChunks(inputPath);

  // Build column anchors from the WHOLE document so columns line up
  // consistently across pages.
  const allRowsForAnchors = [];
  const pageRows = [];
  for (const { pageNum, chunks } of pages) {
    const rows = groupIntoRows(chunks, yTol);
    pageRows.push({ pageNum, rows });
    allRowsForAnchors.push(...rows);
  }
  const minFraction = args['min-fraction'] ? Number(args['min-fraction']) : 0.2;
  const anchors = findColumnAnchors(allRowsForAnchors, gapTol, minFraction);
  const keepCols = args['keep-cols']
    ? args['keep-cols'].split(',').map((s) => Number(s.trim()))
    : null;
  const skipRows = args['skip-rows'] ? Number(args['skip-rows']) : 0;
  const customHeader = args['header'] || null;
  const mergeCols = args['merge-cols']
    ? args['merge-cols'].split(',').map((range) => {
        const [start, end] = range.split('-').map((s) => Number(s.trim()));
        return { start, end: end === undefined ? start : end };
      })
    : [];
  const excludePattern = args['exclude-pattern']
    ? new RegExp(args['exclude-pattern'], 'i')
    : null;
  const moneyCols = args['money-cols']
    ? args['money-cols'].split(',').map((s) => Number(s.trim()))
    : [];
  const forceSign = args['force-sign']
    ? args['force-sign'].split(',').map((spec) => {
        const [idx, dir] = spec.split(':');
        return { idx: Number(idx.trim()), dir: dir.trim().toLowerCase() };
      })
    : [];
  let signFromBalance = null;
  let prevBalance = null;
  if (args['sign-from-balance']) {
    const parts = args['sign-from-balance'].split(',').map((s) => s.trim());
    signFromBalance = { amountIdx: Number(parts[0]), balanceIdx: Number(parts[1]) };
    if (parts[2] !== undefined) prevBalance = Number(parts[2]);
  }

  function applyMerges(cols) {
    if (mergeCols.length === 0) return cols;
    let result = [...cols];
    // Apply merges from rightmost to leftmost so earlier indices stay valid.
    const sortedMerges = [...mergeCols].sort((a, b) => b.start - a.start);
    for (const { start, end } of sortedMerges) {
      const merged = result
        .slice(start, end + 1)
        .filter((v) => v !== '')
        .join(' ');
      result.splice(start, end - start + 1, merged);
    }
    return result;
  }

  const csvLines = [];
  if (customHeader) csvLines.push(customHeader);
  let totalRows = 0;
  let rowIndex = 0;
  for (const { pageNum, rows } of pageRows) {
    for (const row of rows) {
      rowIndex++;
      if (rowIndex <= skipRows) continue;
      let cols = rowToColumns(row, anchors);
      if (excludePattern && excludePattern.test(cols.join(' '))) continue;
      cols = applyMerges(cols);

      for (const idx of moneyCols) {
        const num = parseAmount(cols[idx]);
        if (num !== null) cols[idx] = formatAmount(num);
      }
      for (const { idx, dir } of forceSign) {
        const num = parseAmount(cols[idx]);
        if (num !== null) {
          const signed = dir === 'negative' ? -Math.abs(num) : Math.abs(num);
          cols[idx] = formatAmount(signed);
        }
      }
      if (signFromBalance) {
        const { amountIdx, balanceIdx } = signFromBalance;
        const balVal = parseAmount(cols[balanceIdx]);
        if (balVal !== null) {
          const amtVal = parseAmount(cols[amountIdx]);
          if (amtVal !== null) {
            if (prevBalance !== null) {
              const diff = balVal - prevBalance;
              const sign = diff < 0 ? -1 : 1;
              cols[amountIdx] = formatAmount(sign * Math.abs(amtVal));
            } else {
              cols[amountIdx] = formatAmount(Math.abs(amtVal));
            }
          }
          prevBalance = balVal;
        }
      }

      const nonEmpty = cols.filter((c) => c !== '').length;
      if (nonEmpty < minCols) continue;
      if (keepCols) cols = keepCols.map((i) => cols[i] ?? '');
      csvLines.push(cols.map(csvEscape).join(','));
      totalRows++;
    }
  }

  fs.writeFileSync(outputPath, csvLines.join('\n') + '\n', 'utf8');
  console.error(`Pages processed: ${pages.length}`);
  console.error(`Columns detected: ${anchors.length}`);
  console.error(`Rows written: ${totalRows}`);
  console.error(`CSV written to: ${path.resolve(outputPath)}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
