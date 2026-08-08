import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useVideoStudioReadModel from '../hooks/useVideoStudioReadModel';
import './VideoStudioV2Preview.css';
import './VideoStudioNext.css';

const COLLECTIONS = [
  { id: 'Projects', key: 'projects' },
  { id: 'Assets', key: 'assets' },
  { id: 'History', key: 'history' },
  { id: 'Jobs', key: 'jobs' },
];

function recordTitle(record, collection) {
  if (!record) return 'Nothing selected';
  return record.title
    || record.name
    || record.originalName
    || record.original_name
    || `${collection.slice(0, -1)} ${String(record.id || '').slice(-8)}`;
}

function recordMeta(record) {
  if (!record) return '';
  return [record.kind || record.mediaType, record.provider, record.status || record.state]
    .filter(Boolean)
    .join(' · ');
}

function recordMediaUrl(record) {
  return record?.publicUrl
    || record?.public_url
    || record?.outputUrl
    || record?.previewUrl
    || record?.result?.outputUrl
    || record?.result?.publicUrl
    || '';
}

function isVideoRecord(record, url) {
  const kind = String(record?.kind || record?.mediaType || record?.contentType || '').toLowerCase();
  return kind.includes('video') || /\.(mp4|mov|webm)(?:$|\?)/i.test(url);
}

function normalizedStatus(record) {
  const value = String(record?.status || record?.state || 'queued').toLowerCase();
  if (value.includes('complete') || value.includes('success')) return 'completed';
  if (value.includes('fail') || value.includes('error')) return 'failed';
  if (value.includes('process') || value.includes('progress') || value.includes('running')) return 'processing';
  if (value.includes('cancel')) return 'failed';
  return 'queued';
}

function statusLabel(record) {
  const status = normalizedStatus(record);
  if (status === 'processing') return 'Processing';
  if (status === 'completed') return 'Completed';
  if (status === 'failed') return 'Error';
  return 'Pending';
}

function statusProgress(record) {
  const numeric = Number(record?.progress);
  if (Number.isFinite(numeric)) return Math.min(100, Math.max(0, numeric));
  const status = normalizedStatus(record);
  if (status === 'completed') return 100;
  if (status === 'processing') return 55;
  return 0;
}

