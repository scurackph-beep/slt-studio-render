import { useId, useRef, useState } from 'react';
import { uploadReferenceAsset } from '../lib/api-client';

const ACCEPT_BY_KIND = {
  image: 'image/png,image/jpeg,image/webp,image/gif',
  video: 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime',
  music: 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/mp4,text/plain',
  sound: 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/mp4,video/mp4,video/webm,video/quicktime',
  fashion: 'image/png,image/jpeg,image/webp,image/gif,application/pdf',
};

function previewFor(asset) {
  if (!asset?.publicUrl) return null;
  if (asset.contentType?.startsWith('image/')) {
    return <img className="studio-reference-preview" src={asset.publicUrl} alt={asset.originalName || 'Reference'} />;
  }
  if (asset.contentType?.startsWith('audio/')) {
    return <audio className="studio-audio-player" src={asset.publicUrl} controls />;
  }
  if (asset.contentType?.startsWith('video/')) {
    return <video className="studio-reference-preview" src={asset.publicUrl} controls playsInline />;
  }
  return <p className="studio-meta">{asset.originalName || 'Reference uploaded'}</p>;
}

export default function ReferenceUploader({
  kind = 'image',
  label = 'Reference',
  role = 'reference',
  note = '',
  inputId: providedInputId = '',
  onAsset,
}) {
  const fallbackInputId = useId();
  const inputId = providedInputId || fallbackInputId;
  const inputRef = useRef(null);
  const [asset, setAsset] = useState(null);
  const [status, setStatus] = useState('Ready for reference upload.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setStatus('Validating and uploading...');
    const result = await uploadReferenceAsset({ file, kind, module: kind, role, note });
    if (!result.ok || !result.data?.asset) {
      const message = result.status === 401
        ? 'Log in from Profile before uploading references.'
        : result.message || result.data?.readableError || 'Upload failed.';
      setError(message);
      setStatus('Upload failed.');
      setBusy(false);
      return;
    }
    setAsset(result.data.asset);
    onAsset?.(result.data.asset);
    setStatus('Stored in SLT asset storage.');
    setBusy(false);
  };

  const clearAsset = () => {
    setAsset(null);
    onAsset?.(null);
    setStatus('Ready for reference upload.');
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    handleFile(event.dataTransfer.files?.[0]);
  };

  return (
    <section className="studio-reference-uploader">
      <div className="studio-reference-header">
        <div>
          <p className="studio-aside-label">{label}</p>
          <p className="studio-meta">{status}</p>
        </div>
        {asset ? (
          <button type="button" className="studio-action" onClick={clearAsset}>
            [ Remove ]
          </button>
        ) : null}
      </div>

      <label
        htmlFor={inputId}
        className={`studio-reference-drop ${busy ? 'is-uploading' : ''} ${dragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {asset ? previewFor(asset) : (
          <>
            <span>{busy ? 'Uploading...' : '+ Upload reference'}</span>
            <small>Click or drop file · {ACCEPT_BY_KIND[kind] || ACCEPT_BY_KIND.image}</small>
          </>
        )}
      </label>

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={ACCEPT_BY_KIND[kind] || ACCEPT_BY_KIND.image}
        className="studio-file-input"
        disabled={busy}
        onClick={(event) => {
          event.currentTarget.value = '';
        }}
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      {error ? <p className="studio-error-note">{error}</p> : null}
    </section>
  );
}
