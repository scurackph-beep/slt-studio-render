import { useState } from 'react';
import ReferenceUploader from '../components/ReferenceUploader';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
import { useSubscription } from '../hooks/useSubscription';
import './StudioLayout.css';

const TOOLS = [
  { label: 'Text-to-Image', desc: 'Prompt to image' },
  { label: 'Image-to-Image', desc: 'Transform existing' },
  { label: 'Edit', desc: 'Crop, resize, adjust' },
  { label: 'Product', desc: 'Product photography' },
  { label: 'Fashion', desc: 'Fashion looks & outfits' },
  { label: 'Logo', desc: 'Logo generation' },
  { label: 'Ads', desc: 'Ad creatives' },
  { label: 'Upscale', desc: 'Enhance resolution' },
  { label: 'Consistency', desc: 'Character consistency' },
  { label: 'Export', desc: 'Download images' },
];

const PROVIDERS = [
  { name: 'OpenAI Images', status: 'Gateway' },
  { name: 'Gemini Image', status: 'Gateway' },
  { name: 'Grok Image', status: 'Gateway' },
  { name: 'FLUX', status: 'Async' },
  { name: 'Ideogram', status: 'API' },
  { name: 'Recraft', status: 'API' },
  { name: 'Leonardo', status: 'API' },
  { name: 'Stability', status: 'API' },
  { name: 'Replicate', status: 'Async' },
];

const RATIOS = ['1:1', '4:5', '16:9', '3:2', '2:3'];

export default function ImageStudio() {
  const [activeTool, setActiveTool] = useState('Text-to-Image');
  const [activeProvider, setActiveProvider] = useState('OpenAI Images');
  const [activeRatio, setActiveRatio] = useState('1:1');
  const [model, setModel] = useState('GPT-Image 1');
  const [quality, setQuality] = useState('High');
  const [style, setStyle] = useState('Photographic');
  const [prompt, setPrompt] = useState('');
  const [referenceAsset, setReferenceAsset] = useState(null);
  const { assetUrl, error, generating, jobStatus, status, runGenerate } = useStudioGenerate('image');
  const { hasCredits, isCEO } = useSubscription();

  const handleGenerate = () => {
    if (!hasCredits && !isCEO) {
      alert('Suscríbete para continuar');
      return;
    }
    runGenerate({
      title: activeTool,
      prompt: `${prompt}\nStyle: ${style}\nQuality: ${quality}`,
      provider: activeProvider,
      providerLabel: activeProvider,
      tool: activeTool,
      model,
      modelId: model,
      aspectRatio: activeRatio,
      ratio: activeRatio,
      quality,
      style,
      referenceAssets: referenceAsset ? [referenceAsset] : [],
      referenceImageUrl: referenceAsset?.publicUrl || '',
      referenceAssetIds: referenceAsset ? [referenceAsset.id] : [],
      assetUrls: referenceAsset ? [referenceAsset.publicUrl] : [],
    });
  };

  return (
    <div className="studio studio-container">
      <aside className="studio-rail">
        <p className="studio-rail-label">Image</p>
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
          <h1 className="studio-main-title">Image Studio</h1>
          <p className="studio-main-meta">
            {activeTool} · {activeRatio} · {status || 'Ready'}
          </p>
        </header>

        <div className="studio-image-grid studio-glass-panel">
          {assetUrl ? (
            <div className="studio-result-block">
              <img className="studio-generated-asset" src={assetUrl} alt="Generated visual" />
              <p className="studio-async-note">CDN READY · {jobStatus}</p>
            </div>
          ) : (
            <div>
              <div
                className="studio-media-placeholder"
                style={{ minHeight: 280, marginBottom: 24 }}
                aria-hidden="true"
              />
              <p>
                Start creating
                <br />
                Add an image, paste a prompt, or choose a tool.
              </p>
            </div>
          )}
        </div>
        {error ? <p className="studio-error-note">{error}</p> : null}

        <ReferenceUploader
          kind="image"
          label="Image Reference"
          role={activeTool === 'Image-to-Image' ? 'image-to-image' : 'reference'}
          note={activeTool}
          onAsset={setReferenceAsset}
        />

        <div className="studio-toggle-row">
          {RATIOS.map((r) => (
            <button
              key={r}
              type="button"
              className={`studio-action ${activeRatio === r ? 'is-active' : ''}`}
              onClick={() => setActiveRatio(r)}
            >
              [ {r} ]
            </button>
          ))}
        </div>

        <div className="studio-input-bar">
          <input
            type="text"
            className="studio-input"
            placeholder="Describe what you want to create..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
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
          {PROVIDERS.map((provider) => (
            <li key={provider.name}>
              <button
                type="button"
                className={`studio-provider-item ${activeProvider === provider.name ? 'is-active' : ''}`}
                onClick={() => setActiveProvider(provider.name)}
              >
                <span className="studio-provider-name">{provider.name}</span>
                <span className="studio-provider-status">{provider.status}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="studio-settings">
          <p className="studio-aside-label">Settings</p>
          <label className="studio-field">
            <span>Model</span>
            <select className="studio-select" value={model} onChange={(event) => setModel(event.target.value)}>
              <option>GPT-Image 1</option>
              <option>FLUX 1.1</option>
            </select>
          </label>
          <label className="studio-field">
            <span>Quality</span>
            <select className="studio-select" value={quality} onChange={(event) => setQuality(event.target.value)}>
              <option>High</option>
              <option>Standard</option>
            </select>
          </label>
          <label className="studio-field">
            <span>Style</span>
            <select className="studio-select" value={style} onChange={(event) => setStyle(event.target.value)}>
              <option>Photographic</option>
              <option>Anime</option>
              <option>Digital Art</option>
            </select>
          </label>
        </div>
      </aside>
    </div>
  );
}
