import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createTimelineItem,
  deleteTimelineItem,
  fetchTimeline,
  pollJob,
  renderTimeline,
  splitTimelineItem,
  updateTimelineItem,
} from '../../lib/api-client';
import './TimelineEditor.css';

const TRACKS = ['VIDEO', 'DIALOGUE', 'VOICE', 'MUSIC', 'SFX', 'AMBIENCE'];

function assetTitle(asset = {}) {
  return asset.displayName || asset.originalName || asset.title || asset.id || 'Asset';
}

function isAudio(asset = {}) {
  return String(asset.contentType || '').startsWith('audio/') || ['music', 'sound', 'voice'].includes(String(asset.kind || '').toLowerCase());
}

function initialTrack(asset = {}) {
  const kind = String(asset.kind || '').toLowerCase();
  if (kind === 'music') return 'MUSIC';
  if (kind === 'voice') return 'VOICE';
  if (kind === 'sound' || isAudio(asset)) return 'SFX';
  return 'VIDEO';
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function TimelineEditor({ projectId = '', sessionId = '', sceneId = '', assets = [], onRendered }) {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [playhead, setPlayhead] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Timeline is ready. Add a stored Asset to begin.');
  const selected = items.find((item) => item.id === selectedId) || null;
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const usableAssets = useMemo(() => assets.filter((asset) => {
    const type = String(asset.contentType || '');
    return !asset.deletedAt && (type.startsWith('video/') || type.startsWith('audio/') || type.startsWith('image/'));
  }), [assets]);
  const duration = Math.max(10, ...items.map((item) => finite(item.startSeconds) + finite(item.durationSeconds)));

  const refresh = useCallback(async () => {
    if (!projectId && !sceneId) {
      setItems([]);
      return;
    }
    const result = await fetchTimeline({ projectId, sceneId });
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setItems(result.data?.items || []);
  }, [projectId, sceneId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const mutate = async (operation, successMessage) => {
    setBusy(true);
    const result = await operation();
    setBusy(false);
    setNotice(result.ok ? successMessage : result.message);
    if (result.ok) await refresh();
    return result;
  };

  const addAsset = async () => {
    const asset = assetMap.get(assetId);
    if (!asset) return setNotice('Choose an Asset first.');
    if (!projectId && !sceneId) return setNotice('Select or create a Project before editing its Timeline.');
    const trackType = initialTrack(asset);
    const sameTrack = items.filter((item) => item.trackType === trackType);
    const startSeconds = sameTrack.length
      ? Math.max(...sameTrack.map((item) => finite(item.startSeconds) + finite(item.durationSeconds)))
      : 0;
    const durationSeconds = Math.max(0.25, finite(asset.metadata?.durationSeconds, String(asset.contentType || '').startsWith('image/') ? 5 : 5));
    const result = await mutate(() => createTimelineItem({
      projectId: projectId || asset.projectId || null,
      sessionId: sessionId || asset.sessionId || null,
      sceneId: sceneId || null,
      assetId: asset.id,
      trackType,
      startSeconds,
      sourceStartSeconds: 0,
      durationSeconds,
      position: sameTrack.length,
    }), `${assetTitle(asset)} added to ${trackType}.`);
    if (result.ok) {
      setSelectedId(result.data?.item?.id || '');
      setAssetId('');
    }
  };

  const update = (patch, message = 'Clip updated.') => {
    if (!selected) return Promise.resolve();
    return mutate(() => updateTimelineItem(selected.id, patch), message);
  };

  const split = () => {
    if (!selected) return setNotice('Select a clip before splitting.');
    const splitAt = playhead > selected.startSeconds && playhead < selected.startSeconds + selected.durationSeconds
      ? playhead
      : selected.startSeconds + selected.durationSeconds / 2;
    return mutate(() => splitTimelineItem(selected.id, splitAt), `Clip split at ${splitAt.toFixed(2)}s.`);
  };

  const remove = async () => {
    if (!selected) return;
    const result = await mutate(() => deleteTimelineItem(selected.id), 'Clip removed from Timeline.');
    if (result?.ok) setSelectedId('');
  };

  const render = async () => {
    if (!items.length) return setNotice('Add at least one Asset before rendering.');
    setBusy(true);
    setNotice('Render queued...');
    const accepted = await renderTimeline({ projectId, sessionId, sceneId, title: 'SLT Timeline Export', width: 1920, height: 1080, fps: 30 });
    if (!accepted.ok || !accepted.data?.jobId) {
      setBusy(false);
      setNotice(accepted.message);
      return;
    }
    const completed = await pollJob(accepted.data.jobId, 'SLT FFmpeg', {
      intervalMs: 1500,
      maxAttempts: 1200,
      onTick: ({ status }) => setNotice(`Rendering: ${status}`),
    });
    setBusy(false);
    if (!completed.ok) {
      setNotice(completed.message);
      return;
    }
    const asset = completed.data?.job?.assets?.[0] || null;
    setNotice(asset ? 'Render completed and saved to SLT Storage.' : 'Render completed.');
    onRendered?.(asset, completed.data?.job);
  };

  return (
    <section className="slt-timeline" aria-label="SLT Timeline editor">
      <header className="slt-timeline-head">
        <div><strong>Timeline</strong><span>{items.length} clips · {duration.toFixed(1)}s</span></div>
        <div className="slt-timeline-add">
          <select value={assetId} onChange={(event) => setAssetId(event.target.value)} aria-label="Asset to add">
            <option value="">Add stored Asset...</option>
            {usableAssets.map((asset) => <option key={asset.id} value={asset.id}>{assetTitle(asset)}</option>)}
          </select>
          <button type="button" onClick={addAsset} disabled={busy || !assetId}>Add</button>
          <button type="button" onClick={render} disabled={busy || !items.length}>Render MP4</button>
        </div>
      </header>

      <label className="slt-timeline-playhead">
        <span>Playhead {playhead.toFixed(2)}s</span>
        <input type="range" min="0" max={duration} step="0.04" value={playhead} onChange={(event) => setPlayhead(Number(event.target.value))} />
      </label>

      <div className="slt-timeline-tracks">
        {TRACKS.map((track) => (
          <div className="slt-timeline-track" key={track}>
            <strong>{track}</strong>
            <div className="slt-timeline-lane">
              {items.filter((item) => item.trackType === track).map((item) => {
                const asset = assetMap.get(item.assetId);
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={selectedId === item.id ? 'is-selected' : ''}
                    style={{ left: `${(finite(item.startSeconds) / duration) * 100}%`, width: `${Math.max(3, (finite(item.durationSeconds) / duration) * 100)}%` }}
                    onClick={() => { setSelectedId(item.id); setPlayhead(finite(item.startSeconds)); }}
                    title={`${assetTitle(asset)} · ${finite(item.startSeconds).toFixed(2)}s`}
                  >
                    {assetTitle(asset)}
                  </button>
                );
              })}
              <i style={{ left: `${(playhead / duration) * 100}%` }} aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="slt-timeline-inspector">
          <label><span>Track</span><select value={selected.trackType} onChange={(event) => update({ trackType: event.target.value })}>{TRACKS.map((track) => <option key={track}>{track}</option>)}</select></label>
          <label><span>Start</span><input type="number" min="0" step="0.04" value={selected.startSeconds} onChange={(event) => update({ startSeconds: Math.max(0, Number(event.target.value)) })} /></label>
          <label><span>Source in</span><input type="number" min="0" step="0.04" value={selected.sourceStartSeconds || 0} onChange={(event) => update({ sourceStartSeconds: Math.max(0, Number(event.target.value)) })} /></label>
          <label><span>Duration</span><input type="number" min="0.04" step="0.04" value={selected.durationSeconds} onChange={(event) => update({ durationSeconds: Math.max(0.04, Number(event.target.value)) })} /></label>
          <label><span>Volume</span><input type="number" min="0" max="4" step="0.05" value={selected.volume ?? 1} onChange={(event) => update({ volume: Number(event.target.value) })} /></label>
          <label><span>Pan</span><input type="number" min="-1" max="1" step="0.05" value={selected.pan ?? 0} onChange={(event) => update({ pan: Number(event.target.value) })} /></label>
          <label><span>Fade in</span><input type="number" min="0" step="0.1" value={selected.fadeInSeconds || 0} onChange={(event) => update({ fadeInSeconds: Number(event.target.value) })} /></label>
          <label><span>Fade out</span><input type="number" min="0" step="0.1" value={selected.fadeOutSeconds || 0} onChange={(event) => update({ fadeOutSeconds: Number(event.target.value) })} /></label>
          <button type="button" className={selected.muted ? 'is-active' : ''} onClick={() => update({ muted: !selected.muted }, selected.muted ? 'Clip unmuted.' : 'Clip muted.')}>Mute</button>
          <button type="button" className={selected.solo ? 'is-active' : ''} onClick={() => update({ solo: !selected.solo }, selected.solo ? 'Solo disabled.' : 'Solo enabled.')}>Solo</button>
          <button type="button" onClick={() => update({ position: Math.max(0, finite(selected.position) - 1) }, 'Clip moved earlier in track order.')}>Move up</button>
          <button type="button" onClick={() => update({ position: finite(selected.position) + 1 }, 'Clip moved later in track order.')}>Move down</button>
          <button type="button" onClick={split}>Split</button>
          <button type="button" onClick={remove}>Delete</button>
        </div>
      ) : null}
      <footer><span>{notice}</span><span>{projectId ? `Project ${projectId.slice(-8)}` : sceneId ? `Scene ${sceneId.slice(-8)}` : 'No Project selected'}</span></footer>
    </section>
  );
}
