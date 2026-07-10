import { useState } from 'react';
import { saveProject, readableStudioMessage } from '../lib/api-client';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
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

const PROVIDERS = ['OpenAI Images', 'Ideogram', 'Recraft', 'Leonardo', 'Stability', 'FLUX'];

export default function FashionStudio() {
  const [activeTool, setActiveTool] = useState('Create Look');
  const [activeProvider, setActiveProvider] = useState('Ideogram');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const { generating, status, setStatus, runGenerate } = useStudioGenerate('image');

  const handleGenerate = () => {
    runGenerate({
      title: activeTool,
      prompt,
      provider: activeProvider,
      providerLabel: activeProvider,
      tool: activeTool,
    });
  };

  const handleSaveProject = async () => {
    setSaving(true);
    setStatus('Saving look…');

    const result = await saveProject({
      title: prompt.trim() || 'Untitled look',
      kind: 'fashion',
      status: 'saved',
      provider: activeProvider,
      tool: activeTool,
      prompt,
    });

    setStatus(
      result.ok
        ? result.data.message || 'Look saved as project.'
        : readableStudioMessage(result.message),
    );
    setSaving(false);
  };

  return (
    <div className="studio">
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
          <p className="studio-main-meta">{activeTool}{status ? ` · ${status}` : ''}</p>
        </header>

        <div className="studio-image-grid">
          <div>
            <div className="studio-media-placeholder" style={{ minHeight: 280, marginBottom: 24 }} aria-hidden="true" />
            <p>Describe the look<br />Outfit, textile, palette or editorial direction.</p>
          </div>
        </div>

        <div className="studio-controls">
          <button type="button" className="studio-action" disabled={generating || saving} onClick={handleGenerate}>
            [ Generate ]
          </button>
          <button type="button" className="studio-action" disabled={generating || saving} onClick={handleSaveProject}>
            [ Save Project ]
          </button>
        </div>

        <div className="studio-prompt">
          <input
            type="text"
            className="studio-prompt-input"
            placeholder="Describe the fashion look you want to create..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button type="button" className="studio-action" disabled={generating || saving} onClick={handleGenerate}>
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
      </aside>
    </div>
  );
}
