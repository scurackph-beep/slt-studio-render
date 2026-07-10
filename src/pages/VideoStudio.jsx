import { useState } from 'react';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
import './StudioLayout.css';

const TOOLS = [
  { label: 'Idea to Film', desc: 'Describe your vision' },
  { label: 'Script', desc: 'Write or generate' },
  { label: 'Shot Builder', desc: 'Camera angles & moves' },
  { label: 'Storyboard', desc: 'Plan your scenes' },
  { label: 'Text to Video', desc: 'Prompt to video' },
  { label: 'Image to Video', desc: 'Animate a still' },
  { label: 'Motion Transfer', desc: 'Clone movement' },
  { label: 'Casting / Clone', desc: 'Upload face to clone' },
  { label: 'Change Background', desc: 'Swap scenery / set' },
  { label: 'Change Wardrobe', desc: 'Outfit & hair color' },
  { label: 'Style & Effects', desc: 'Filters, color grade' },
  { label: 'Edit / Timeline', desc: 'Cut, trim, arrange' },
  { label: 'Export', desc: 'Render & download' },
];

const PROVIDERS = [
  { name: 'Veo 3', status: 'new' },
  { name: 'Seedance 2.0', status: 'connected' },
  { name: 'Wan', status: 'connected' },
  { name: 'Runway', status: 'connected' },
  { name: 'Luma', status: 'connected' },
  { name: 'Kling', status: 'connected' },
  { name: 'Pika', status: 'connected' },
  { name: 'MiniMax / Hailuo', status: 'connected' },
  { name: 'PixVerse', status: 'connected' },
  { name: 'HeyGen', status: 'connected' },
  { name: 'D-ID', status: 'connected' },
  { name: 'OmniHuman', status: 'connected' },
  { name: 'Hunyuan', status: 'connected' },
  { name: 'FFmpeg', status: 'internal' },
];

const TRACKS = [
  { name: 'Video Track', color: '#ff3333' },
  { name: 'Audio Track', color: '#33aaff' },
  { name: 'Music Track', color: '#aa33ff' },
];

export default function VideoStudio() {
  const [activeTool, setActiveTool] = useState('Shot Builder');
  const [activeProvider, setActiveProvider] = useState('Seedance 2.0');
  const [isPlaying, setIsPlaying] = useState(false);
  const [prompt, setPrompt] = useState('');
  const { generating, status, runGenerate } = useStudioGenerate('video');

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
        <p className="studio-rail-label">Video / Film</p>
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
          <h1 className="studio-main-title">Video Studio</h1>
          <p className="studio-main-meta">
            {activeTool} · 00:00:00 · {status || 'All changes saved'}
          </p>
        </header>

        <div className="studio-preview">
          <div className="studio-preview-inner">
            <div className="studio-media-placeholder" aria-hidden="true" />
            <p>Your story starts here.</p>
          </div>
        </div>

        <div className="studio-controls">
          <button type="button" className="studio-action">[ Projects ]</button>
          <div className="studio-control-group">
            <span className="studio-control-label">Ratio</span>
            <select className="studio-select">
              <option>16:9</option>
              <option>9:16</option>
              <option>1:1</option>
              <option>4:3</option>
            </select>
          </div>
          <div className="studio-control-group">
            <span className="studio-control-label">Quality</span>
            <select className="studio-select">
              <option>4K</option>
              <option>1080p</option>
              <option>720p</option>
            </select>
          </div>
          <button type="button" className="studio-action" disabled={generating} onClick={handleGenerate}>
            [ Generate ]
          </button>
        </div>

        <div className="studio-transport">
          <button type="button" className="studio-action">[ ◀◀ ]</button>
          <button
            type="button"
            className={`studio-action ${isPlaying ? 'is-active' : ''}`}
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? '[ Pause ]' : '[ Play ]'}
          </button>
          <button type="button" className="studio-action">[ ▶▶ ]</button>
          <button type="button" className="studio-action">[ Loop ]</button>
          <span className="studio-timecode">00:00:00:00</span>
        </div>

        <table className="studio-table">
          <thead>
            <tr>
              <th>Track</th>
              <th>Actions</th>
              <th>Waveform</th>
            </tr>
          </thead>
          <tbody>
            {TRACKS.map((track) => (
              <tr key={track.name}>
                <td>{track.name}</td>
                <td>
                  <div className="studio-table-actions">
                    <button type="button" className="studio-action">[ View ]</button>
                    <button type="button" className="studio-action">[ Mute ]</button>
                  </div>
                </td>
                <td>
                  <div className="studio-media-placeholder" style={{ height: 32, minHeight: 32, opacity: 0.2 }} aria-hidden="true" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="studio-transport">
          <span className="studio-control-label">Zoom</span>
          <input type="range" className="studio-zoom" min="0" max="100" defaultValue="50" />
          <button type="button" className="studio-action">[ Full ]</button>
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
            <li key={p.name}>
              <button
                type="button"
                className={`studio-provider-item ${activeProvider === p.name ? 'is-active' : ''}`}
                onClick={() => setActiveProvider(p.name)}
              >
                <span className="studio-provider-name">{p.name}</span>
                <span className="studio-provider-status">
                  {p.status === 'new' ? 'New' : p.status === 'internal' ? 'Internal' : 'On'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="studio-settings">
          <p className="studio-aside-label">Settings</p>
          <label className="studio-field">
            <span>Model</span>
            <select className="studio-select">
              <option>Seedance 2.0</option>
              <option>Veo 3</option>
              <option>Wan 2.1</option>
            </select>
          </label>
          <label className="studio-field">
            <span>Quality</span>
            <select className="studio-select">
              <option>High</option>
              <option>Standard</option>
              <option>Draft</option>
            </select>
          </label>
          <label className="studio-field">
            <span>Duration</span>
            <select className="studio-select">
              <option>5 seconds</option>
              <option>10 seconds</option>
              <option>15 seconds</option>
            </select>
          </label>
        </div>
      </aside>
    </div>
  );
}
