import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import ReferenceUploader from '../components/ReferenceUploader';
import { assetDownloadUrl, fetchAssets } from '../lib/api-client';
import { useVideoChat } from '../hooks/useVideoChat';
import './StudioLayout.css';

const DIRECTOR_FIELDS = [
  {
    key: 'camera',
    label: 'Camera',
    options: ['Steadicam', 'Handheld', 'Dolly in', 'Drone', 'Locked tripod', 'Crane move'],
  },
  {
    key: 'shot',
    label: 'Shot',
    options: ['Wide shot', 'Medium shot', 'Close-up', 'Extreme close-up', 'Over the shoulder', 'Tracking shot'],
  },
  {
    key: 'framing',
    label: 'Framing',
    options: ['Centered', 'Rule of thirds', 'Low angle', 'High angle', 'Dutch angle', 'Symmetrical'],
  },
  {
    key: 'color',
    label: 'Color',
    options: ['Natural cinema', 'Noir', 'Cold blue', 'Warm tungsten', 'Bleach bypass', 'Editorial color'],
  },
  {
    key: 'lens',
    label: 'Lens',
    options: ['24mm', '35mm', '50mm', '85mm', 'Anamorphic', 'Macro'],
  },
  {
    key: 'intention',
    label: 'Intention',
    options: ['Cinematic', 'Commercial', 'Reel', 'Panic', 'Terror', 'Luxury editorial', 'Music video'],
  },
];

const RESOLUTION_OPTIONS = ['1080p', '2K', '4K', '8K'];
const FRAME_RATE_OPTIONS = ['24 fps', '30 fps', '60 fps'];

const EDITOR_LANES = [
  { name: 'Video A', detail: 'Main render / camera pass', active: true },
  { name: 'Motion Ref', detail: 'Movement, pose or scene transfer input', active: true },
  { name: 'Voice / Lip Sync', detail: 'Dialogue, song or mouth sync layer', active: false },
  { name: 'Sound FX', detail: 'Foley, impacts, atmosphere and transitions', active: false },
  { name: 'Music Bed', detail: 'Score, song, rhythm or emotional bed', active: false },
  { name: 'Color Grade', detail: 'Look, contrast, grain and finishing pass', active: true },
];

const DEFAULT_DIRECTOR = {
  camera: 'Steadicam',
  shot: 'Medium shot',
  framing: 'Centered',
  color: 'Natural cinema',
  lens: '35mm',
  intention: 'Cinematic',
  resolution: '4K',
  frameRate: '24 fps',
  duration: '10',
  sceneStart: '',
  sceneEnd: '',
  wardrobe: '',
};

function assetPreview(asset) {
  if (!asset) return null;
  if (asset.contentType?.startsWith('image/')) {
    return <img className="video-library-thumb" src={asset.publicUrl} alt={asset.originalName || asset.id} />;
  }
  if (asset.contentType?.startsWith('video/')) {
    return <video className="video-library-thumb" src={asset.publicUrl} muted playsInline />;
  }
  if (asset.contentType?.startsWith('audio/')) {
    return <div className="video-library-audio">Audio</div>;
  }
  return <div className="video-library-audio">Asset</div>;
}

