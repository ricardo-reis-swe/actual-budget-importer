import { useEffect, useMemo, useRef, useState } from 'react';

import { GroupedParserSelect } from './grouped-parser-select.js';

interface ParserSetting {
  countryCode: string;
  countryName: string;
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
  setupComplete: boolean;
}

interface CountryGroup {
  code: string;
  name: string;
  parsers: ParserSetting[];
}

function CountryToggle({ checked, indeterminate, label, onChange }: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return <label className="country-toggle">
    <input ref={input} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}</span>
  </label>;
}

export function ParserSettingsPage({ initialSetup = false, onSetupComplete }: {
  initialSetup?: boolean;
  onSetupComplete?(): void;
}) {
  const [settings, setSettings] = useState<ParserSettingsResponse>();
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);

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

  const countries = useMemo(() => {
    const grouped = new Map<string, CountryGroup>();
    for (const parser of settings?.parsers ?? []) {
      const group = grouped.get(parser.countryCode) ?? { code: parser.countryCode, name: parser.countryName, parsers: [] };
      group.parsers.push(parser);
      grouped.set(parser.countryCode, group);
    }
    return [...grouped.values()]
      .map((country) => ({ ...country, parsers: country.parsers.sort((left, right) => left.name.localeCompare(right.name)) }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [settings]);

  const setEnabled = (parserIds: readonly string[], enabled: boolean) => {
    const changed = new Set(parserIds);
    setSettings((current) => current && ({
      ...current,
      parsers: current.parsers.map((parser) => changed.has(parser.id) ? { ...parser, enabled } : parser),
    }));
    setFeedback('');
  };

  const saveSelection = async () => {
    if (!settings) return;
    setSaving(true);
    setError(undefined);
    const enabledParserIds = settings.parsers.filter((parser) => parser.enabled).map((parser) => parser.id);
    try {
      const response = await fetch('/api/parser-settings/selection', {
        body: JSON.stringify({ enabledParserIds }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      });
      if (!response.ok) {
        setError((await response.json() as { message?: string }).message ?? 'The parser selection could not be saved.');
        return;
      }
      setSettings((current) => current && ({ ...current, setupComplete: true }));
      setFeedback('Parser selection saved.');
      if (initialSetup) onSetupComplete?.();
    } catch {
      setError('The parser selection could not be saved.');
    } finally {
      setSaving(false);
    }
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
    <header className="page-heading">
      <p className="eyebrow">{initialSetup ? 'Welcome' : 'Configuration'}</p>
      <h1>{initialSetup ? 'Choose your bank parsers' : 'Parser settings'}</h1>
      <p>{initialSetup
        ? 'Select the countries and individual bank parsers you want to see. You can change this later in Parser settings.'
        : 'Choose which parsers appear in selection lists and match Paperless-ngx correspondents automatically.'}</p>
    </header>
    {error && <p role="alert">{error}</p>}
    {feedback && <p className="rules-feedback" role="status">{feedback}</p>}
    <section className="settings-panel" aria-labelledby="available-parsers-heading">
      <h2 id="available-parsers-heading">Available parsers</h2>
      <p>Select a country to change its full group, then adjust individual banks if needed. Hidden parsers still work for existing statements and correspondent rules.</p>
      <div className="parser-country-list">{countries.map((country) => {
        const enabledCount = country.parsers.filter((parser) => parser.enabled).length;
        return <section className="parser-country" key={country.code}>
          <div className="parser-country-heading">
            <CountryToggle
              checked={enabledCount === country.parsers.length}
              indeterminate={enabledCount > 0 && enabledCount < country.parsers.length}
              label={country.name}
              onChange={(enabled) => setEnabled(country.parsers.map((parser) => parser.id), enabled)}
            />
            <small>{enabledCount} of {country.parsers.length} selected</small>
          </div>
          <ul className="parser-country-parsers">{country.parsers.map((parser) => <li key={parser.id}>
            <label className="parser-option">
              <input type="checkbox" checked={parser.enabled} onChange={(event) => setEnabled([parser.id], event.target.checked)} />
              <span>{parser.name}</span>
            </label>
          </li>)}</ul>
        </section>;
      })}</div>
      <div className="settings-actions">
        <span>{settings.parsers.filter((parser) => parser.enabled).length} of {settings.parsers.length} parsers selected</span>
        <button type="button" disabled={saving} onClick={() => void saveSelection()}>{saving ? 'Saving…' : initialSetup ? 'Save and continue' : 'Save parser selection'}</button>
      </div>
    </section>
    {!initialSetup && <section className="settings-panel" aria-labelledby="correspondent-rules-heading">
      <h2 id="correspondent-rules-heading">Paperless correspondent matching</h2>
      <p>When a new document arrives, its correspondent selects the assigned parser automatically. Correspondents appear here after the app has seen them.</p>
      {settings.correspondents.length === 0 ? <p>No Paperless correspondents have been seen yet.</p> : <ul className="settings-list">{settings.correspondents.map((correspondent) => <li key={correspondent.correspondentId}>
        <span><strong>{correspondent.correspondentName ?? 'Correspondent name unavailable'}</strong></span>
        <label>Parser<GroupedParserSelect ariaLabel={`Parser for ${correspondent.correspondentName ?? `correspondent ${correspondent.correspondentId}`}`} emptyLabel="Ask each time" parsers={settings.parsers} value={correspondent.parserId ?? ''} onChange={(value) => void setMapping(correspondent.correspondentId, value)} /></label>
      </li>)}</ul>}
    </section>}
  </main>;
}
