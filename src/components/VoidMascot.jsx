import { useEffect, useState } from 'react';
import './VoidMascot.css';

const PREVIEW_KEY = 'slt-void-preview-dismissed';

const SPRITE = {
  sheetWidth: 839,
  sheetHeight: 1024,
  rows: 8,
  walkRow: 1,
  walkFrames: 7,
};

const FRAME_WIDTH = Math.floor(SPRITE.sheetWidth / SPRITE.walkFrames);
const FRAME_HEIGHT = Math.floor(SPRITE.sheetHeight / SPRITE.rows);
const DISPLAY_HEIGHT = 76;
const SCALE = DISPLAY_HEIGHT / FRAME_HEIGHT;
const DISPLAY_FRAME_WIDTH = FRAME_WIDTH * SCALE;
const SCALED_SHEET_WIDTH = SPRITE.sheetWidth * SCALE;
const SCALED_SHEET_HEIGHT = SPRITE.sheetHeight * SCALE;
const WALK_ROW_Y = SPRITE.walkRow * FRAME_HEIGHT * SCALE;

export default function VoidMascot({ preview = true }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    if (preview && window.sessionStorage.getItem(PREVIEW_KEY) === '1') {
      return undefined;
    }

    const showTimer = window.setTimeout(() => setVisible(true), 1200);
    return () => window.clearTimeout(showTimer);
  }, [preview]);

  const dismissPreview = () => {
    window.sessionStorage.setItem(PREVIEW_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  const spriteStyle = {
    '--void-frame-width': `${DISPLAY_FRAME_WIDTH}px`,
    '--void-frame-height': `${DISPLAY_HEIGHT}px`,
    '--void-sheet-width': `${SCALED_SHEET_WIDTH}px`,
    '--void-sheet-height': `${SCALED_SHEET_HEIGHT}px`,
    '--void-walk-y': `${WALK_ROW_Y}px`,
    '--void-frames': SPRITE.walkFrames,
  };

  return (
    <div className="void-mascot-layer" aria-hidden="true">
      {preview ? (
        <div className="void-mascot-preview-badge">
          <span>VOID · preview</span>
          <button type="button" onClick={dismissPreview} aria-label="Hide Void preview">
            Hide
          </button>
        </div>
      ) : null}

      <div className="void-mascot-track" style={spriteStyle}>
        <div className="void-mascot void-mascot--walk" />
      </div>
    </div>
  );
}
