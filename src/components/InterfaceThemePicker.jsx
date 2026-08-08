import { useEffect, useId, useRef, useState } from 'react';
import { THEME_OPTIONS, themeById } from '../lib/preferences';
import './InterfaceThemePicker.css';

export default function InterfaceThemePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const panelId = useId();
  const activeTheme = themeById(value);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="interface-theme-picker" ref={rootRef}>
      <button
        type="button"
        className="interface-theme-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="interface-theme-trigger-kicker">Interface</span>
        <span className="interface-theme-trigger-name">{activeTheme.label}</span>
        <span className="interface-theme-trigger-mood">{activeTheme.mood}</span>
      </button>

      {open ? (
        <div className="interface-theme-panel" id={panelId} role="dialog" aria-label="Choose interface world">
          <div className="interface-theme-panel-head">
            <p>Creative environments</p>
            <span>Each world changes rhythm, typography and spatial layout across the studio.</span>
          </div>

          <div className="interface-theme-grid">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`interface-theme-card ${value === option.id ? 'is-active' : ''}`}
                data-theme={option.id}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span className="interface-theme-card-top">
                  <span className="interface-theme-card-glyph">{option.glyph}</span>
                  <span className="interface-theme-card-name">{option.label}</span>
                </span>
                <span className="interface-theme-card-mood">{option.mood}</span>
                <span className="interface-theme-card-world">{option.world}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
