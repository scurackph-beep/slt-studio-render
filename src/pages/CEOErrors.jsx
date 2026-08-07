import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchCeoError,
  fetchCeoErrors,
  refreshCeoProviderDiagnostics,
  updateCeoError,
} from '../lib/api-client';
import './CEOErrors.css';

const FILTERS = [
  ['open', 'Open'],
  ['resolved', 'Resolved'],
  ['provider', 'Provider'],
  ['credits', 'Credits'],
  ['storage', 'Storage'],
  ['database', 'Database'],
  ['openai', 'OpenAI'],
  ['video', 'Video'],
  ['image', 'Image'],
];

const STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'IGNORED'];

function displayDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function CEOErrors() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [incidents, setIncidents] = useState([]);
  const [summary, setSummary] = useState({ total: 0, status: {}, category: {} });
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('Loading incidents...');
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState([]);

  const load = useCallback(async () => {
    setBusy(true);
    const result = await fetchCeoErrors({ filter, search, limit: 250 });
    if (result.ok) {
      setIncidents(result.data?.incidents || []);
      setSummary(result.data?.summary || { total: 0, status: {}, category: {} });
      setStatus(`${result.data?.total || 0} incidents shown.`);
      setSelected((current) => {
        if (!current?.incidentId) return current;
        return result.data?.incidents?.find((item) => item.incidentId === current.incidentId) || current;
      });
    } else setStatus(result.message || 'Incidents could not be loaded. CEO mode is required.');
    setBusy(false);
  }, [filter, search]);

  useEffect(() => {
    const timer = window.setTimeout(load, 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openIncident = async (incidentId) => {
    const result = await fetchCeoError(incidentId);
    if (result.ok) {
      setSelected(result.data?.incident || null);
      setNote(result.data?.incident?.metadata?.ceoNote || '');
    } else setStatus(result.message || 'Incident detail could not be loaded.');
  };

  const changeStatus = async (nextStatus) => {
    if (!selected?.incidentId) return;
    setBusy(true);
    const result = await updateCeoError(selected.incidentId, nextStatus, note);
    if (result.ok) {
      setSelected(result.data?.incident || selected);
      setStatus(result.data?.message || `Incident marked ${nextStatus}.`);
      await load();
    } else setStatus(result.message || 'Incident could not be updated.');
    setBusy(false);
  };

  const refreshProviders = async () => {
    setBusy(true);
    setStatus('Refreshing Runway and Replicate diagnostics...');
    const result = await refreshCeoProviderDiagnostics('all');
    if (result.ok) {
      setDiagnostics(result.data?.diagnostics || []);
      setStatus('Provider diagnostics refreshed without exposing credentials.');
    } else setStatus(result.message || 'Provider diagnostics could not be refreshed.');
    setBusy(false);
  };

  return (
    <div className="ceo-errors">
      <header className="ceo-errors-header">
        <div><p>Sweet Little Trauma · CEO</p><h1>Errors & incidents</h1><span>Technical diagnostics, reports, releases and compensation.</span></div>
        <div><button type="button" onClick={() => navigate('/ceo')}>Dashboard</button><button type="button" disabled={busy} onClick={refreshProviders}>Refresh providers</button></div>
      </header>

      <section className="ceo-errors-summary" aria-label="Incident summary">
        <div><span>Total</span><strong>{summary.total || 0}</strong></div>
        <div><span>Open</span><strong>{summary.status?.OPEN || 0}</strong></div>
        <div><span>Investigating</span><strong>{summary.status?.INVESTIGATING || 0}</strong></div>
        <div><span>Resolved</span><strong>{summary.status?.RESOLVED || 0}</strong></div>
      </section>

      <div className="ceo-errors-filters">
        <label><span>Filter</span><select value={filter} onChange={(event) => setFilter(event.target.value)}>{FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Search IDs, provider, user or model</span><input value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <button type="button" disabled={busy} onClick={load}>Refresh list</button>
      </div>

      {diagnostics.length ? <section className="ceo-provider-diagnostics">{diagnostics.map((item) => <div key={item.provider}><strong>{item.provider}</strong><span>{item.status}</span><p>{item.customerMessage}</p><small>{displayDate(item.checkedAt)}</small></div>)}</section> : null}

      <div className="ceo-errors-workspace">
        <section className="ceo-errors-list">
          <table>
            <thead><tr><th>Incident</th><th>Code</th><th>System</th><th>Provider / model</th><th>Credits</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>{incidents.map((item) => (
              <tr key={item.incidentId} className={selected?.incidentId === item.incidentId ? 'is-selected' : ''} onClick={() => openIncident(item.incidentId)}>
                <td><strong>{item.incidentId}</strong>{item.reported ? <small>Reported by user</small> : null}</td>
                <td>{item.errorCode}<small>{item.errorName}</small></td>
                <td>{item.category}<small>{item.modality || '—'}</small></td>
                <td>{item.provider || 'SLT'}<small>{item.model || '—'}</small></td>
                <td>{item.creditsReserved || 0}<small>{item.reservationReleased ? 'Released' : 'Not released'}</small></td>
                <td><span className={`ceo-error-status is-${String(item.status || '').toLowerCase()}`}>{item.status}</span></td>
                <td>{displayDate(item.createdAt)}</td>
              </tr>
            ))}</tbody>
          </table>
          {!incidents.length ? <p className="ceo-errors-empty">No incidents match this filter.</p> : null}
        </section>

        <aside className="ceo-error-detail">
          {selected ? <>
            <div className="ceo-error-detail-head"><div><p>{selected.category}</p><h2>{selected.incidentId}</h2></div><span>{selected.errorCode}</span></div>
            <p className="ceo-error-customer">{selected.clientVisibleMessage || selected.customerMessage}</p>
            <dl>
              <div><dt>Root diagnosis</dt><dd>{selected.technicalMessage || '—'}</dd></div>
              <div><dt>Provider response</dt><dd>{selected.sanitizedProviderError || '—'}</dd></div>
              <div><dt>User / tenant</dt><dd>{selected.userId || '—'} / {selected.tenantId || '—'}</dd></div>
              <div><dt>Job / batch</dt><dd>{selected.jobId || '—'} / {selected.batchId || '—'}</dd></div>
              <div><dt>Reservation</dt><dd>{selected.reservationId || '—'} · {selected.reservationReleased ? 'released' : 'not released'}</dd></div>
              <div><dt>Route</dt><dd>{selected.route || '—'}</dd></div>
            </dl>
            <label><span>CEO note</span><textarea rows="4" value={note} onChange={(event) => setNote(event.target.value)} /></label>
            <div className="ceo-error-status-actions">{STATUSES.map((item) => <button type="button" key={item} disabled={busy || selected.status === item} onClick={() => changeStatus(item)}>{item}</button>)}</div>
          </> : <div className="ceo-errors-empty"><strong>Select an incident</strong><p>Technical details are sanitized before they reach this screen.</p></div>}
        </aside>
      </div>
      <footer>{status}</footer>
    </div>
  );
}