function dateLabel(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function studioHref(location, mode) {
  const params = new URLSearchParams(location.search);
  if (mode) params.set('studio', mode);
  else params.delete('studio');
  const search = params.toString();
  return `${location.pathname}${search ? `?${search}` : ''}`;
}

export default function VideoStudioNext() {
  const location = useLocation();
  const [leftTab, setLeftTab] = useState('Projects');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [inspectorTab, setInspectorTab] = useState('System');
  const [previewFit, setPreviewFit] = useState('contain');
  const { data, errors, loading, lastUpdatedAt, refresh } = useVideoStudioReadModel();

  const collection = COLLECTIONS.find((item) => item.id === leftTab) || COLLECTIONS[0];
  const collectionItems = useMemo(
    () => data[collection.key] || [],
    [collection.key, data],
  );
  const visibleItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return collectionItems;
    return collectionItems.filter((record) => (
      `${recordTitle(record, leftTab)} ${recordMeta(record)}`.toLowerCase().includes(term)
    ));
  }, [collectionItems, leftTab, query]);

  useEffect(() => {
    if (visibleItems.some((item) => item.id === selectedId)) return;
    setSelectedId(visibleItems[0]?.id || '');
  }, [selectedId, visibleItems]);

  const selectedRecord = visibleItems.find((item) => item.id === selectedId) || visibleItems[0] || null;
  const mediaUrl = recordMediaUrl(selectedRecord);
  const jobs = data.jobs || [];
  const activeJobs = jobs.filter((job) => ['queued', 'processing'].includes(normalizedStatus(job))).length;
  const wallet = data.wallet || {};
  const errorMessage = Object.values(errors).filter(Boolean).join(' · ');

  return (
    <div className="video-v2 video-next" data-studio-mode="next">
      <header className="video-v2-topbar">
        <div className="video-v2-title-group">
          <p>Sweet Little Trauma</p>
          <h1>Video Studio</h1>
          <span>Architecture connection / read-only</span>
        </div>
        <div className="video-v2-top-actions">
          <span className="video-v2-simulated-label">Live data · no generation</span>
          <Link className="video-v2-text-button" to={studioHref(location, '')}>Current studio</Link>
          <Link className="video-v2-text-button" to={studioHref(location, 'v2')}>V2 mockup</Link>
          <button type="button" className="video-v2-primary-button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      <aside className="video-v2-left" aria-label="Live workspace browser">
        <div className="video-v2-panel-head">
          <span>Workspace</span>
          <span>{collectionItems.length}</span>
        </div>
        <div className="video-v2-left-tabs" role="tablist" aria-label="Live workspace collections">
          {COLLECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={leftTab === item.id}
              className={leftTab === item.id ? 'is-active' : ''}
              onClick={() => {
                setLeftTab(item.id);
                setQuery('');
                setSelectedId('');
              }}
            >
              {item.id}
            </button>
          ))}
        </div>
        <label className="video-v2-search">
          <span className="sr-only">Search {leftTab}</span>
          <input value={query} type="search" placeholder={`Search ${leftTab.toLowerCase()}`} onChange={(event) => setQuery(event.target.value)} />
          <span aria-hidden="true">/</span>
        </label>
        <div className="video-v2-library-list">
          {visibleItems.length ? visibleItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`video-v2-library-row ${selectedRecord?.id === item.id ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <span className={`video-v2-library-swatch is-${normalizedStatus(item) === 'failed' ? 'red' : 'blue'}`} aria-hidden="true" />
              <span>
                <strong>{recordTitle(item, leftTab)}</strong>
                <small>{recordMeta(item) || dateLabel(item.createdAt || item.created_at)}</small>
              </span>
              <span className="video-v2-row-menu" aria-hidden="true">...</span>
            </button>
          )) : (
            <p className="video-next-empty-list">{loading ? 'Loading live data...' : `No ${leftTab.toLowerCase()} found.`}</p>
          )}
        </div>
        <div className="video-v2-left-footer">
          <p>Read-only connection</p>
          <p>{data.assets.length} assets · {data.projects.length} projects</p>
        </div>
      </aside>

      <main className="video-v2-canvas-section">
        <div className="video-v2-canvas-toolbar">
          <div><button type="button" className="is-active" onClick={() => setPreviewFit((value) => value === 'contain' ? 'cover' : 'contain')}>{previewFit === 'contain' ? 'Fit preview' : 'Fill preview'}</button></div>
          <div><span>{leftTab} / {recordTitle(selectedRecord, leftTab)}</span></div>
        </div>
        <section className="video-v2-monitor" aria-label="Stored asset preview">
          <div className="video-v2-monitor-stage">
            {mediaUrl ? (
              isVideoRecord(selectedRecord, mediaUrl)
                ? <video className="video-next-media" src={mediaUrl} controls preload="metadata" style={{ objectFit: previewFit }} />
                : <img src={mediaUrl} alt={recordTitle(selectedRecord, leftTab)} style={{ objectFit: previewFit }} />
            ) : (
              <div className="video-next-monitor-empty">
                <strong>{selectedRecord ? recordTitle(selectedRecord, leftTab) : 'No stored media selected'}</strong>
                <span>{selectedRecord ? recordMeta(selectedRecord) || 'Metadata record' : 'Choose a stored asset or completed job.'}</span>
              </div>
            )}
            <div className="video-v2-monitor-frame" aria-hidden="true" />
            <p className="video-v2-take-label">Persistent data</p>
            <p className="video-v2-safe-frame">Read only</p>
          </div>
          <div className="video-v2-player-controls">
            <span>{mediaUrl ? 'Stored asset available' : 'No playable URL on this record'}</span>
            <span>{dateLabel(selectedRecord?.createdAt || selectedRecord?.created_at)}</span>
          </div>
        </section>
      </main>

      <aside className="video-v2-right" aria-label="Architecture status">
        <div className="video-v2-right-tabs">
          {['System', 'Selection', 'Credits'].map((tab) => <button key={tab} type="button" className={inspectorTab === tab ? 'is-active' : ''} onClick={() => setInspectorTab(tab)}>{tab}</button>)}
        </div>
        {inspectorTab === 'Selection' ? <div className="video-v2-inspector-content">
          <label className="video-v2-field">
            <span>Selected record</span>
            <input value={recordTitle(selectedRecord, leftTab)} readOnly />
          </label>
          <label className="video-v2-field">
            <span>Record type</span>
            <input value={selectedRecord?.kind || selectedRecord?.mediaType || leftTab} readOnly />
          </label>
          <label className="video-v2-field">
            <span>Status</span>
            <input value={selectedRecord?.status || selectedRecord?.state || 'Stored metadata'} readOnly />
          </label>
          <label className="video-v2-field">
            <span>Provider</span>
            <input value={selectedRecord?.provider || 'Not applicable'} readOnly />
          </label>
        </div> : null}
        {inspectorTab === 'System' ? <div className="video-v2-inspector-content"><div className="video-next-system-list">
            <p><span>Projects</span><strong>{data.projects.length}</strong></p>
            <p><span>Assets</span><strong>{data.assets.length}</strong></p>
            <p><span>History</span><strong>{data.history.length}</strong></p>
            <p><span>Video jobs</span><strong>{jobs.length}</strong></p>
            <p><span>Active jobs</span><strong>{activeJobs}</strong></p>
          </div></div> : null}
        {inspectorTab === 'Credits' ? <div className="video-v2-inspector-content video-next-system-list">
          <p><span>Available</span><strong>{wallet.availableCredits ?? 0}</strong></p>
          <p><span>Held</span><strong>{wallet.heldCredits ?? 0}</strong></p>
          <p><span>Captured</span><strong>{wallet.capturedCredits ?? 0}</strong></p>
          <p><span>Mode</span><strong>Read only</strong></p>
        </div> : null}
        <div className="video-v2-cost-box">
          <div><span>Available</span><strong>{wallet.availableCredits ?? 0}</strong></div>
          <p>Held: {wallet.heldCredits ?? 0} · Captured: {wallet.capturedCredits ?? 0}</p>
          <p>No credits can be spent from this screen.</p>
        </div>
      </aside>

      <section className="video-v2-timeline" aria-label="Read-only job sequence">
        <div className="video-v2-timeline-head">
          <div><strong>Sequence foundation</strong><span>Jobs are not editable clips yet</span></div>
          <div><span>{jobs.length} video jobs</span></div>
        </div>
        <div className="video-v2-ruler"><span>01</span><span>02</span><span>03</span><span>04</span><span>05</span></div>
        <div className="video-v2-tracks">
          <div className="video-v2-track-labels"><span>V1</span><span>FX</span><span>A1</span></div>
          <div className="video-v2-track-area">
            <div className="video-v2-track-row">
              {jobs.slice(0, 5).map((job) => (
                <button key={job.id} type="button" style={{ width: `${100 / Math.max(1, Math.min(5, jobs.length))}%` }} onClick={() => {
                  setLeftTab('Jobs');
                  setSelectedId(job.id);
                }}>
                  <i />{job.provider || 'Video'}
                </button>
              ))}
              {!jobs.length && <span className="video-next-track-empty">No video jobs yet</span>}
            </div>
            <div className="video-v2-track-row is-fx"><span style={{ width: '100%' }}>Effects layer reserved for a later phase</span></div>
            <div className="video-v2-track-row is-audio"><span style={{ width: '100%' }}>Audio layer reserved for a later phase</span></div>
          </div>
        </div>
      </section>

      <section className="video-v2-queue" aria-label="Live generation queue">
        <div className="video-v2-section-title">
          <div><p>Persistent jobs</p><h2>Generation queue</h2></div>
          <span>{activeJobs} active</span>
        </div>
        <div className="video-v2-queue-list">
          {jobs.slice(0, 5).map((job) => (
            <button type="button" key={job.id} className="video-v2-job-row" onClick={() => {
              setLeftTab('Jobs');
              setSelectedId(job.id);
            }}>
              <span className={`video-v2-job-status is-${normalizedStatus(job)}`} aria-hidden="true" />
              <span className="video-v2-job-copy"><strong>{recordTitle(job, 'Jobs')}</strong><small>{job.provider || 'Provider pending'}</small></span>
              <span className="video-v2-job-progress"><i style={{ width: `${statusProgress(job)}%` }} /></span>
              <span className="video-v2-job-label">{statusLabel(job)}</span>
            </button>
          ))}
          {!jobs.length && <p className="video-next-empty-list">No video jobs found.</p>}
        </div>
      </section>

      <footer className="video-v2-statusbar">
        <span>{errorMessage || 'Projects, assets, history, jobs and ledger connected in read-only mode.'}</span>
        <span>{lastUpdatedAt ? `Updated ${dateLabel(lastUpdatedAt)}` : 'Waiting for API'}</span>
      </footer>
    </div>
  );
}
