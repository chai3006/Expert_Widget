// The local Expert service (`expert-cli serve`, Phase 6): token, Host and origin checks, schema
// validity of every response, and no CV text in any response.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCliEngine, parseArgs, type CliOptions } from '../packages/cli/src/cli.js';
import { startService, type RunningService } from '../packages/cli/src/serve.js';
import { HttpExpertApi } from '../packages/ui/src/httpApi.js';
import { ROOT, fixture } from './helpers/config.js';
import { schemaErrors } from './helpers/schemas.js';

let dir: string;
let service: RunningService;
const CV = fixture('cv', 'fields', 'nurse-de.txt');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'expert-service-'));
  writeFileSync(join(dir, 'Lebenslauf_Anna_Beispiel.txt'), CV);
  const opts = parseArgs(['serve', '--cv', join(dir, 'Lebenslauf_Anna_Beispiel.txt'), '--no-network']) as CliOptions;
  const { engine } = createCliEngine(opts, fetch, () => new Date(2026, 9, 15).getTime());
  service = await startService({ engine, port: 0, token: 'a'.repeat(48), allowOrigins: ['http://localhost:3000'], uiDir: join(ROOT, 'packages', 'ui', 'src'), exampleDir: join(ROOT, 'examples', 'expert-page') });
});
afterEach(async () => {
  await service.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = (path: string, init: RequestInit & { token?: string | null; origin?: string } = {}) => {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.token !== null) headers.Authorization = `Bearer ${init.token ?? service.token}`;
  if (init.origin) headers.Origin = init.origin;
  return fetch(`${service.url}${path}`, { ...init, headers });
};

describe('Expert service', () => {
  it('listens on 127.0.0.1 only', () => {
    const address = service.server.address();
    expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
  });

  it('refuses requests without the right token', async () => {
    expect((await call('/v1/health', { token: null })).status).toBe(401);
    expect((await call('/v1/health', { token: 'b'.repeat(48) })).status).toBe(401);
    expect((await call('/v1/health')).status).toBe(200);
  });

  it('refuses other origins and answers allowed ones with CORS headers', async () => {
    expect((await call('/v1/health', { origin: 'https://evil.example' })).status).toBe(403);
    const ok = await call('/v1/health', { origin: 'http://localhost:3000' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    const preflight = await fetch(`${service.url}/v1/view`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' } });
    expect(preflight.status).toBe(204);
  });

  it('refuses a foreign Host header (DNS rebinding)', async () => {
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      request({ host: '127.0.0.1', port: service.port, path: '/v1/health', headers: { Host: 'attacker.example', Authorization: `Bearer ${service.token}` } }, (res) => resolve(res.statusCode ?? 0)).end();
    });
    expect(status).toBe(403);
  });

  it('answers every endpoint with schema-valid documents and never with CV text', async () => {
    expect((await call('/v1/refresh', { method: 'POST' })).status).toBe(200);
    const bodies: string[] = [];
    const get = async (path: string) => {
      const res = await call(path);
      expect(res.status, path).toBe(200);
      const text = await res.text();
      bodies.push(text);
      return JSON.parse(text);
    };
    const profile = await get('/v1/profile');
    expect(schemaErrors('DomainProfile', profile)).toEqual([]);
    expect(profile.weights[0].domain).toBe('healthcare-nursing');
    const health = await get('/v1/health');
    expect(schemaErrors('SourceHealth', health.sources)).toEqual([]);
    const news = await get('/v1/news');
    for (const item of news.items) expect(schemaErrors('NewsItem', item)).toEqual([]);
    for (const s of news.companySignals) expect(schemaErrors('CompanySignal', s)).toEqual([]);
    const employers = await get('/v1/employers');
    for (const d of employers.domains) if (d.starterList) expect(schemaErrors('EmployerDirectory', d.starterList)).toEqual([]);
    await get('/v1/view');
    const all = bodies.join('\n');
    for (const cvText of ['Anna', 'Musterstadt', 'Intensivstation, Klinikum', 'Muttersprache', 'Kreiskrankenhaus']) expect(all, cvText).not.toContain(cvText);
    // The DomainProfile contract leaves out the file name (it often holds the person's name).
    expect(JSON.stringify(profile)).not.toContain('Lebenslauf_Anna_Beispiel');
  });

  it('checks feedback against the UserFeedback contract', async () => {
    const post = (body: unknown) => call('/v1/feedback', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    expect((await post({ schemaVersion: 1, action: 'seen', target: 'abcdef0123456789' })).status).toBe(204);
    expect((await post({ schemaVersion: 1, action: 'like', target: 'x' })).status).toBe(400);
    expect((await call('/v1/feedback', { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await call('/v1/feedback', { method: 'POST', body: 'x'.repeat(70_000) })).status).toBe(413);
  });

  it('serves the UI files and the example page, nothing outside them', async () => {
    expect((await fetch(`${service.url}/example/`)).status).toBe(200);
    expect((await fetch(`${service.url}/ui/styles.css`)).headers.get('content-type')).toContain('text/css');
    expect((await fetch(`${service.url}/ui/..%2F..%2F..%2Fpackage.json`)).status).toBe(404);
  });

  it('works with HttpExpertApi, the Expert page client', async () => {
    const api = new HttpExpertApi(service.url, service.token, (u, init) => fetch(u, init), 0);
    const view = await api.refresh();
    expect(view.data.profile?.weights[0].domain).toBe('healthcare-nursing');
    const manual = await api.setManualDomains([{ domain: 'social-work', weight: 1 }]);
    expect(manual.data.profile).toMatchObject({ source: 'manual', weights: [{ domain: 'social-work', weight: 100 }] });
    expect((await api.clearManualDomains()).data.profile?.source).toBe('auto');
    expect((await api.setWatchlistSearch(false)).ui.watchlistSearch).toBe(false);
    await expect(new HttpExpertApi(service.url, 'wrong', (u, init) => fetch(u, init), 0).getView()).rejects.toThrow('HTTP 401');
  });
});
