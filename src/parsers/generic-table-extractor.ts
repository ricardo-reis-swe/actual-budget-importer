export interface PositionedText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

export interface ExtractedTable {
  readonly columnAnchors: readonly number[];
  readonly rows: readonly (readonly string[])[];
}

export interface GenericTableExtractorOptions {
  /** Horizontal tolerance, in PDF points, used to cluster column starts. */
  readonly columnGap?: number;
  /** Vertical tolerance, in PDF points, used to group text into a row. */
  readonly rowTolerance?: number;
  /** Minimum fraction of rows in which a column start must occur. */
  readonly minimumColumnFraction?: number;
}

interface TextRow {
  readonly y: number;
  readonly chunks: PositionedText[];
}

const defaultOptions: Required<GenericTableExtractorOptions> = {
  columnGap: 10,
  rowTolerance: 3,
  minimumColumnFraction: 0.2,
};

/**
 * Reconstructs table-like rows from positioned PDF text. Callers are
 * responsible for obtaining the text from PDF bytes and interpreting columns.
 */
export function extractGenericTable(
  pages: readonly (readonly PositionedText[])[],
  options: GenericTableExtractorOptions = {},
): ExtractedTable {
  const settings = { ...defaultOptions, ...options };
  validateOptions(settings);

  const pageRows = pages.map((page) => groupIntoRows(page, settings.rowTolerance));
  const rows = pageRows.flat();
  const columnAnchors = findColumnAnchors(
    rows,
    settings.columnGap,
    settings.minimumColumnFraction,
  );

  return {
    columnAnchors,
    rows: rows.map((row) => rowToColumns(row, columnAnchors)),
  };
}

function validateOptions(options: Required<GenericTableExtractorOptions>): void {
  if (!Number.isFinite(options.columnGap) || options.columnGap <= 0) {
    throw new Error('columnGap must be a positive finite number.');
  }
  if (!Number.isFinite(options.rowTolerance) || options.rowTolerance < 0) {
    throw new Error('rowTolerance must be a non-negative finite number.');
  }
  if (
    !Number.isFinite(options.minimumColumnFraction) ||
    options.minimumColumnFraction <= 0 ||
    options.minimumColumnFraction > 1
  ) {
    throw new Error('minimumColumnFraction must be greater than 0 and at most 1.');
  }
}

function groupIntoRows(
  chunks: readonly PositionedText[],
  rowTolerance: number,
): readonly TextRow[] {
  const sortedChunks = chunks
    .filter((chunk) => chunk.text.trim().length > 0)
    .toSorted((left, right) => right.y - left.y || left.x - right.x);
  const rows: { y: number; chunks: PositionedText[] }[] = [];

  for (const chunk of sortedChunks) {
    const row = rows.find((candidate) => Math.abs(candidate.y - chunk.y) <= rowTolerance);
    if (row) {
      row.chunks.push(chunk);
    } else {
      rows.push({ y: chunk.y, chunks: [chunk] });
    }
  }

  return rows.map((row) => ({
    y: row.y,
    chunks: row.chunks.toSorted((left, right) => left.x - right.x),
  }));
}

function findColumnAnchors(
  rows: readonly TextRow[],
  columnGap: number,
  minimumColumnFraction: number,
): readonly number[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    for (const chunk of row.chunks) {
      const roundedX = Math.round(chunk.x / columnGap) * columnGap;
      counts.set(roundedX, (counts.get(roundedX) ?? 0) + 1);
    }
  }

  const clusters: { x: number; count: number }[] = [];
  for (const x of [...counts.keys()].toSorted((left, right) => left - right)) {
    const previous = clusters.at(-1);
    if (previous && x - previous.x <= columnGap) {
      previous.count += counts.get(x) ?? 0;
      previous.x = (previous.x + x) / 2;
    } else {
      clusters.push({ x, count: counts.get(x) ?? 0 });
    }
  }

  const threshold = Math.max(2, Math.ceil(rows.length * minimumColumnFraction));
  const anchors = clusters
    .filter((cluster) => cluster.count >= threshold)
    .map((cluster) => cluster.x)
    .toSorted((left, right) => left - right);

  return anchors.length > 0 ? anchors : [...counts.keys()].toSorted((left, right) => left - right);
}

function rowToColumns(row: TextRow, anchors: readonly number[]): readonly string[] {
  if (anchors.length === 0) {
    return [];
  }

  const columns = new Array<string>(anchors.length).fill('');
  for (const chunk of row.chunks) {
    const index = nearestAnchorIndex(chunk.x, anchors);
    columns[index] = columns[index] ? `${columns[index]} ${chunk.text}` : chunk.text;
  }

  while (columns.at(-1) === '') {
    columns.pop();
  }

  return columns.map((column) => column.trim());
}

function nearestAnchorIndex(x: number, anchors: readonly number[]): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [index, anchor] of anchors.entries()) {
    const distance = Math.abs(anchor - x);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}
