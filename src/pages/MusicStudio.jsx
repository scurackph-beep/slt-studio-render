import { useState } from 'react';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
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
const PROVIDERS = ['Suno', 'Udio', 'ElevenLabs', 'OpenAI Audio', 'Stability Audio', 'Lalal.ai', 'Moises', 'iZotope', 'FFmpeg'];
const TRACKS_DEFAULT = [
  { name: 'Vocals', color: '#ff3366', muted: false, solo: false, vol: -1.2 },
  { name: 'Drums', color: '#ff8800', muted: false, solo: false, vol: -0.5 },
  { name: 'Bass', color: '#ffcc00', muted: false, solo: false, vol: -2.1 },
  { name: 'Guitar', color: '#33ff66', muted: false, solo: false, vol: -1.8 },
  { name: 'Keys', color: '#3388ff', muted: false, solo: false, vol: -3.0 },
  { name: 'Atmosphere', color: '#aa33ff', muted: false, solo: false, vol: -4.5 },
];

export default function MusicStudio() {
  const [activeMode, setActiveMode] = useState('Manual Studio');
  const [activeTool, setActiveTool] = useState('Track Builder');
  const [tracks, setTracks] = useState(TRACKS_DEFAULT);
  const [prompt, setPrompt] = useState('');
  const { generating, status, runGenerate } = useStudioGenerate('music');

  const handleGenerate = () => {
    runGenerate({
      title: activeTool,
      prompt,
      provider: 'Suno',
      providerLabel: 'Suno',
      tool: activeTool,
    });
  };

  return (
    <div className="studio">
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
          <p className="studio-main-meta">{activeMode} · {activeTool}{status ? ` · ${status}` : ''}</p>
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

        <div className="studio-project-row">
          <div>
            <p className="studio-project-title">New Project</p>
            <p className="studio-project-sub">Sweet Little Trauma</p>
            <div className="studio-tags">
              <span className="studio-tag">Alternative</span>
              <span className="studio-tag">Dream Pop</span>
            </div>
          </div>
          <button type="button" className="studio-action">[ Play ]</button>
        </div>

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
            {tracks.map((t) => (
              <tr key={t.name}>
                <td>{t.name}</td>
                <td>
                  <div className="studio-table-actions">
                    <button type="button" className={`studio-action ${t.muted ? 'is-active' : ''}`}>M</button>
                    <button type="button" className={`studio-action ${t.solo ? 'is-active' : ''}`}>S</button>
                  </div>
                </td>
                <td>{t.vol} dB</td>
                <td>
                  <button type="button" className="studio-action">[ View ]</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="studio-prompt">
          <input
            type="text"
            className="studio-prompt-input"
            placeholder="Describe the music you want to create..."
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
