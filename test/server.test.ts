import { describe, expect, it, vi } from 'vitest';

import { buildServer, type ApplicationLogger } from '../src/server.js';

describe('server baseline', () => {
  it('reports a generic healthy status after checking the database', async () => {
    const checkHealth = vi.fn();
    const app = buildServer({ database: { checkHealth } });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(checkHealth).toHaveBeenCalledOnce();
    await app.close();
  });

  it('returns no database details when the health check fails', async () => {
    const logger: ApplicationLogger = { error: vi.fn() };
    const app = buildServer({
      database: { checkHealth: () => { throw new Error('password=secret'); } },
      logger,
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable' });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'synchronization',
      status: 'failed',
    }));
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('secret');
    await app.close();
  });

  it('returns a sanitized diagnostic response for an unexpected endpoint error', async () => {
    const logger: ApplicationLogger = { error: vi.fn() };
    const app = buildServer({ database: { checkHealth: () => undefined }, logger });
    app.get('/test-error', () => { throw new Error('token=private'); });

    const response = await app.inject({ method: 'GET', url: '/test-error' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      message: expect.stringContaining('contact support with reference'),
    });
    expect(response.body).not.toContain('private');
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('private');
    await app.close();
  });
});
