import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStudioGenerate } from '../../hooks/useStudioGenerate';
import {
  assetDownloadUrl,
  createGenerationSession,
  createTimelineItem,
  deleteTimelineItem,
  estimateGenerationCost,
  fetchAssets,
  fetchGenerationBatches,
  fetchGenerationJobs,
  fetchGenerationSessions,
  fetchHistory,
  fetchModelCapabilities,
  fetchProjects,
  fetchProviderStatus,
  fetchTimeline,
  resolveModelRoute,
  saveProject,
  uploadReferenceAsset,
} from '../../lib/api-client';
import { useAuth } from '../../context/AuthContext';
import { useStudio } from '../../context/StudioContext';
import StudioErrorPanel from './StudioErrorPanel';
import './AudioStudioV2.css';

const MUSIC_OPERATIONS = [
  ['text_to_music', 'Text to Music'],
  ['lyrics_to_song', 'Lyrics to Song'],
  ['instrumental', 'Instrumental'],
  ['vocal_song', 'Vocal Song'],
  ['background_score', 'Background Score'],
  ['film_score', 'Film Score'],
  ['trailer_music', 'Trailer Music'],
  ['jingle', 'Jingle'],
  ['ad_music', 'Advertising Music'],
  ['loop', 'Loop'],
  ['variation', 'Variation'],
  ['extend_music', 'Extend Music'],
  ['replace_section', 'Replace Section'],
  ['stem_separation', 'Stem Separation'],
  ['remix', 'Remix'],
  ['mastering', 'Mastering'],
];

const SOUND_OPERATIONS = [
  ['text_to_sfx', 'Text to Sound FX'],
  ['text_to_speech', 'Text to Speech'],
  ['foley', 'Foley'],
  ['ambience', 'Ambience'],
  ['room_tone', 'Room Tone'],
  ['weather', 'Weather'],
  ['impact', 'Impact'],
  ['whoosh', 'Whoosh'],
  ['riser', 'Riser'],
  ['transition', 'Transition'],
  ['creature_sound', 'Creature Sound'],
  ['cinematic_sound', 'Cinematic Sound'],
  ['ui_sound', 'UI Sound'],
  ['game_sound', 'Game Sound'],
  ['background_atmosphere', 'Background Atmosphere'],
  ['voice_isolation', 'Voice Isolation'],
  ['voice_cleanup', 'Voice Cleanup'],
  ['stem_separation', 'Stem Separation'],
  ['audio_enhance', 'Audio Enhance'],
];

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'canceled']);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function titleFor(item = {}) {
  return item.displayName || item.title || item.name || item.originalName || item.id || 'Untitled';
}

function statusLabel(value = '') {
  const normalized = String(value || '').toLowerCase();
  if (['pending', 'queued', 'submitting'].includes(normalized)) return 'Pending';
  if (['processing', 'in_progress', 'throttled'].includes(normalized)) return 'Processing';
  if (normalized === 'completed') return 'Completed';
  if (['failed', 'cancelled', 'canceled'].includes(normalized)) return 'Error';
  return value || 'Ready';
}

function audioSource(asset) {
  const value = asset || {};
  return value.publicUrl || value.outputUrl || value.outputUrls?.[0] || '';
}

