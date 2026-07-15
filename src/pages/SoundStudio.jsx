import { useMemo, useRef, useState } from 'react';
import ReferenceUploader from '../components/ReferenceUploader';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
import { useSubscription } from '../hooks/useSubscription';
import { useStudio } from '../context/StudioContext';
import './StudioLayout.css';

const TOOLS = [
  { label: 'Voice', desc: 'Generate or edit voices' },
  { label: 'Clone', desc: 'Clone voices with AI' },
  { label: 'Narration', desc: 'Create spoken content' },
  { label: 'Dubbing', desc: 'Translate and dub' },
  { label: 'Cleanup', desc: 'Remove noise & hiss' },
  { label: 'Foley', desc: 'Create foley sounds' },
  { label: 'FX', desc: 'Add sound effects' },
  { label: 'Soundscapes', desc: 'Generate atmospheres' },
  { label: 'Mix', desc: 'Balance your tracks' },
  { label: 'Master', desc: 'Master your audio' },
  { label: 'Export', desc: 'Export your project' },
];

const DEFAULT_PROVIDERS = [
  { name: 'ElevenLabs', model: 'Flash v2.5', status: 'TTS' },
  { name: 'OpenAI Audio', model: 'TTS', status: 'Voice' },
  { name: 'MiniMax Speech', model: 'Speech', status: 'API' },
  { name: 'Stability Audio', model: 'FX / audio', status: 'API' },
  { name: 'Moises', model: 'Audio tools', status: 'API' },
  { name: 'Dolby.io', model: 'Enhance', status: 'Paused' },
  { name: 'iZotope', model: 'Mastering', status: 'Prepared' },
  { name: 'FFmpeg', model: 'Local utility', status: 'Internal' },
];

export default function SoundStudio() {
  const audioRef = useRef(null);
  const uploadSectionRef = useRef(null);
  const [activeTool, setActiveTool] = useState('Voice');
  const [activeProvider, setActiveProvider] = useState('ElevenLabs');
  const [playing, setPlaying] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [referenceAsset, setReferenceAsset] = useState(null);
  const { assetUrl, error, generating, jobStatus, status, runGenerate } = useStudioGenerate('sound');
  const { hasCredits, isCEO } = useSubscription();
  const { providers } = useStudio();

  const providerOptions = useMemo(() => {
    const connected = new Set(providers.filter((item) => item.connected).map((item) => item.name));
    return DEFAULT_PROVIDERS.map((provider) => ({
      ...provider,
      available: connected.has(provider.name),
    }));
  }, [providers]);

  const handleImport = () => {
    uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    uploadSectionRef.current?.querySelector('input[type="file"]')?.click();
  };

  const handlePlay = async () => {
    const source = assetUrl || referenceAsset?.publicUrl;
    if (!source) {
      alert('Generate audio or upload a reference first.');
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
      prompt,
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
        <p className="studio-rail-label">Sound</p>
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
          <h1 className="studio-main-title">Sound Studio</h1>
          <p className="studio-main-meta">{activeTool} · {status || 'Ready'}</p>
        </header>

        <div className="studio-preview studio-preview--wide studio-glass-panel">
          <div className="studio-preview-inner">
            {assetUrl ? (
              <audio className="studio-audio-player" src={assetUrl} controls />
            ) : (
              <div className="studio-media-placeholder" aria-hidden="true" />
            )}
            <p className={error ? 'studio-error-note' : ''}>
              {error || (generating ? `${jobStatus || 'processing'} · ${status}` : 'Ready for generation')}
            </p>
          </div>
        </div>

        <audio
          ref={audioRef}
          src={assetUrl || referenceAsset?.publicUrl || ''}
          onEnded={() => setPlaying(false)}
          className="studio-audio-player"
        />

        <div className="studio-controls">
          <button type="button" className="studio-action" onClick={handleImport}>
            [ Import below ]
          </button>
          <span className="studio-meta">{referenceAsset ? referenceAsset.originalName : 'Ready'}</span>
          <button type="button" className="studio-action" disabled={generating} onClick={handleGenerate}>
            [ Generate ]
          </button>
          <button type="button" className="studio-action" onClick={handlePlay}>
            [ {playing ? 'Pause' : 'Play'} ]
          </button>
        </div>

        <div ref={uploadSectionRef}>
          <ReferenceUploader
            kind="sound"
            label="Audio / Dubbing Reference"
            role={activeTool}
            note={activeProvider}
            onAsset={setReferenceAsset}
          />
        </div>

        <div className="studio-input-bar">
          <input
            type="text"
            className="studio-input"
            placeholder="Describe the sound you want to create..."
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
