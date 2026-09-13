import { describe, expect, it, vi } from 'vitest';

import { PaperlessClient, PaperlessClientError } from '../src/paperless/paperless-client.js';

const configuration = {
  apiToken: 'synthetic-token',
  serverUrl: new URL('https://paperless.example.test/paperless'),
};

describe('PaperlessClient', () => {
  it('reads document metadata without exposing its token in the request URL', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 23,
      title: 'Synthetic statement',
      correspondent: 9,
      correspondent_name: 'Synthetic bank',
      created: '2026-01-31',
      original_file_name: 'synthetic.pdf',
    }), { status: 200 }));
    const client = new PaperlessClient(configuration, fetch);

    await expect(client.getDocument(23)).resolves.toEqual({
      id: 23,
      title: 'Synthetic statement',
      correspondentId: 9,
      correspondentName: 'Synthetic bank',
      documentDate: '2026-01-31',
      originalFilename: 'synthetic.pdf',
    });
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://paperless.example.test/paperless/api/documents/23/'),
      { headers: { Authorization: 'Token synthetic-token' } },
    );
  });

  it('retrieves the original PDF bytes in memory', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(Uint8Array.from([1, 2, 3]), { status: 200 }));
    const client = new PaperlessClient(configuration, fetch);

    await expect(client.getOriginalPdf(23)).resolves.toEqual(Uint8Array.from([1, 2, 3]));
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://paperless.example.test/paperless/api/documents/23/download/?original=true'),
      { headers: { Authorization: 'Token synthetic-token' } },
    );
  });

  it('resolves the correspondent name when document metadata only contains its ID', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 23,
        title: 'Synthetic statement',
        correspondent: 9,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 9, name: 'Synthetic bank' }), { status: 200 }));
    const client = new PaperlessClient(configuration, fetch);

    await expect(client.getDocument(23)).resolves.toMatchObject({
      correspondentId: 9,
      correspondentName: 'Synthetic bank',
    });
    expect(fetch).toHaveBeenLastCalledWith(
      new URL('https://paperless.example.test/paperless/api/correspondents/9/'),
      { headers: { Authorization: 'Token synthetic-token' } },
    );
  });

  it('returns a generic error for invalid identifiers, responses, and transport failures', async () => {
    const failed = new PaperlessClient(configuration, vi.fn().mockResolvedValue(new Response('private detail', { status: 401 })));
    await expect(failed.getDocument(23)).rejects.toEqual(new PaperlessClientError());

    const malformed = new PaperlessClient(configuration, vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 23 }), { status: 200 })));
    await expect(malformed.getDocument(23)).rejects.toEqual(new PaperlessClientError());

    const unavailable = new PaperlessClient(configuration, vi.fn().mockRejectedValue(new Error('token=secret')));
    await expect(unavailable.getOriginalPdf(0)).rejects.toEqual(new PaperlessClientError());
    await expect(unavailable.getOriginalPdf(23)).rejects.toEqual(new PaperlessClientError());
  });
});