export default function AudioStudioV2({ modality = 'music' }) {
  const isMusic = modality === 'music';
  const fileInput = useRef(null);
  const { isSpy } = useAuth();
  const { credits, heldCredits } = useStudio();
  const generator = useStudioGenerate(modality);
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const [projects, setProjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [assets, setAssets] = useState([]);
  const [history, setHistory] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [batches, setBatches] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [providers, setProviders] = useState([]);
  const [capabilities, setCapabilities] = useState({ operations: [], models: [] });
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState(query.get('referenceAssetId') || '');
  const [prompt, setPrompt] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [operation, setOperation] = useState(query.get('operation') || (isMusic ? 'text_to_music' : 'text_to_sfx'));
  const [modelId, setModelId] = useState('AUTO');
  const [priority, setPriority] = useState('quality');
  const [duration, setDuration] = useState(isMusic ? 30 : 5);
  const [outputCount, setOutputCount] = useState(1);
  const [genre, setGenre] = useState('Cinematic');
  const [mood, setMood] = useState('Focused');
  const [bpm, setBpm] = useState(100);
  const [keySignature, setKeySignature] = useState('C minor');
  const [instruments, setInstruments] = useState('');
  const [voice, setVoice] = useState('Neutral');
  const [language, setLanguage] = useState('English');
  const [format, setFormat] = useState('wav');
  const [routePreview, setRoutePreview] = useState(null);
  const [estimatedCredits, setEstimatedCredits] = useState(null);
  const [notice, setNotice] = useState('Loading the shared SLT workspace...');
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    const [projectResult, sessionResult, assetResult, historyResult, jobResult, batchResult, capabilityResult, providerResult, timelineResult] = await Promise.all([
      fetchProjects(),
      fetchGenerationSessions(modality),
      fetchAssets({ kind: modality }),
      fetchHistory(modality),
      fetchGenerationJobs(modality, 80),
      fetchGenerationBatches(modality),
      fetchModelCapabilities(modality),
      fetchProviderStatus(),
      fetchTimeline(selectedProjectId ? { projectId: selectedProjectId } : {}),
    ]);
    if (projectResult.ok) setProjects(list(projectResult.data?.projects));
    if (sessionResult.ok) setSessions(list(sessionResult.data?.sessions));
    if (assetResult.ok) setAssets(list(assetResult.data?.assets));
    if (historyResult.ok) setHistory(list(historyResult.data?.history));
    if (jobResult.ok) setJobs(list(jobResult.data?.jobs));
    if (batchResult.ok) setBatches(list(batchResult.data?.batches));
    if (capabilityResult.ok) setCapabilities({
      operations: list(capabilityResult.data?.operations),
      models: list(capabilityResult.data?.models),
    });
    if (providerResult.ok) setProviders(list(providerResult.data?.providers).filter((item) => item.kind === modality || (!isMusic && item.kind === 'sound')));
    if (timelineResult.ok) setTimeline(list(timelineResult.data?.items));
    const failed = [projectResult, sessionResult, assetResult, historyResult, jobResult, batchResult, capabilityResult, providerResult, timelineResult].find((item) => !item.ok);
    setNotice(failed?.message || 'Workspace synchronized.');
  }, [isMusic, modality, selectedProjectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const operationDefinitions = isMusic ? MUSIC_OPERATIONS : SOUND_OPERATIONS;
  const operationOptions = operationDefinitions.map(([id, label]) => capabilities.operations.find((item) => item.id === id) || {
    id,
    label,
    available: false,
    status: 'coming_soon',
    models: [],
  });
  const operationInfo = operationOptions.find((item) => item.id === operation) || operationOptions[0];
  const compatibleModels = capabilities.models.filter((item) => item.operations?.includes(operation));
  const chosenModel = compatibleModels.find((item) => item.id === modelId) || routePreview?.selected || null;
  const audioAssets = assets.filter((item) => String(item.contentType || '').startsWith('audio/'));
  const referenceAsset = assets.find((item) => item.id === selectedAssetId) || null;
  const currentUrl = generator.assetUrl || audioSource(referenceAsset) || audioSource(audioAssets[0]);
  const currentQueue = [...generator.queueItems, ...jobs].filter((item, index, all) => {
    const id = item.id || item.jobId;
    return id && all.findIndex((candidate) => (candidate.id || candidate.jobId) === id) === index;
  });

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const manual = compatibleModels.find((item) => item.id === modelId);
      const result = await resolveModelRoute({
        modality,
        operation,
        priority,
        provider: manual?.provider || 'AUTO',
        model: manual?.model || 'AUTO',
        durationSeconds: duration,
        referenceAssetIds: selectedAssetId ? [selectedAssetId] : [],
      });
      setRoutePreview(result.data?.route || null);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [compatibleModels, duration, modality, modelId, operation, priority, selectedAssetId]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const result = await estimateGenerationCost(modality, {
        operation,
        provider: chosenModel?.provider || 'AUTO',
        model: chosenModel?.model,
        durationSeconds: duration,
        outputCount,
        characters: prompt.length,
      });
      setEstimatedCredits(result.ok ? Number(result.data?.estimatedCredits || 0) : null);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [chosenModel, duration, modality, operation, outputCount, prompt.length]);

  const createProject = async () => {
    const result = await saveProject({ title: `Untitled ${isMusic ? 'Music' : 'Sound'} Project`, kind: modality });
    if (!result.ok) return setNotice(result.message || 'Project could not be created.');
    setSelectedProjectId(result.data.project.id);
    setProjects((current) => [result.data.project, ...current]);
    setNotice('Project created.');
  };

  const createSession = async () => {
    const result = await createGenerationSession({
      title: `${isMusic ? 'Music' : 'Sound'} session`,
      kind: modality,
      projectId: selectedProjectId || null,
    });
    if (!result.ok) return setNotice(result.message || 'Session could not be created.');
    setSelectedSessionId(result.data.session.id);
    setSessions((current) => [result.data.session, ...current]);
    setNotice('Session created.');
  };

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    const result = await uploadReferenceAsset({
      file,
      kind: file.type.startsWith('video/') ? 'video' : 'audio',
      module: modality,
      role: 'reference',
      projectId: selectedProjectId || null,
      sessionId: selectedSessionId || null,
    });
    setUploading(false);
    if (!result.ok || !result.data?.asset) return setNotice(result.message || 'Reference upload failed.');
    setSelectedAssetId(result.data.asset.id);
    setAssets((current) => [result.data.asset, ...current]);
    setNotice('Reference stored in SLT Storage.');
  };

  const generate = async () => {
    if (!prompt.trim()) return setNotice('Write the creative order before generating.');
    if (operationInfo?.status === 'coming_soon' || !operationInfo?.implemented) {
      return setNotice(`${operationInfo?.label || operation} · Coming Soon. No credits were reserved.`);
    }
    if (!operationInfo.available && !chosenModel?.connected) {
      return setNotice(chosenModel?.message || `${operationInfo.label} is temporarily unavailable because no compatible provider is connected. No credits were reserved.`);
    }
    const result = await generator.runGenerate({
      title: `${isMusic ? 'Music' : 'Sound'} · ${operationInfo.label}`,
      prompt: prompt.trim(),
      lyrics: lyrics.trim() || undefined,
      operation,
      actionId: operation,
      tool: operation,
      provider: modelId === 'AUTO' ? 'AUTO' : chosenModel?.provider,
      providerLabel: modelId === 'AUTO' ? 'SLT Auto' : chosenModel?.provider,
      model: modelId === 'AUTO' ? undefined : chosenModel?.model,
      modelId: modelId === 'AUTO' ? undefined : chosenModel?.model,
      capabilityAware: true,
      priority,
      outputCount,
      durationSeconds: duration,
      projectId: selectedProjectId || undefined,
      sessionId: selectedSessionId || undefined,
      sourceAssetId: selectedAssetId || undefined,
      referenceAssetIds: selectedAssetId ? [selectedAssetId] : [],
      genre,
      style: genre,
      mood,
      bpm,
      key: keySignature,
      instruments,
      voice,
      language,
      outputFormat: format,
    });
    setNotice(result.ok ? generator.status || 'Generation accepted.' : result.message || 'Generation failed.');
    await refresh();
  };

  const addToTimeline = async () => {
    const asset = assets.find((item) => item.id === selectedAssetId);
    if (!asset) return setNotice('Select an Asset first.');
    if (!selectedProjectId) return setNotice('Select or create a Project before adding timeline tracks.');
    const trackType = isMusic ? 'MUSIC' : operation === 'text_to_speech' ? 'VOICE' : 'SFX';
    const result = await createTimelineItem({
      projectId: selectedProjectId,
      sessionId: selectedSessionId || null,
      assetId: asset.id,
      trackType,
      startSeconds: 0,
      durationSeconds: duration,
      position: timeline.length,
    });
    setNotice(result.ok ? 'Asset added to the shared timeline.' : result.message || 'Timeline update failed.');
    await refresh();
  };

  const removeTimeline = async (itemId) => {
    const result = await deleteTimelineItem(itemId);
    setNotice(result.ok ? 'Timeline item removed.' : result.message || 'Timeline update failed.');
    await refresh();
  };

  return (
    <main className="audio-v2-shell">
      <header className="audio-v2-header">
        <div>
          <p>Sweet Little Trauma Studio</p>
          <h1>{isMusic ? 'Music Studio' : 'Sound & Voice Studio'}</h1>
        </div>
        <nav aria-label="Multimodal workspace">
          <Link to="/projects">Projects</Link>
          <Link to="/library">Assets</Link>
          <Link to="/scene-builder">Scene Builder</Link>
          <Link to={isMusic ? '/sound' : '/music'}>{isMusic ? 'Sound' : 'Music'}</Link>
        </nav>
      </header>

      <section className="audio-v2-workspace">
        <aside className="audio-v2-library">
          <div className="audio-v2-panel-title"><span>Workspace</span><button type="button" onClick={refresh}>Refresh</button></div>
          <label>Project<select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}><option value="">No project selected</option>{projects.map((item) => <option key={item.id} value={item.id}>{titleFor(item)}</option>)}</select></label>
          <button type="button" onClick={createProject}>New Project</button>
          <label>Session<select value={selectedSessionId} onChange={(event) => setSelectedSessionId(event.target.value)}><option value="">No session selected</option>{sessions.filter((item) => !selectedProjectId || item.projectId === selectedProjectId).map((item) => <option key={item.id} value={item.id}>{titleFor(item)}</option>)}</select></label>
          <button type="button" onClick={createSession}>New Session</button>
          <div className="audio-v2-panel-title"><span>Asset Library</span><button type="button" onClick={() => fileInput.current?.click()}>{uploading ? 'Uploading' : 'Upload'}</button></div>
          <input ref={fileInput} type="file" accept="audio/*,video/*" hidden onChange={(event) => upload(event.target.files?.[0])} />
          <div className="audio-v2-asset-list">
            {assets.length ? assets.slice(0, 30).map((asset) => <button type="button" key={asset.id} className={selectedAssetId === asset.id ? 'is-active' : ''} onClick={() => setSelectedAssetId(asset.id)}><strong>{titleFor(asset)}</strong><small>{asset.kind} · {asset.role || 'asset'}</small></button>) : <p>No shared Assets yet.</p>}
          </div>
        </aside>

        <section className="audio-v2-stage">
          <div className="audio-v2-monitor">
            <div className="audio-v2-waveform" aria-hidden="true">{Array.from({ length: 56 }, (_, index) => <i key={index} style={{ height: `${22 + ((index * 37) % 68)}%` }} />)}</div>
            {currentUrl ? <audio src={currentUrl} controls /> : <p>Your persistent audio result will appear here.</p>}
          </div>
          <div className="audio-v2-stage-actions">
            {selectedAssetId ? <a href={assetDownloadUrl(selectedAssetId)}>Download</a> : <span>Select an Asset to download</span>}
            <button type="button" onClick={addToTimeline}>Add to Timeline</button>
          </div>
          <section className="audio-v2-timeline">
            <div className="audio-v2-panel-title"><span>Shared Timeline</span><small>{timeline.length} tracks</small></div>
            {timeline.length ? timeline.map((item) => <div key={item.id} className="audio-v2-track"><b>{item.trackType}</b><span>{titleFor(assets.find((asset) => asset.id === item.assetId))}</span><small>{Number(item.startSeconds || 0).toFixed(1)}s · {Number(item.durationSeconds || 0).toFixed(1)}s</small><button type="button" onClick={() => removeTimeline(item.id)}>Remove</button></div>) : <p>No tracks in this Project.</p>}
          </section>
        </section>

        <aside className="audio-v2-inspector">
          <label>Operation<select value={operation} onChange={(event) => { setOperation(event.target.value); setModelId('AUTO'); }}>{operationOptions.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.status === 'coming_soon' ? ' · Coming Soon' : !item.available ? ` · ${item.message || item.customerMessage || 'Provider unavailable'}` : ''}</option>)}</select><small>{operationInfo?.available ? 'Available through the SLT capability router.' : operationInfo?.message || operationInfo?.customerMessage || 'No compatible provider is connected for this operation.'}</small></label>
          <label>Creative order<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows="5" placeholder={isMusic ? 'Describe genre, emotion, structure, instruments and intended use...' : 'Describe the exact voice, foley, ambience or sound effect...'} /></label>
          {isMusic ? <label>Lyrics<textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} rows="4" placeholder="Optional lyrics or section markers..." /></label> : null}
          <div className="audio-v2-grid">
            <label>Duration<input type="number" min="1" max={isMusic ? 240 : 180} value={duration} onChange={(event) => setDuration(Math.max(1, Number(event.target.value) || 1))} /></label>
            <label>Outputs<div className="audio-v2-stepper"><button type="button" onClick={() => setOutputCount((value) => Math.max(1, value - 1))}>-</button><b>{outputCount}</b><button type="button" onClick={() => setOutputCount((value) => Math.min(8, value + 1))}>+</button></div></label>
            <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="quality">Quality</option><option value="speed">Speed</option><option value="cost">Cost</option></select></label>
            <label>Format<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="wav">WAV</option><option value="mp3">MP3</option></select></label>
          </div>
          {isMusic ? <div className="audio-v2-grid"><label>Genre<input value={genre} onChange={(event) => setGenre(event.target.value)} /></label><label>Mood<input value={mood} onChange={(event) => setMood(event.target.value)} /></label><label>BPM<input type="number" min="40" max="240" value={bpm} onChange={(event) => setBpm(Number(event.target.value) || 100)} /></label><label>Key<input value={keySignature} onChange={(event) => setKeySignature(event.target.value)} /></label><label className="is-wide">Instruments<input value={instruments} onChange={(event) => setInstruments(event.target.value)} placeholder="Piano, strings, analog synth..." /></label></div> : <div className="audio-v2-grid"><label>Voice<input value={voice} onChange={(event) => setVoice(event.target.value)} /></label><label>Language<input value={language} onChange={(event) => setLanguage(event.target.value)} /></label></div>}
          <label>Model<select value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="AUTO">SLT Auto Router</option>{compatibleModels.map((item) => <option key={item.id} value={item.id} disabled={!item.connected}>{item.label}{item.connected ? '' : ` · ${item.message || 'Unavailable'}`}</option>)}</select><small>{routePreview?.message || chosenModel?.message || 'Capability routing is checked server-side.'}</small></label>
          <div className="audio-v2-cost"><span>Estimated cost</span><strong>{estimatedCredits === null ? 'Checking...' : `${estimatedCredits} credits`}</strong><small>{outputCount} independent Job{outputCount === 1 ? '' : 's'} · balance {credits ?? '—'} · held {heldCredits ?? 0}</small><button type="button" disabled={generator.generating || isSpy || !prompt.trim() || !operationInfo?.available} onClick={generate}>{isSpy ? 'Read-only mode' : generator.generating ? statusLabel(generator.jobStatus) : !operationInfo?.available ? 'Unavailable' : `Generate ${isMusic ? 'music' : 'audio'}`}</button></div>
        </aside>
      </section>

      <section className="audio-v2-operations">
        <div><h2>Provider status</h2>{providers.length ? providers.map((item) => <p key={item.name}><b>{item.name}</b><span className={item.available ? 'is-ready' : 'is-blocked'}>{item.available ? 'Available' : item.errorName || item.status}</span><small>{item.available ? item.model?.label || item.execution : item.message}</small></p>) : <p>No provider status returned.</p>}</div>
        <div><h2>Generation queue</h2>{currentQueue.length ? currentQueue.slice(0, 16).map((job) => <p key={job.id || job.jobId}><b>{job.label || job.title || `${modality} Job`}</b><span>{statusLabel(job.status)}</span><small>{job.provider || job.model || 'SLT Auto'} · {job.batchId || job.id}</small></p>) : <p>No Jobs yet.</p>}</div>
        <div><h2>History</h2>{history.length ? history.slice(0, 16).map((item) => <p key={item.id}><b>{titleFor(item)}</b><span>{statusLabel(item.status)}</span><small>{item.provider || 'SLT'} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small></p>) : <p>No History yet.</p>}</div>
      </section>

      <StudioErrorPanel incident={generator.incident} error={generator.error} actionStatus={generator.incidentAction} onReport={generator.sendIncidentReport} onRetry={generator.retryLastGeneration} retrying={generator.retrying} />
      <footer className="audio-v2-footer"><span>{generator.status || notice}</span><span>{batches.length} batches · {jobs.filter((item) => !TERMINAL.has(String(item.status || '').toLowerCase())).length} active Jobs</span></footer>
    </main>
  );
}
