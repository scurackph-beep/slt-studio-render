import {
  AlertCircle,
  Coins,
  Download,
  Heart,
  Loader2,
  RefreshCw,
  Share2,
  Sparkles,
  Upload,
} from 'lucide-react';

const STATE_COPY = {
  idle: {
    title: 'Ready to generate',
    body: 'Configure provider, model and prompt. Your result will appear here.',
  },
  uploading: {
    title: 'Uploading reference',
    body: 'Validating and storing your file in SLT asset storage.',
  },
  queued: {
    title: 'Queued',
    body: 'Your job is waiting for provider capacity.',
  },
  processing: {
    title: 'Processing',
    body: 'The model is rendering your request. Keep this page open.',
  },
  completed: {
    title: 'Completed',
    body: 'Your asset is ready. Download, share or save it to favorites.',
  },
  failed: {
    title: 'Generation failed',
    body: 'Review the error message and adjust your prompt or provider.',
  },
  'insufficient-credits': {
    title: 'Insufficient credits',
    body: 'Add credits or choose a lower-cost provider to continue.',
  },
};

export default function GenerationCanvas({
  status = 'idle',
  preview = null,
  error = '',
  creditCost = null,
  creditLabel = 'Estimated cost',
  canGenerate = false,
  canCancel = false,
  isGenerating = false,
  onGenerate,
  onCancel,
  actions = [],
  children,
}) {
  const copy = STATE_COPY[status] || STATE_COPY.idle;

  return (
    <div className="gen-canvas">
      <div className={`gen-canvas-stage gen-canvas-stage--${status}`}>
        {status === 'processing' || status === 'uploading' || status === 'queued' ? (
          <div className="gen-canvas-loader" aria-hidden="true">
            <Loader2 size={28} className="gen-spin" />
          </div>
        ) : null}

        {preview ? (
          <div className="gen-canvas-preview">{preview}</div>
        ) : (
          <div className="gen-canvas-empty">
            <Sparkles size={22} strokeWidth={1.5} />
            <h3>{copy.title}</h3>
            <p>{error || copy.body}</p>
          </div>
        )}

        {status === 'failed' || status === 'insufficient-credits' ? (
          <div className="gen-canvas-alert">
            <AlertCircle size={16} />
            <span>{error || copy.body}</span>
          </div>
        ) : null}
      </div>

      {children ? <div className="gen-canvas-extra">{children}</div> : null}

      <footer className="gen-canvas-footer">
        <div className="gen-canvas-cost">
          <Coins size={16} />
          <div>
            <span>{creditLabel}</span>
            <strong>{creditCost ?? '—'}</strong>
          </div>
        </div>

        <div className="gen-canvas-actions">
          {canCancel ? (
            <button type="button" className="gen-button gen-button--ghost" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="gen-button gen-button--primary"
            disabled={!canGenerate || isGenerating}
            onClick={onGenerate}
          >
            {isGenerating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </footer>

      {actions.length ? (
        <div className="gen-canvas-quick-actions">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="gen-chip"
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.icon === 'download' ? <Download size={14} /> : null}
              {action.icon === 'share' ? <Share2 size={14} /> : null}
              {action.icon === 'retry' ? <RefreshCw size={14} /> : null}
              {action.icon === 'favorite' ? <Heart size={14} /> : null}
              {action.icon === 'upload' ? <Upload size={14} /> : null}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
