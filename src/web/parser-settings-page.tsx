import { useEffect, useState } from 'react';

interface ParserSetting {
  enabled: boolean;
  id: string;
  name: string;
}

interface CorrespondentMapping {
  correspondentId: number;
  correspondentName: string | null;
  parserId: string | null;
}

interface ParserSettingsResponse {
  correspondents: CorrespondentMapping[];
  parsers: ParserSetting[];
}

export function ParserSettingsPage() {
  const [settings, setSettings] = useState<ParserSettingsResponse>();
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState('');

  const load = () => {
    void fetch('/api/parser-settings')
      .then(async (response) => {
        if (!response.ok) throw new Error('Parser settings could not be loaded.');
        return response.json() as Promise<ParserSettingsResponse>;
      })
      .then((loaded) => { setSettings(loaded); setError(undefined); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Parser settings could not be loaded.'));
  };

  useEffect(load, []);

  const setEnabled = async (parser: ParserSetting, enabled: boolean) => {
    setError(undefined);
    const response = await fetch(`/api/parser-settings/parsers/${encodeURIComponent(parser.id)}`, {
      body: JSON.stringify({ enabled }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    });
    if (!response.ok) {
      setError((await response.json() as { message?: string }).message ?? 'The parser setting could not be saved.');
      return;
    }
    setSettings((current) => current && ({
      ...current,
      parsers: current.parsers.map((item) => item.id === parser.id ? { ...item, enabled } : item),
    }));
    setFeedback(`${parser.name} is now ${enabled ? 'shown in' : 'hidden from'} parser dropdowns.`);
  };

  const setMapping = async (correspondentId: number, parserId: string) => {
    setError(undefined);
    const response = await fetch(`/api/parser-settings/correspondents/${correspondentId}`, {
      body: JSON.stringify({ parserId: parserId || null }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    });
    if (!response.ok) {
      setError((await response.json() as { message?: string }).message ?? 'The correspondent rule could not be saved.');
      return;
    }
    setSettings((current) => current && ({
      ...current,
      correspondents: current.correspondents.map((item) => item.correspondentId === correspondentId ? { ...item, parserId: parserId || null } : item),
    }));
    setFeedback(parserId ? 'Correspondent matching rule saved.' : 'Correspondent matching rule removed.');
  };

  if (error && !settings) return <main><p role="alert">{error}</p></main>;
  if (!settings) return <main><p>Loading parser settings…</p></main>;

  return <main>
    <header className="page-heading"><p className="eyebrow">Configuration</p><h1>Parser settings</h1><p>Choose which parsers appear in selection lists and match Paperless-ngx correspondents automatically.</p></header>
    {error && <p role="alert">{error}</p>}
    {feedback && <p className="rules-feedback" role="status">{feedback}</p>}
    <section className="settings-panel" aria-labelledby="available-parsers-heading">
      <h2 id="available-parsers-heading">Parser dropdowns</h2>
      <p>Hidden parsers remain installed and keep working for existing statements and correspondent rules.</p>
      <ul className="settings-list">{settings.parsers.map((parser) => <li key={parser.id}>
        <span><strong>{parser.name}</strong><small>{parser.id}</small></span>
        <label className="toggle-label"><input type="checkbox" checked={parser.enabled} onChange={(event) => void setEnabled(parser, event.target.checked)} /> Show in dropdowns</label>
      </li>)}</ul>
    </section>
    <section className="settings-panel" aria-labelledby="correspondent-rules-heading">
      <h2 id="correspondent-rules-heading">Paperless correspondent matching</h2>
      <p>When a new document arrives, its correspondent selects the assigned parser automatically. Correspondents appear here after the app has seen them.</p>
      {settings.correspondents.length === 0 ? <p>No Paperless correspondents have been seen yet.</p> : <ul className="settings-list">{settings.correspondents.map((correspondent) => <li key={correspondent.correspondentId}>
        <span><strong>{correspondent.correspondentName ?? 'Correspondent name unavailable'}</strong></span>
        <label>Parser<select value={correspondent.parserId ?? ''} onChange={(event) => void setMapping(correspondent.correspondentId, event.target.value)}>
          <option value="">Ask each time</option>
          {settings.parsers.map((parser) => <option key={parser.id} value={parser.id}>{parser.name}{parser.enabled ? '' : ' (hidden)'}</option>)}
        </select></label>
      </li>)}</ul>}
    </section>
  </main>;
}
