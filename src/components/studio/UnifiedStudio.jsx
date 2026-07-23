import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ReferenceUploader from '../ReferenceUploader';
import { assetDownloadUrl, fetchAssets } from '../../lib/api-client';
import { useStudioGenerate } from '../../hooks/useStudioGenerate';
import { useSubscription } from '../../hooks/useSubscription';
import { useStudio } from '../../context/StudioContext';

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function findInitialTool(tools, value) {
  const needle = normalize(value);
  if (!needle) return tools[0];
  return tools.find((tool) => (
    normalize(tool.id) === needle
    || normalize(tool.label) === needle
    || (tool.aliases || []).some((alias) => normalize(alias) === needle)
  )) || tools[0];
}

function firstProvider(tool, fallback = []) {
  return tool?.providers?.[0] || fallback?.[0]?.name || fallback?.[0] || '';
}

function initialSettings(settings = []) {
  return settings.reduce((acc, setting) => {
    acc[setting.key] = setting.defaultValue ?? setting.options?.[0] ?? '';
    return acc;
  }, {});
}

function previewFor(kind, url) {
  if (!url) return null;
  if (kind === 'video') {
    return <video className="studio-generated-asset" src={url} controls playsInline />;
  }
  if (kind === 'music' || kind === 'sound') {
    return <audio className="studio-audio-player" src={url} controls />;
  }
  return <img className="studio-generated-asset" src={url} alt="Generated asset" />;
}

