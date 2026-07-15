import { useMemo, useRef, useState } from 'react';
import ReferenceUploader from '../components/ReferenceUploader';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
import { useSubscription } from '../hooks/useSubscription';
import { useStudio } from '../context/StudioContext';
import './StudioLayout.css';

const TOOLS = [
  { label: 'Upload Audio', desc: 'Import files' },
  { label: 'Stem Separation', desc: 'Extract vocals/drums' },
  { label: 'Recreate Instrument', desc: 'AI instrument gen' },
  { label: 'Recreate Voice', desc: 'AI voice recreation' },
  { label: 'Record Voice', desc: 'Direct recording' },
  { label: 'Track Builder', desc: 'AI-assisted tracks' },
  { label: 'Arrangement', desc: 'Compose & arrange' },
  { label: 'Mix Assistant', desc: 'AI-powered mixing' },
  { label: 'Mastering', desc: 'Professional master' },
  { label: 'Export Stems', desc: 'Download tracks' },
];

const MODES = ['Manual Studio', 'Suno Mode', 'Udio Mode'];
const DEFAULT_PROVIDERS = [
  { name: 'SLT Composer', model: 'Local planning', status: 'Ready' },
  { name: 'MiniMax Music', model: 'Music generation', status: 'API' },
  { name: 'Stable Audio', model: 'Audio generation', status: 'API' },
  { name: 'Suno', model: 'v5.5', status: 'Prepared' },
  { name: 'ElevenLabs Music', model: 'music_v2', status: 'Prepared' },
  { name: 'Udio', model: 'External account', status: 'Prepared' },
  { name: 'Mubert', model: 'Track API', status: 'Prepared' },
];

const TRACKS_DEFAULT = [
  { name: 'Vocals', muted: false, solo: false, vol: -1.2 },
  { name: 'Drums', muted: false, solo: false, vol: -0.5 },
  { name: 'Bass', muted: false, solo: false, vol: -2.1 },
  { name: 'Guitar', muted: false, solo: false, vol: -1.8 },
  { name: 'Keys', muted: false, solo: false, vol: -3.0 },
  { name: 'Atmosphere', muted: false, solo: false, vol: -4.5 },
];

