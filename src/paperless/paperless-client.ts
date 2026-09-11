export interface PaperlessDocument {
  correspondentId: number | null;
  correspondentName: string | null;
  documentDate: string | null;
  id: number;
  originalFilename: string | null;
  title: string;
}

export class PaperlessClientError extends Error {
  constructor() {
    super('Paperless-ngx request failed.');
    this.name = 'PaperlessClientError';
  }
}

export interface PaperlessClientConfiguration {
  apiToken: string;
  serverUrl: URL;
}

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class PaperlessClient {
  constructor(
    private readonly configuration: PaperlessClientConfiguration,
    private readonly fetch: Fetch = globalThis.fetch,
  ) {}

  async getDocument(documentId: number): Promise<PaperlessDocument> {
    const response = await this.request(documentId, '');
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PaperlessClientError();
    }
    return parseDocument(documentId, body);
  }

  async getOriginalPdf(documentId: number): Promise<Uint8Array> {
    const response = await this.request(documentId, 'download/?original=true');
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request(documentId: number, suffix: string): Promise<Response> {
    if (!Number.isSafeInteger(documentId) || documentId < 1) {
      throw new PaperlessClientError();
    }
    let response: Response;
    try {
      response = await this.fetch(this.documentUrl(documentId, suffix), {
        headers: { Authorization: `Token ${this.configuration.apiToken}` },
      });
    } catch {
      throw new PaperlessClientError();
    }
    if (!response.ok) throw new PaperlessClientError();
    return response;
  }

  private documentUrl(documentId: number, suffix: string): URL {
    const root = new URL(this.configuration.serverUrl);
    const [path, query] = suffix.split('?', 2);
    root.pathname = `${root.pathname.replace(/\/$/, '')}/api/documents/${documentId}/${path}`;
    root.search = query ? `?${query}` : '';
    return root;
  }
}

function parseDocument(requestedId: number, body: unknown): PaperlessDocument {
  if (!isRecord(body) || body.id !== requestedId || typeof body.title !== 'string') {
    throw new PaperlessClientError();
  }
  const correspondentId = positiveInteger(body.correspondent);
  return {
    correspondentId,
    correspondentName: optionalString(body.correspondent_name),
    documentDate: optionalString(body.created),
    id: body.id,
    originalFilename: optionalString(body.original_file_name),
    title: body.title,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
}
