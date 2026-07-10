import { useState } from 'react';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
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

const PROVIDERS = ['OpenAI Images', 'Google Imagen', 'Adobe Firefly', 'FLUX', 'Ideogram', 'Recraft', 'Leonardo', 'Magnific', 'Stability', 'Replicate'];
const RATIOS = ['1:1', '4:5', '16:9', '3:2', '2:3'];

export default function ImageStudio() {
  const [activeTool, setActiveTool] = useState('Text-to-Image');
  const [activeProvider, setActiveProvider] = useState('OpenAI Images');
  const [activeRatio, setActiveRatio] = useState('1:1');
  const [prompt, setPrompt] = useState('');
  const { generating, status, runGenerate } = useStudioGenerate('image');

  const handleGenerate = () => {
    runGenerate({
      title: activeTool,
      prompt,
      provider: activeProvider,
      providerLabel: activeProvider,
      tool: activeTool,
    });
  };

  return (
    <div className="studio">
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
          <p className="studio-main-meta">{activeTool} · {activeRatio}{status ? ` · ${status}` : ''}</p>
        </header>

        <div className="studio-image-grid">
          <div>
            <div className="studio-media-placeholder" style={{ minHeight: 280, marginBottom: 24 }} aria-hidden="true" />
            <p>Start creating<br />Add an image, paste a prompt, or choose a tool.</p>
          </div>
        </div>

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

        <div className="studio-prompt">
          <input
            type="text"
            className="studio-prompt-input"
            placeholder="Describe what you want to create..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button type="button" className="studio-action" disabled={generating} onClick={handleGenerate}>
            [ Generate ]
          </button>
        </div>
      </main>

      <aside className="studio-aside">
        <p className="studio-aside-label">Providers</p>
        <ul className="studio-provider-list">
          {PROVIDERS.map((p) => (
            <li key={p}>
              <button
                type="button"
                className={`studio-provider-item ${activeProvider === p ? 'is-active' : ''}`}
                onClick={() => setActiveProvider(p)}
              >
                <span className="studio-provider-name">{p}</span>
                <span className="studio-provider-status">On</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="studio-settings">
          <p className="studio-aside-label">Settings</p>
          <label className="studio-field">
            <span>Model</span>
            <select className="studio-select">
              <option>GPT-Image 1</option>
              <option>FLUX 1.1</option>
            </select>
          </label>
          <label className="studio-field">
            <span>Quality</span>
            <select className="studio-select">
              <option>High</option>
              <option>Standard</option>
            </select>
          </label>
          <label className="studio-field">
            <span>Style</span>
            <select className="studio-select">
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
