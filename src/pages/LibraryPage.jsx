import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  assetDownloadUrl,
  deleteAsset,
  fetchAssets,
  fetchProjects,
  fetchScenes,
  fetchVersions,
  runAssetAction,
  updateAsset,
} from '../lib/api-client';
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
  const navigate = useNavigate();
  const [assets, setAssets] = useState([]);
  const [projects, setProjects] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [versions, setVersions] = useState([]);
  const [status, setStatus] = useState('Loading library...');
  const [busyId, setBusyId] = useState('');
  const [kind, setKind] = useState('all');
  const [projectId, setProjectId] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState(new URLSearchParams(window.location.search).get('assetId') || '');
  const [displayName, setDisplayName] = useState('');

  const refresh = useCallback(async () => {
    setStatus('Loading library...');
    const [result, projectResult, sceneResult, versionResult] = await Promise.all([
      fetchAssets({ kind: kind === 'all' ? '' : kind, projectId }),
      fetchProjects(),
      fetchScenes(projectId),
      fetchVersions(selectedAssetId),
    ]);
    if (!result.ok) {
      setStatus(result.message || result.data?.readableError || 'Could not load library.');
      setAssets([]);
      return;
    }
    setAssets(result.data.assets || []);
    if (projectResult.ok) setProjects(projectResult.data.projects || []);
    if (sceneResult.ok) setScenes(sceneResult.data.scenes || []);
    if (versionResult.ok) setVersions(versionResult.data.versions || []);
    setStatus(result.data.assets?.length ? 'CDN assets loaded.' : 'No creations yet.');
  }, [kind, projectId, selectedAssetId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedAsset = assets.find((item) => item.id === selectedAssetId) || null;
  const visibleVersions = useMemo(() => selectedAssetId ? versions : [], [selectedAssetId, versions]);

  useEffect(() => {
    setDisplayName(selectedAsset?.displayName || selectedAsset?.originalName || '');
  }, [selectedAsset]);

  const handleDelete = async (assetId) => {
    setBusyId(assetId);
    const result = await deleteAsset(assetId);
    if (!result.ok) setStatus(result.message || result.data?.readableError || 'Could not delete asset.');
    await refresh();
    setBusyId('');
  };

  const handleUpdateAsset = async () => {
    if (!selectedAssetId) return setStatus('Select an Asset first.');
    setBusyId(selectedAssetId);
    const result = await updateAsset(selectedAssetId, {
      displayName: displayName.trim() || undefined,
      projectId: projectId || null,
    });
    setStatus(result.ok ? 'Asset metadata updated.' : result.message || 'Could not update Asset.');
    await refresh();
    setBusyId('');
  };

  const handleAction = async (asset, action) => {
    setBusyId(asset.id);
    const result = await runAssetAction(asset.id, action, {
      sceneId: sceneId || undefined,
      referenceType: asset.kind === 'music' ? 'MUSIC' : asset.kind === 'sound' ? 'AUDIO' : 'IMAGE',
      name: asset.displayName || asset.originalName || `${asset.kind} reference`,
    });
    setBusyId('');
    if (!result.ok) return setStatus(result.message || result.data?.reason || 'Asset action failed.');
    setStatus(`${action.replaceAll('_', ' ')} completed.`);
    if (result.data?.navigateTo && !result.data.navigateTo.startsWith('/api/')) navigate(result.data.navigateTo);
    await refresh();
  };

  return (
    <section className="info-page library-page">
      <p className="studio-rail-label">Library</p>
      <h1 className="info-page-title">My Creations.</h1>
      <p className="info-page-body">
        Assets stored by Sweet Little Trauma Studio appear here with controlled CDN URLs.
      </p>

      <div className="studio-controls library-manager-controls">
        <label className="studio-control-group"><span className="studio-control-label">Type</span><select className="studio-select" value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All Assets</option><option value="image">Image</option><option value="video">Video</option><option value="music">Music</option><option value="sound">Sound</option><option value="audio">Audio</option></select></label>
        <label className="studio-control-group"><span className="studio-control-label">Project</span><select className="studio-select" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">All Projects</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="studio-control-group"><span className="studio-control-label">Scene target</span><select className="studio-select" value={sceneId} onChange={(event) => setSceneId(event.target.value)}><option value="">Select Scene</option>{scenes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <button type="button" className="studio-action" onClick={refresh}>[ Refresh ]</button>
      </div>

      {selectedAsset ? <div className="studio-glass-panel library-selected-editor"><div><p className="studio-aside-label">Selected Asset</p><h2>{selectedAsset.displayName || selectedAsset.originalName || selectedAsset.id}</h2><p className="studio-meta">{selectedAsset.id} · {selectedAsset.versionType || 'GENERATION'} v{selectedAsset.version || 1}</p></div><label><span>Display name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><button type="button" className="studio-action" disabled={busyId === selectedAsset.id} onClick={handleUpdateAsset}>[ Save Metadata ]</button></div> : null}

      {!assets.length ? (
        <div className="studio-glass-panel library-empty">
          <p>{status}</p>
          <div className="info-page-actions">
            <Link to="/image" className="studio-action">[ Create Image ]</Link>
            <Link to="/video" className="studio-action">[ Create Video ]</Link>
            <Link to="/music" className="studio-action">[ Create Music ]</Link>
            <Link to="/sound" className="studio-action">[ Create Sound ]</Link>
          </div>
        </div>
      ) : (
        <div className="library-grid">
          {assets.map((asset) => (
            <article key={asset.id} className={`studio-glass-panel library-card ${selectedAssetId === asset.id ? 'is-selected' : ''}`}>
              {mediaPreview(asset)}
              <div className="library-card-body">
                <p className="studio-aside-label">{asset.kind || 'asset'}</p>
                <h2>{asset.displayName || asset.originalName || asset.provider || asset.id}</h2>
                <p className="studio-meta">{asset.contentType} · {Math.round((asset.bytes || 0) / 1024)} KB · {asset.versionType || 'GENERATION'} v{asset.version || 1}</p>
                <div className="studio-toggle-row library-action-row">
                  <button type="button" className="studio-action" onClick={() => setSelectedAssetId(asset.id)}>[ Select ]</button>
                  <a className="studio-action" href={assetDownloadUrl(asset.id)}>
                    [ Download ]
                  </a>
                  {String(asset.contentType || '').startsWith('image/') ? <button type="button" className="studio-action" onClick={() => handleAction(asset, 'USE_IN_VIDEO')}>[ Use in Video ]</button> : null}
                  {String(asset.contentType || '').startsWith('video/') || String(asset.contentType || '').startsWith('image/') ? <button type="button" className="studio-action" onClick={() => handleAction(asset, 'USE_IN_IMAGE')}>[ Use in Image ]</button> : null}
                  <button type="button" className="studio-action" onClick={() => handleAction(asset, 'ADD_AS_REFERENCE')}>[ Add Reference ]</button>
                  <button type="button" className="studio-action" disabled={!sceneId} onClick={() => handleAction(asset, 'ADD_TO_SCENE')}>[ {sceneId ? 'Add to Scene' : 'Choose Scene'} ]</button>
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

      {selectedAssetId ? <section className="library-version-section"><p className="studio-rail-label">Version Lineage</p>{visibleVersions.length ? <div className="library-version-list">{visibleVersions.map((item) => <button key={item.id} type="button" className={item.id === selectedAssetId ? 'is-active' : ''} onClick={() => setSelectedAssetId(item.id)}><strong>v{item.version || 1}</strong><span>{item.versionType || 'GENERATION'}</span><small>{item.displayName || item.originalName || item.id}</small></button>)}</div> : <p className="studio-meta">This Asset has no derived versions yet.</p>}</section> : null}

      <p className="studio-async-note">{status}</p>
    </section>
  );
}
