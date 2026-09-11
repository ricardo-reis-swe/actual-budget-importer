export interface ParsedTransaction {
  /** Zero-based position in the statement's original transaction order. */
  readonly position: number;
  /** Transaction date formatted as DD-MM-YYYY. */
  readonly date: string;
  readonly description: string;
  /** Signed monetary amount in euro cents. */
  readonly amountCents: number;
}

export interface BankParser {
  /** Stable internal identifier persisted with the statement. */
  readonly id: string;
  readonly name: string;

  /** Extracts transaction rows from PDF bytes that are already held in memory. */
  parse(pdf: Uint8Array): Promise<readonly ParsedTransaction[]>;
}
