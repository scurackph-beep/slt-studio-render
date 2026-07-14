import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { assetDownloadUrl, deleteAsset, fetchAssets } from '../lib/api-client';
import './StudioLayout.css';

function mediaPreview(asset) {
  if (asset.contentType?.startsWith('image/')) {
    return <img className="studio-generated-asset" src={asset.publicUrl} alt={asset.originalName || asset.id} />;
  }
  if (asset.contentType?.startsWith('video/')) {
    return <video className="studio-generated-asset" src={asset.publicUrl} controls playsInline />;
  }
  if (asset.contentType?.startsWith('audio/')) {
    return <audio className="studio-audio-player" src={asset.publicUrl} controls />;
  }
  return <div className="studio-media-placeholder" aria-hidden="true" />;
}

export default function LibraryPage() {
  const [assets, setAssets] = useState([]);
  const [status, setStatus] = useState('Loading library...');
  const [busyId, setBusyId] = useState('');

  const refresh = async () => {
    setStatus('Loading library...');
    const result = await fetchAssets();
    if (!result.ok) {
      setStatus(result.message || result.data?.readableError || 'Could not load library.');
      setAssets([]);
      return;
    }
    setAssets(result.data.assets || []);
    setStatus(result.data.assets?.length ? 'CDN assets loaded.' : 'No creations yet.');
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleDelete = async (assetId) => {
    setBusyId(assetId);
    const result = await deleteAsset(assetId);
    if (!result.ok) setStatus(result.message || result.data?.readableError || 'Could not delete asset.');
    await refresh();
    setBusyId('');
  };

  return (
    <section className="info-page library-page">
      <p className="studio-rail-label">Library</p>
      <h1 className="info-page-title">My Creations.</h1>
      <p className="info-page-body">
        Assets stored by Sweet Little Trauma Studio appear here with controlled CDN URLs.
      </p>

      {!assets.length ? (
        <div className="studio-glass-panel library-empty">
          <p>{status}</p>
          <div className="info-page-actions">
            <Link to="/image" className="studio-action">[ Create Image ]</Link>
            <Link to="/video" className="studio-action">[ Create Video ]</Link>
          </div>
        </div>
      ) : (
        <div className="library-grid">
          {assets.map((asset) => (
            <article key={asset.id} className="studio-glass-panel library-card">
              {mediaPreview(asset)}
              <div className="library-card-body">
                <p className="studio-aside-label">{asset.kind || 'asset'}</p>
                <h2>{asset.originalName || asset.provider || asset.id}</h2>
                <p className="studio-meta">{asset.contentType} · {Math.round((asset.bytes || 0) / 1024)} KB</p>
                <div className="studio-toggle-row">
                  <a className="studio-action" href={assetDownloadUrl(asset.id)}>
                    [ Download ]
                  </a>
                  <button
                    type="button"
                    className="studio-action"
                    disabled={busyId === asset.id}
                    onClick={() => handleDelete(asset.id)}
                  >
                    [ {busyId === asset.id ? 'Deleting' : 'Delete'} ]
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="studio-async-note">{status}</p>
    </section>
  );
}
