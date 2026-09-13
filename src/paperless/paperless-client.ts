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
    const document = parseDocument(documentId, body);
    if (document.correspondentId !== null && document.correspondentName === null) {
      return { ...document, correspondentName: await this.getCorrespondentName(document.correspondentId) };
    }
    return document;
  }

  async getCorrespondentName(correspondentId: number): Promise<string> {
    if (!Number.isSafeInteger(correspondentId) || correspondentId < 1) throw new PaperlessClientError();
    const response = await this.requestUrl(this.apiUrl(`correspondents/${correspondentId}/`));
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PaperlessClientError();
    }
    if (!isRecord(body) || body.id !== correspondentId || optionalString(body.name) === null) {
      throw new PaperlessClientError();
    }
    return optionalString(body.name)!;
  }

  async getOriginalPdf(documentId: number): Promise<Uint8Array> {
    const response = await this.request(documentId, 'download/?original=true');
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request(documentId: number, suffix: string): Promise<Response> {
    if (!Number.isSafeInteger(documentId) || documentId < 1) {
      throw new PaperlessClientError();
    }
    return this.requestUrl(this.documentUrl(documentId, suffix));
  }

  private async requestUrl(url: URL): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetch(url, {
        headers: { Authorization: `Token ${this.configuration.apiToken}` },
      });
    } catch {
      throw new PaperlessClientError();
    }
    if (!response.ok) throw new PaperlessClientError();
    return response;
  }

  private documentUrl(documentId: number, suffix: string): URL {
    const root = this.apiUrl(`documents/${documentId}/`);
    const [path, query] = suffix.split('?', 2);
    root.pathname = `${root.pathname}${path}`;
    root.search = query ? `?${query}` : '';
    return root;
  }

  private apiUrl(path: string): URL {
    const root = new URL(this.configuration.serverUrl);
    root.pathname = `${root.pathname.replace(/\/$/, '')}/api/${path}`;
    root.search = '';
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