export default function MusicStudio() {
  const audioRef = useRef(null);
  const [activeMode, setActiveMode] = useState('Manual Studio');
  const [activeTool, setActiveTool] = useState('Track Builder');
  const [activeProvider, setActiveProvider] = useState('SLT Composer');
  const [tracks, setTracks] = useState(TRACKS_DEFAULT);
  const [playing, setPlaying] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [referenceAsset, setReferenceAsset] = useState(null);
  const { assetUrl, error, generating, jobStatus, status, runGenerate } = useStudioGenerate('music');
  const { hasCredits, isCEO } = useSubscription();
  const { providers } = useStudio();

  const providerOptions = useMemo(() => {
    const connected = new Set(providers.filter((item) => item.connected).map((item) => item.name));
    return DEFAULT_PROVIDERS.map((provider) => ({
      ...provider,
      available: connected.has(provider.name) || provider.name === 'SLT Composer',
    }));
  }, [providers]);

  const toggleTrack = (name, field) => {
    setTracks((current) => current.map((track) => (
      track.name === name ? { ...track, [field]: !track[field] } : track
    )));
  };

  const handlePlay = async () => {
    if (!assetUrl) {
      alert('Generate music first or upload an audio reference.');
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    await audio.play();
    setPlaying(true);
  };

  const handleGenerate = () => {
    if (!hasCredits && !isCEO) {
      alert('Log in and add credits to continue.');
      return;
    }
    runGenerate({
      title: activeTool,
      prompt: `[${activeMode}] ${prompt}`,
      provider: activeProvider,
      providerLabel: activeProvider,
      tool: activeTool,
      referenceAssets: referenceAsset ? [referenceAsset] : [],
      referenceAudioUrl: referenceAsset?.publicUrl || '',
      referenceAssetIds: referenceAsset ? [referenceAsset.id] : [],
      assetUrls: referenceAsset ? [referenceAsset.publicUrl] : [],
    });
  };

  return (
    <div className="studio studio-container">
      <aside className="studio-rail">
        <p className="studio-rail-label">Music</p>
        <ul className="studio-tool-list">
          {TOOLS.map(({ label, desc }) => (
            <li key={label}>
              <button
                type="button"
                className={`studio-tool-item ${activeTool === label ? 'is-active' : ''}`}
                onClick={() => setActiveTool(label)}
              >
                <span className="studio-tool-label">{label}</span>
                <span className="studio-tool-desc">{desc}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="studio-main">
        <header>
          <h1 className="studio-main-title">Music Studio</h1>
          <p className="studio-main-meta">{activeMode} · {activeTool} · {status || 'Ready'}</p>
        </header>

        <div className="studio-toggle-row">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`studio-action ${activeMode === mode ? 'is-active' : ''}`}
              onClick={() => setActiveMode(mode)}
            >
              [ {mode} ]
            </button>
          ))}
        </div>

        <div className="studio-project-row studio-glass-panel">
          <div>
            <p className="studio-project-title">New Project</p>
            <p className="studio-project-sub">Sweet Little Trauma</p>
            <div className="studio-tags">
              <span className="studio-tag">Alternative</span>
              <span className="studio-tag">Dream Pop</span>
            </div>
          </div>
          <button type="button" className="studio-action" onClick={handlePlay}>
            [ {playing ? 'Pause' : 'Play'} ]
          </button>
        </div>

        <audio
          ref={audioRef}
          src={assetUrl || referenceAsset?.publicUrl || ''}
          onEnded={() => setPlaying(false)}
          className="studio-audio-player"
          controls={Boolean(assetUrl)}
        />

        {(assetUrl || generating || error) ? (
          <div className="studio-result-block studio-glass-panel">
            <p className={error ? 'studio-error-note' : 'studio-async-note'}>
              {error || `${jobStatus || 'processing'} · ${status || 'Waiting for provider status'}`}
            </p>
          </div>
        ) : null}

        <ReferenceUploader
          kind="music"
          label="Audio / Lyric Reference"
          role={activeTool}
          note={activeMode}
          onAsset={setReferenceAsset}
        />

        <table className="studio-table">
          <thead>
            <tr>
              <th>Track</th>
              <th>M / S</th>
              <th>Level</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => (
              <tr key={track.name}>
                <td>{track.name}</td>
                <td>
                  <div className="studio-table-actions">
                    <button
                      type="button"
                      className={`studio-action ${track.muted ? 'is-active' : ''}`}
                      onClick={() => toggleTrack(track.name, 'muted')}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      className={`studio-action ${track.solo ? 'is-active' : ''}`}
                      onClick={() => toggleTrack(track.name, 'solo')}
                    >
                      S
                    </button>
                  </div>
                </td>
                <td>{track.vol} dB</td>
                <td>
                  <button
                    type="button"
                    className="studio-action"
                    onClick={() => setPrompt((current) => `${current} Focus on ${track.name.toLowerCase()} layer.`.trim())}
                  >
                    [ View ]
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="studio-input-bar">
          <input
            type="text"
            className="studio-input"
            placeholder="Describe the music you want to create..."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button
            type="button"
            className="studio-button"
            disabled={generating || (!hasCredits && !isCEO)}
            onClick={handleGenerate}
          >
            {isCEO ? 'Generate (CEO Mode)' : 'Generate'}
          </button>
        </div>
      </main>

      <aside className="studio-aside">
        <p className="studio-aside-label">Providers</p>
        <ul className="studio-provider-list">
          {providerOptions.map((provider) => (
            <li key={provider.name}>
              <button
                type="button"
                className={`studio-provider-item ${activeProvider === provider.name ? 'is-active' : ''}`}
                disabled={!provider.available}
                onClick={() => setActiveProvider(provider.name)}
              >
                <span>
                  <span className="studio-provider-name">{provider.name}</span>
                  <span className="studio-provider-model">{provider.model}</span>
                </span>
                <span className="studio-provider-status">{provider.available ? provider.status : 'Offline'}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