function clampOutputCount(value) {
  const parsed = Number.parseInt(String(value || '1'), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(8, Math.max(1, parsed));
}

function formatElapsed(item, now) {
  const startedAt = Number(item?.startedAt || now);
  const endedAt = Number(item?.endedAt || 0);
  const seconds = Math.max(0, Math.floor(((endedAt || now) - startedAt) / 1000));
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const rest = String(seconds % 60).padStart(2, '0');
  return minutes + ':' + rest;
}

function isTerminalStatus(status = '') {
  return ['completed', 'failed', 'blocked', 'cancelled', 'canceled'].includes(String(status).toLowerCase());
}

function renderQueuePreview(kind, item) {
  if (!item?.outputUrl) return null;
  return previewFor(kind, item.outputUrl);
}

function assetThumb(asset) {
  if (!asset?.publicUrl) return <div className="studio-media-placeholder" aria-hidden="true" />;
  if (asset.contentType?.startsWith('image/')) {
    return <img className="studio-creator-library-thumb" src={asset.publicUrl} alt={asset.originalName || 'Asset'} />;
  }
  if (asset.contentType?.startsWith('video/')) {
    return <video className="studio-creator-library-thumb" src={asset.publicUrl} muted playsInline />;
  }
  if (asset.contentType?.startsWith('audio/')) {
    return <div className="studio-creator-library-audio">Audio</div>;
  }
  return <div className="studio-creator-library-audio">Asset</div>;
}

export default function UnifiedStudio({
  kind,
  module = kind,
  title,
  railLabel,
  subtitle = '',
  tools = [],
  providers = [],
  settings = [],
  referenceKind = kind,
  referenceLabel = 'Reference',
  promptPlaceholder = 'Describe what you want to create...',
  emptyLabel = 'Your generated asset will appear here.',
  buildRequest,
  extraActions,
}) {
  const [searchParams] = useSearchParams();
  const initialTool = findInitialTool(tools, searchParams.get('tool') || '');
  const { assetUrl, error, generating, jobStatus, now, queueItems, status, runGenerate } = useStudioGenerate(kind);
  const { hasCredits, isCEO, isSpy } = useSubscription();
  const { credits } = useStudio();
  const [activeToolId, setActiveToolId] = useState(initialTool?.id || tools[0]?.id || '');
  const activeTool = useMemo(
    () => tools.find((tool) => tool.id === activeToolId) || tools[0],
    [activeToolId, tools],
  );
  const [activeProvider, setActiveProvider] = useState(
    searchParams.get('provider') || firstProvider(initialTool, providers),
  );
  const [prompt, setPrompt] = useState(searchParams.get('prompt') || '');
  const [outputCount, setOutputCount] = useState(() => clampOutputCount(searchParams.get('count') || '1'));
  const [editInstruction, setEditInstruction] = useState('');
  const [referenceAsset, setReferenceAsset] = useState(null);
  const [settingValues, setSettingValues] = useState(() => initialSettings(settings));
  const [assets, setAssets] = useState([]);
  const [libraryStatus, setLibraryStatus] = useState('Loading library...');
  const [localError, setLocalError] = useState('');

  const providerOptions = useMemo(() => {
    const names = activeTool?.providers?.length
      ? activeTool.providers.map((name) => ({ name, status: 'Available' }))
      : providers.map((provider) => (typeof provider === 'string' ? { name: provider, status: 'Available' } : provider));
    return names.filter((provider) => provider?.name);
  }, [activeTool, providers]);

  useEffect(() => {
    if (!providerOptions.length) return;
    if (!providerOptions.some((provider) => provider.name === activeProvider)) {
      setActiveProvider(providerOptions[0].name);
    }
  }, [activeProvider, providerOptions]);

  const refreshLibrary = async () => {
    const result = await fetchAssets();
    if (!result.ok) {
      setAssets([]);
      setLibraryStatus(result.message || 'Library unavailable.');
      return;
    }
    const items = (result.data.assets || [])
      .filter((asset) => !asset.kind || asset.kind === kind || asset.module === module)
      .slice(0, 6);
    setAssets(items);
    setLibraryStatus(items.length ? 'Recent library ready.' : 'No saved assets yet.');
  };

  useEffect(() => {
    refreshLibrary();
  }, []);

  const updateSetting = (key, value) => {
    setSettingValues((current) => ({ ...current, [key]: value }));
  };

  const handleGenerate = async () => {
    setLocalError('');
    if (isSpy) {
      setLocalError('Spy mode is read-only. Use user, CEO or guest access to generate.');
      return;
    }
    if (!prompt.trim()) {
      setLocalError('Write what you want to create first.');
      return;
    }
    if (!hasCredits && !isCEO) {
      setLocalError('Log in and add credits to continue.');
      return;
    }

    const count = clampOutputCount(outputCount);
    const request = buildRequest?.({
      prompt,
      activeTool,
      provider: activeProvider,
      settings: settingValues,
      referenceAsset,
      outputCount: count,
      editInstruction,
    }) || {};
    const finalPrompt = [
      request.prompt || prompt,
      editInstruction.trim() ? 'Specific modification:\n' + editInstruction.trim() : '',
    ].filter(Boolean).join('\n\n');

    await runGenerate({
      title: request.title || title + ' · ' + (activeTool?.label || 'Generate'),
      prompt: finalPrompt,
      provider: request.provider || activeProvider,
      providerLabel: request.providerLabel || activeProvider,
      tool: request.tool || activeTool?.label || title,
      actionId: request.actionId || activeTool?.id,
      module,
      model: settingValues.model,
      modelId: settingValues.model,
      referenceAssets: referenceAsset ? [referenceAsset] : [],
      referenceAssetIds: referenceAsset ? [referenceAsset.id] : [],
      referenceImageUrl: referenceAsset?.contentType?.startsWith('image/') ? referenceAsset.publicUrl : '',
      referenceVideoUrl: referenceAsset?.contentType?.startsWith('video/') ? referenceAsset.publicUrl : '',
      referenceAudioUrl: referenceAsset?.contentType?.startsWith('audio/') ? referenceAsset.publicUrl : '',
      assetUrls: referenceAsset?.publicUrl ? [referenceAsset.publicUrl] : [],
      outputCount: count,
      count,
      quantity: count,
      editInstruction: editInstruction.trim(),
      ...settingValues,
      ...(request.payload || {}),
    });
    await refreshLibrary();
  };

  const currentStatus = localError || error || status || 'Ready';
  const canGenerate = !generating && Boolean(prompt.trim());
  const activeQueueItem = queueItems.find((item) => !isTerminalStatus(item.status)) || queueItems[queueItems.length - 1] || null;
  const runningCount = queueItems.filter((item) => !isTerminalStatus(item.status)).length;
  const renderedExtraActions = extraActions?.({
    assetUrl,
    activeTool,
    activeProvider,
    prompt,
    settings: settingValues,
  });

  return (
    <div className="studio studio-container studio-creator">
      <aside className="studio-rail">
        <p className="studio-rail-label">{railLabel || title}</p>
        <ul className="studio-tool-list">
          {tools.map(({ id, label, desc }) => (
            <li key={id}>
              <button
                type="button"
                className={`studio-tool-item ${activeTool?.id === id ? 'is-active' : ''}`}
                onClick={() => setActiveToolId(id)}
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
          <h1 className="studio-main-title">{title}</h1>
          <p className="studio-main-meta">
            {activeTool?.label || 'Create'} · {activeProvider || 'Provider'} · {currentStatus}
          </p>
          {subtitle ? <p className="studio-main-meta">{subtitle}</p> : null}
        </header>

        <section className="studio-glass-panel studio-creator-brief">
          <div className="studio-creator-brief-head">
            <div>
              <p className="studio-rail-label">Prompt</p>
              <p className="studio-main-meta">Start with the idea. Then choose tool, provider and parameters.</p>
            </div>
            <button type="button" className="studio-button" disabled={!canGenerate} onClick={handleGenerate}>
              {generating ? 'Generating...' : 'Generate'}
            </button>
          </div>
          <textarea
            className="studio-input studio-creator-textarea"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={promptPlaceholder}
            rows={5}
            disabled={generating}
          />
          <div className="studio-creator-output-row">
            <label className="studio-field studio-field--compact">
              <span>Outputs</span>
              <select
                className="studio-select"
                value={outputCount}
                onChange={(event) => setOutputCount(clampOutputCount(event.target.value))}
                disabled={generating}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            <label className="studio-field studio-field--wide">
              <span>Specific modification</span>
              <input
                className="studio-input"
                value={editInstruction}
                onChange={(event) => setEditInstruction(event.target.value)}
                placeholder="Optional: change one detail, keep everything else intact..."
                disabled={generating}
              />
            </label>
          </div>
        </section>

        <ReferenceUploader
          kind={referenceKind}
          label={referenceLabel}
          role={activeTool?.label || 'reference'}
          note={activeProvider}
          onAsset={setReferenceAsset}
        />

        <section className="studio-glass-panel studio-creator-settings">
          <p className="studio-rail-label">Options</p>
          <div className="studio-creator-setting-grid">
            <label className="studio-field">
              <span>Tool</span>
              <select className="studio-select" value={activeToolId} onChange={(event) => setActiveToolId(event.target.value)}>
                {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.label}</option>)}
              </select>
            </label>
            <label className="studio-field">
              <span>Provider</span>
              <select className="studio-select" value={activeProvider} onChange={(event) => setActiveProvider(event.target.value)}>
                {providerOptions.map((provider) => <option key={provider.name}>{provider.name}</option>)}
              </select>
            </label>
            {settings.map((setting) => (
              <label key={setting.key} className="studio-field">
                <span>{setting.label}</span>
                {setting.type === 'text' ? (
                  <input
                    className="studio-input"
                    value={settingValues[setting.key] || ''}
                    onChange={(event) => updateSetting(setting.key, event.target.value)}
                    placeholder={setting.placeholder || setting.label}
                  />
                ) : (
                  <select
                    className="studio-select"
                    value={settingValues[setting.key] || ''}
                    onChange={(event) => updateSetting(setting.key, event.target.value)}
                  >
                    {(setting.options || []).map((option) => <option key={option}>{option}</option>)}
                  </select>
                )}
              </label>
            ))}
          </div>
        </section>

        <section className="studio-preview studio-preview--wide studio-glass-panel studio-creator-result">
          <div className="studio-preview-inner">
            {assetUrl ? (
              <div className="studio-result-block">
                {previewFor(kind, assetUrl)}
                <a className="studio-action" href={assetUrl} target="_blank" rel="noreferrer">[ Open result ]</a>
              </div>
            ) : activeQueueItem ? (
              <div className="studio-live-render">
                <div className="studio-render-loading" aria-live="polite">
                  {renderQueuePreview(kind, activeQueueItem) || <div className="studio-render-pulse" aria-hidden="true" />}
                  <p className="studio-render-status">
                    {String(activeQueueItem.status || jobStatus || 'processing').replace(/_/g, ' ')} · {formatElapsed(activeQueueItem, now)}
                  </p>
                  <span>{activeQueueItem.message || status || emptyLabel}</span>
                </div>
              </div>
            ) : (
              <>
                <div className="studio-media-placeholder" aria-hidden="true" />
                <p>{emptyLabel}</p>
              </>
            )}
            {queueItems.length ? (
              <div className="studio-queue-panel">
                <div className="studio-queue-head">
                  <span>Queue</span>
                  <span>{runningCount ? runningCount + ' running' : 'Ready'}</span>
                </div>
                <ul className="studio-queue-list">
                  {queueItems.map((item) => (
                    <li key={item.id} className={'studio-queue-item is-' + String(item.status || 'processing').toLowerCase()}>
                      <span>{item.label}</span>
                      <span>{String(item.status || 'processing').replace(/_/g, ' ')}</span>
                      <span>{formatElapsed(item, now)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(localError || error) ? <p className="studio-error-note">{localError || error}</p> : null}
            {generating ? <p className="studio-async-note">{jobStatus || 'processing'} · {status}</p> : null}
          </div>
        </section>

        <div className="studio-controls">
          <button type="button" className="studio-action" disabled={!canGenerate} onClick={handleGenerate}>
            [ {generating ? (runningCount ? 'Generating ' + runningCount : 'Generating') : 'Generate'} ]
          </button>
          {renderedExtraActions}
          <Link to="/library" className="studio-action">[ Open library ]</Link>
          <span className="studio-meta">
            {isCEO ? 'CEO mode · API direct' : `${credits ?? '--'} CR · ${currentStatus}`}
          </span>
        </div>

        <section className="studio-glass-panel studio-creator-library">
          <div className="studio-reference-header">
            <div>
              <p className="studio-rail-label">Library</p>
              <p className="studio-meta">{libraryStatus}</p>
            </div>
            <button type="button" className="studio-action" onClick={refreshLibrary}>[ Refresh ]</button>
          </div>
          <div className="studio-creator-library-grid">
            {assets.map((asset) => (
              <a key={asset.id} href={assetDownloadUrl(asset.id)} className="studio-creator-library-item">
                {assetThumb(asset)}
                <span>{asset.originalName || asset.provider || asset.kind || 'Asset'}</span>
              </a>
            ))}
          </div>
        </section>
      </main>

      <aside className="studio-aside">
        <p className="studio-aside-label">Providers</p>
        <ul className="studio-provider-list">
          {providerOptions.map((provider) => (
            <li key={provider.name}>
              <button
                type="button"
                className={`studio-provider-item ${activeProvider === provider.name ? 'is-active' : ''}`}
                onClick={() => setActiveProvider(provider.name)}
              >
                <span>
                  <span className="studio-provider-name">{provider.name}</span>
                  {provider.model ? <span className="studio-provider-model">{provider.model}</span> : null}
                </span>
                <span className="studio-provider-status">{provider.status || 'Ready'}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