export default function VideoStudio() {
  const [searchParams] = useSearchParams();
  const initialPrompt = searchParams.get('prompt') || '';
  const [director, setDirector] = useState(DEFAULT_DIRECTOR);
  const [referenceAsset, setReferenceAsset] = useState(null);
  const [assets, setAssets] = useState([]);
  const [libraryStatus, setLibraryStatus] = useState('Loading library...');

  const directorBrief = useMemo(() => [
    `Camera: ${director.camera}`,
    `Shot: ${director.shot}`,
    `Framing: ${director.framing}`,
    `Color: ${director.color}`,
    `Lens: ${director.lens}`,
    `Intention: ${director.intention}`,
    `Target resolution: ${director.resolution}`,
    `Frame rate: ${director.frameRate}`,
    `Scene starts: ${director.sceneStart || 'define from prompt'}`,
    `Scene ends: ${director.sceneEnd || 'define from prompt'}`,
    `Wardrobe / styling: ${director.wardrobe || 'define from prompt'}`,
  ].join('\n'), [director]);

  const {
    messages,
    input,
    setInput,
    handleSend,
    step,
    credits,
    selectTool,
    selectProvider,
    isAuthenticated,
    isCEO,
    isGuest,
    tools,
    providers,
  } = useVideoChat({
    initialPrompt,
    directorBrief,
    referenceAsset,
    durationSeconds: Number(director.duration) || 10,
    resolution: director.resolution,
    frameRate: director.frameRate,
  });

  const refreshLibrary = async () => {
    const result = await fetchAssets();
    if (!result.ok) {
      setAssets([]);
      setLibraryStatus(result.message || 'Library unavailable.');
      return;
    }
    const items = (result.data.assets || []).slice(0, 8);
    setAssets(items);
    setLibraryStatus(items.length ? 'Recent library ready.' : 'No saved assets yet.');
  };

  useEffect(() => {
    refreshLibrary();
  }, []);

  useEffect(() => {
    if (step === 'idle') refreshLibrary();
  }, [step]);

  const updateDirector = (key, value) => {
    setDirector((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="video-director">
      <header className="video-chat-header">
        <div>
          <BrandLogo variant="compact" />
          <p className="studio-rail-label">Video Studio</p>
          <h1>Film Director</h1>
          <p>{isCEO ? 'CEO mode · API direct' : isAuthenticated ? 'Session active' : 'Log in to generate'}</p>
        </div>
        <div className="video-chat-meta">
          <span className="video-chat-credits">
            {isCEO ? 'CEO · API direct' : isGuest ? 'Guest · API direct' : `${credits} CR`}
          </span>
          {!isAuthenticated ? (
            <Link to="/profile" className="video-secondary-button">Log in</Link>
          ) : null}
        </div>
      </header>

      <div className="video-director-grid">
        <aside className="video-director-panel">
          <p className="studio-aside-label">Creation mode</p>
          <div className="video-director-actions">
            {tools.map((tool) => (
              <button key={tool.id} type="button" className="video-director-action" onClick={() => selectTool(tool)}>
                <span>{tool.label}</span>
                <small>{tool.providers.join(' / ')}</small>
              </button>
            ))}
          </div>

          <p className="studio-aside-label studio-rail-label--offset">Provider</p>
          <div className="video-provider-stack">
            {providers.map((provider) => (
              <button key={provider} type="button" className="video-provider-button" onClick={() => selectProvider(provider)}>
                {provider}
              </button>
            ))}
          </div>

          <ReferenceUploader
            kind="video"
            label="Reference Upload"
            role="video-reference"
            note="Video Studio reference"
            onAsset={setReferenceAsset}
          />
        </aside>

        <main className="video-chat-shell video-director-chat">
          <section className="video-director-controls" aria-label="Director controls">
            {DIRECTOR_FIELDS.map((field) => (
              <label key={field.key} className="video-director-field">
                <span>{field.label}</span>
                <select value={director[field.key]} onChange={(event) => updateDirector(field.key, event.target.value)}>
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
            ))}
            <label className="video-director-field">
              <span>Duration</span>
              <select value={director.duration} onChange={(event) => updateDirector('duration', event.target.value)}>
                <option value="5">5 seconds</option>
                <option value="10">10 seconds</option>
                <option value="15">15 seconds</option>
                <option value="30">30 seconds</option>
                <option value="60">60 seconds</option>
              </select>
            </label>
            <label className="video-director-field">
              <span>Resolution</span>
              <select value={director.resolution} onChange={(event) => updateDirector('resolution', event.target.value)}>
                {RESOLUTION_OPTIONS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="video-director-field">
              <span>Frame Rate</span>
              <select value={director.frameRate} onChange={(event) => updateDirector('frameRate', event.target.value)}>
                {FRAME_RATE_OPTIONS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="video-scene-grid" aria-label="Scene brief">
            <label>
              <span>Scene starts</span>
              <input
                value={director.sceneStart}
                onChange={(event) => updateDirector('sceneStart', event.target.value)}
                placeholder="Example: subject enters a foggy alley"
              />
            </label>
            <label>
              <span>Scene ends</span>
              <input
                value={director.sceneEnd}
                onChange={(event) => updateDirector('sceneEnd', event.target.value)}
                placeholder="Example: camera pushes into frightened close-up"
              />
            </label>
            <label className="video-scene-wide">
              <span>Wardrobe / production design</span>
              <input
                value={director.wardrobe}
                onChange={(event) => updateDirector('wardrobe', event.target.value)}
                placeholder="Wardrobe, hair, styling, props, set design..."
              />
            </label>
          </section>

          <section className="video-editor-panel" aria-label="Cinema editor">
            <div className="video-editor-header">
              <div>
                <p className="studio-aside-label">Cinema Editor</p>
                <h2>Timeline, layers and finishing controls</h2>
              </div>
              <span>{director.resolution} · {director.frameRate}</span>
            </div>

            <div className="video-editor-preview">
              <div className="video-editor-viewfinder" aria-hidden="true">
                <span>Preview monitor</span>
              </div>
              <div className="video-editor-export">
                <button type="button" className="video-chip">Cut</button>
                <button type="button" className="video-chip">Grade</button>
                <button type="button" className="video-chip">Sync</button>
                <button type="button" className="video-chip">Export {director.resolution}</button>
              </div>
            </div>

            <div className="video-editor-timeline">
              {EDITOR_LANES.map((lane, index) => (
                <div key={lane.name} className={`video-editor-lane ${lane.active ? 'is-active' : ''}`}>
                  <span>{lane.name}</span>
                  <div>
                    <i style={{ width: `${44 + index * 7}%` }} />
                  </div>
                  <small>{lane.detail}</small>
                </div>
              ))}
            </div>
          </section>

          <div className="video-chat-messages" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={`${message.sender}-${index}`}
                className={`video-chat-message video-chat-message--${message.sender.toLowerCase()}`}
              >
                <span className="video-chat-sender">{message.sender}</span>
                <pre>{message.text}</pre>
              </div>
            ))}
          </div>

          {step === 'await_tool' ? (
            <div className="video-chat-actions">
              {tools.map((tool) => (
                <button key={tool.id} type="button" className="video-chip" onClick={() => selectTool(tool)}>
                  {tool.label}
                </button>
              ))}
            </div>
          ) : null}

          {step === 'await_provider' ? (
            <div className="video-chat-actions">
              {providers.map((provider) => (
                <button key={provider} type="button" className="video-chip" onClick={() => selectProvider(provider)}>
                  {provider}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="video-chat-input"
            onSubmit={(event) => {
              event.preventDefault();
              handleSend();
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={step === 'generating' ? 'Timer running...' : 'Describe the scene like a director...'}
              rows={3}
              disabled={step === 'generating'}
            />
            <button type="submit" className="video-primary-button" disabled={step === 'generating' || !input.trim()}>
              {step === 'generating' ? 'Rendering' : 'Send Brief'}
            </button>
          </form>
        </main>

        <aside className="video-library-panel">
          <div className="video-library-header">
            <p className="studio-aside-label">Library</p>
            <Link to="/library" className="studio-action">[ Open ]</Link>
          </div>
          {referenceAsset ? (
            <article className="video-reference-current">
              <span>Active reference</span>
              <strong>{referenceAsset.originalName || referenceAsset.id}</strong>
            </article>
          ) : null}
          <div className="video-library-list">
            {assets.map((asset) => (
              <a key={asset.id} href={assetDownloadUrl(asset.id)} className="video-library-item">
                {assetPreview(asset)}
                <span>{asset.originalName || asset.provider || asset.kind || 'Asset'}</span>
              </a>
            ))}
            {!assets.length ? <p className="studio-meta">{libraryStatus}</p> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
