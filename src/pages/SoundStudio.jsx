import { useState } from 'react';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
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

const PROVIDERS = ['ElevenLabs', 'Dolby.io', 'iZotope', 'Stability Audio', 'OpenAI Audio', 'FFmpeg'];

export default function SoundStudio() {
  const [activeTool, setActiveTool] = useState('Voice');
  const [prompt, setPrompt] = useState('');
  const { generating, status, runGenerate } = useStudioGenerate('sound');

  const handleGenerate = () => {
    runGenerate({
      title: activeTool,
      prompt,
      provider: 'ElevenLabs',
      providerLabel: 'ElevenLabs',
      tool: activeTool,
    });
  };

  return (
    <div className="studio">
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

        <div className="studio-preview studio-preview--wide">
          <div className="studio-preview-inner">
            <div className="studio-media-placeholder" aria-hidden="true" />
            <p>Neon Dreams — 03:47 · 48kHz · 24bit · Stereo</p>
          </div>
        </div>

        <div className="studio-controls">
          <button type="button" className="studio-action">[ Import ]</button>
          <span className="studio-meta">Ready</span>
          <button type="button" className="studio-action" disabled={generating} onClick={handleGenerate}>
            [ Generate ]
          </button>
          <button type="button" className="studio-action">[ Play ]</button>
        </div>

        <div className="studio-prompt">
          <input
            type="text"
            className="studio-prompt-input"
            placeholder="Describe the sound you want to create..."
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
              <button type="button" className="studio-provider-item">
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
