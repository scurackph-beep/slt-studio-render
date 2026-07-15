import { useMemo, useState } from 'react';
import ReferenceUploader from '../components/ReferenceUploader';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
import { useSubscription } from '../hooks/useSubscription';
import { useStudio } from '../context/StudioContext';
import { readStore, storageKeys, writeStore } from '../lib/storage';
import './StudioLayout.css';

const TOOLS = [
  { label: 'Create Look', desc: 'Full outfit direction' },
  { label: 'Outfit', desc: 'Garment combinations' },
  { label: 'Garment', desc: 'Single piece design' },
  { label: 'Textile / Pattern', desc: 'Fabric and repeat' },
  { label: 'Color Palette', desc: 'Seasonal tones' },
  { label: 'Virtual Try-on', desc: 'Model placement' },
  { label: 'Editorial Shoot', desc: 'Campaign framing' },
  { label: 'Runway Look', desc: 'Show-ready styling' },
  { label: 'Export', desc: 'Save look as project' },
];

const DEFAULT_PROVIDERS = [
  { name: 'OpenAI Images', status: 'Gateway' },
  { name: 'Ideogram', status: 'API' },
  { name: 'Recraft', status: 'API' },
  { name: 'Leonardo', status: 'API' },
  { name: 'FLUX', status: 'Async' },
  { name: 'Stability', status: 'API' },
];

export default function FashionStudio() {
  const [activeTool, setActiveTool] = useState('Create Look');
  const [activeProvider, setActiveProvider] = useState('OpenAI Images');
  const [prompt, setPrompt] = useState('');
  const [referenceAsset, setReferenceAsset] = useState(null);
  const { assetUrl, error, generating, jobStatus, status, runGenerate } = useStudioGenerate('image');
  const { hasCredits, isCEO } = useSubscription();
  const { providers } = useStudio();

  const providerOptions = useMemo(() => {
    const connected = new Set(providers.filter((item) => item.connected).map((item) => item.name));
    return DEFAULT_PROVIDERS.map((provider) => ({
      ...provider,
      available: connected.has(provider.name) || connected.has('Flux') && provider.name === 'FLUX',
    }));
  }, [providers]);

  const handleGenerate = () => {
    if (!hasCredits && !isCEO) {
      alert('Log in and add credits to continue.');
      return;
    }

    const fashionPrompt = [
      `Fashion studio task: ${activeTool}`,
      prompt || 'High-end editorial fashion look with coherent styling.',
      'Output: apparel-focused visual suitable for campaign or lookbook.',
    ].join('\n');

    runGenerate({
      title: `Fashion · ${activeTool}`,
      prompt: fashionPrompt,
      provider: activeProvider === 'FLUX' ? 'Flux' : activeProvider,
      providerLabel: activeProvider,
      tool: activeTool,
      module: 'fashion',
      referenceAssets: referenceAsset ? [referenceAsset] : [],
      referenceImageUrl: referenceAsset?.publicUrl || '',
      referenceAssetIds: referenceAsset ? [referenceAsset.id] : [],
      assetUrls: referenceAsset ? [referenceAsset.publicUrl] : [],
    });
  };

  const handleSaveProject = () => {
    if (!assetUrl) {
      alert('Generate a look before saving the project.');
      return;
    }
    const projects = readStore(storageKeys.projects, []);
    const entry = {
      id: `fashion_${Date.now()}`,
      kind: 'fashion',
      tool: activeTool,
      provider: activeProvider,
      prompt,
      assetUrl,
      createdAt: new Date().toISOString(),
    };
    writeStore(storageKeys.projects, [entry, ...projects].slice(0, 30));
    alert('Look guardado en proyectos locales.');
  };

  return (
    <div className="studio studio-container">
      <aside className="studio-rail">
        <p className="studio-rail-label">Fashion</p>
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
          <h1 className="studio-main-title">Fashion Studio</h1>
          <p className="studio-main-meta">{activeTool} · {status || 'Ready'}</p>
        </header>

        <div className="studio-image-grid studio-glass-panel">
          {assetUrl ? (
            <img className="studio-generated-asset" src={assetUrl} alt="Fashion look" />
          ) : (
            <div className="studio-media-placeholder" style={{ minHeight: 280 }} aria-hidden="true" />
          )}
        </div>
        {error ? <p className="studio-error-note">{error}</p> : null}
        {generating ? <p className="studio-async-note">{jobStatus} · {status}</p> : null}

        <ReferenceUploader
          kind="image"
          label="Look / Model Reference"
          role={activeTool}
          note="fashion"
          onAsset={setReferenceAsset}
        />

        <div className="studio-input-bar">
          <input
            type="text"
            className="studio-input"
            placeholder="Describe the garment, palette, silhouette or editorial direction..."
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button
            type="button"
            className="studio-button"
            disabled={generating || (!hasCredits && !isCEO)}
            onClick={handleGenerate}
          >
            {generating ? 'Generating...' : 'Generate'}
          </button>
        </div>

        <div className="studio-controls">
          <button type="button" className="studio-action" disabled={generating} onClick={handleGenerate}>
            [ Generate ]
          </button>
          <button type="button" className="studio-action" onClick={handleSaveProject}>
            [ Save Project ]
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
                <span className="studio-provider-name">{provider.name}</span>
                <span className="studio-provider-status">{provider.available ? provider.status : 'Offline'}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
