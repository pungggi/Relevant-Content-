import type {
  EmbedFn,
  LedgerSymbol,
  VectorClient,
} from '../types/index.js';
import { buildEmbeddingInput } from '../utils/embed.js';

/**
 * Reads symbols from the SDL-MCP SQLite ledger (or any compatible
 * data source) and keeps the vector DB in sync.
 *
 * This corresponds to **Phase 1: Background Synchronization** in the
 * specification.  In production you would wire this up to a real
 * SQLite reader; here we expose a `LedgerReader` interface so the
 * concrete IO can be injected.
 */

/** Minimal contract for reading from the SDL-MCP SQLite ledger. */
export interface LedgerReader {
  /** Return symbols that were created or updated after `sinceEpochMs`. */
  getUpdatedSymbols(sinceEpochMs: number): Promise<LedgerSymbol[]>;
}

export class SCPIndexer {
  private readonly ledger: LedgerReader;
  private readonly vectorDb: VectorClient;
  private readonly embed: EmbedFn;

  /** Epoch-ms watermark: only index symbols updated after this point. */
  private watermark = 0;

  constructor(ledger: LedgerReader, vectorDb: VectorClient, embed: EmbedFn) {
    this.ledger = ledger;
    this.vectorDb = vectorDb;
    this.embed = embed;
  }

  /**
   * Pull new / updated symbols from the ledger and upsert their
   * embeddings into the vector store.
   *
   * Returns the number of symbols indexed in this pass.
   */
  async sync(): Promise<number> {
    const symbols = await this.ledger.getUpdatedSymbols(this.watermark);
    if (symbols.length === 0) return 0;

    let maxTs = this.watermark;

    for (const sym of symbols) {
      const text = buildEmbeddingInput(
        sym.symbolName,
        sym.kind,
        sym.signature,
        sym.summary,
      );
      const vector = await this.embed(text);
      await this.vectorDb.upsert(sym.id, vector);

      if (sym.updatedAt > maxTs) maxTs = sym.updatedAt;
    }

    this.watermark = maxTs;
    return symbols.length;
  }

  /** Reset the watermark so the next `sync()` re-indexes everything. */
  resetWatermark(): void {
    this.watermark = 0;
  }
}
