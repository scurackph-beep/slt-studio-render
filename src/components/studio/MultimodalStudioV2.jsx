import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStudioGenerate } from '../../hooks/useStudioGenerate';
import {
  assetDownloadUrl,
  estimateGenerationCost,
  extractVideoFrame,
  fetchAssets,
  fetchCharacters,
  fetchGenerationBatches,
  fetchGenerationJobs,
  fetchGenerationSessions,
  fetchHistory,
  fetchModelCapabilities,
  fetchProjects,
  fetchReferences,
  getApiBase,
  linkCharacterAsset,
  resolveModelRoute,
  saveProject,
  createReference,
  uploadReferenceAsset,
} from '../../lib/api-client';
import { useAuth } from '../../context/AuthContext';
import { useStudio } from '../../context/StudioContext';
import StudioErrorPanel from './StudioErrorPanel';
import '../../pages/VideoStudioV2Preview.css';

const LEFT_TABS = ['Projects', 'Sessions', 'Assets', 'Characters', 'References'];
const PRIORITIES = ['quality', 'speed', 'cost'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'canceled']);

const VIDEO_OPERATIONS = [
  ['text_to_video', 'Text to Video'],
  ['image_to_video', 'Image to Video'],
  ['references_to_video', 'References to Video'],
  ['video_to_video', 'Video to Video'],
  ['reality_transform', 'Reality Transform'],
  ['scene_builder', 'Scene Builder'],
  ['first_last_frame', 'First / Last Frame'],
  ['keyframes', 'Keyframes'],
  ['character_performance', 'Character Performance'],
  ['lip_sync', 'Lip Sync'],
  ['stylize', 'Stylize'],
  ['background_replacement', 'Background Replacement'],
  ['remove_object', 'Remove Object'],
  ['color_grade', 'Color Grade'],
  ['lighting', 'Lighting'],
  ['weather', 'Weather'],
  ['time_of_day', 'Time of Day'],
  ['seamless_loop', 'Seamless Loop'],
  ['stitch', 'Stitch'],
  ['upscale', 'Upscale'],
  ['frame_extraction', 'Frame Extraction'],
];

const IMAGE_OPERATIONS = [
  ['text_to_image', 'Text to Image'],
  ['image_to_image', 'Image to Image'],
  ['references_to_image', 'References to Image'],
  ['character_image', 'Character Image'],
  ['product_image', 'Product Image'],
  ['style_transfer', 'Style Transfer'],
  ['inpaint', 'Inpaint'],
  ['outpaint', 'Outpaint'],
  ['remove_object', 'Remove Object'],
  ['background_replacement', 'Background Replacement'],
  ['product_reshoot', 'Product Reshoot'],
  ['mockup', 'Mockup'],
  ['create_ad', 'Create Ad'],
  ['vary_ad', 'Vary Ad'],
  ['ad_concepter', 'Ad Concepter'],
  ['ad_localization', 'Ad Localization'],
  ['generative_expand', 'Generative Expand'],
  ['upscale', 'Upscale'],
];

const CAMERA_OPTIONS = ['Slow dolly in', 'Locked tripod', 'Handheld', 'Orbit', 'Crane down', 'Tracking shot'];
const SHOT_OPTIONS = ['Medium full shot', 'Close-up', 'Wide shot', 'Extreme close-up', 'Over shoulder'];
const LENS_OPTIONS = ['24mm spherical', '35mm anamorphic', '50mm prime', '85mm portrait', 'Macro'];
const LIGHT_OPTIONS = ['Soft architectural', 'Hard editorial', 'Practical night', 'Natural daylight', 'Studio beauty'];
const COLOR_OPTIONS = ['Natural editorial', 'Clean commercial', 'Bleach bypass', 'Warm tungsten', 'Cold cyan', 'Monochrome'];
const COMPOSITION_OPTIONS = ['Rule of thirds', 'Centered symmetry', 'Negative space', 'Diagonal tension', 'Layered depth'];
const PHOTO_OPTIONS = ['Editorial portrait', 'Product photography', 'Documentary', 'Fine art', 'Campaign still'];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function mediaUrl(value = '') {
  if (!value) return '';
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  return `${getApiBase()}${value.startsWith('/') ? '' : '/'}${value}`;
}

function outputUrlFor(item = {}) {
  const value = item || {};
  return value.publicUrl
    || value.outputUrl
    || value.outputUrls?.[0]
    || value.result?.outputUrl
    || value.result?.outputUrls?.[0]
    || value.result?.previewUrl
    || '';
}

function contentTypeFor(item = {}, fallback = '') {
  const value = item || {};
  return value.contentType || (outputUrlFor(value).match(/\.(mp4|mov|webm)(\?|$)/i) ? 'video/mp4' : fallback);
}

function elapsedLabel(startedAt, endedAt, now) {
  const start = new Date(startedAt || now).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function statusLabel(value = '') {
  const status = String(value || '').toLowerCase();
  if (status === 'pending' || status === 'queued') return 'Pending';
  if (status === 'throttled') return 'Waiting';
  if (status === 'processing' || status === 'in_progress') return 'Processing';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled' || status === 'canceled') return 'Cancelled';
  if (status === 'failed') return 'Error';
  return status || 'Pending';
}

function modelDurations(model, modality) {
  const durations = model?.outputs?.durations;
  if (Array.isArray(durations)) return durations;
  if (durations && typeof durations === 'object') {
    const min = Number(durations.min || 2);
    const max = Number(durations.max || 30);
    return unique([min, 5, 10, 15, 20, max].filter((value) => value >= min && value <= max));
  }
  return modality === 'video' ? [5, 10] : [];
}

function itemPreview(item = {}) {
  const value = item || {};
  return mediaUrl(outputUrlFor(value) || value.asset?.publicUrl || value.previewAsset?.publicUrl || value.latestAsset?.publicUrl || '');
}

function itemTitle(item = {}, fallback = 'Untitled') {
  const value = item || {};
  return value.title || value.name || value.originalName || value.label || fallback;
}

export default function MultimodalStudioV2({ modality = 'video' }) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const isVideo = modality === 'video';
  const { isSpy } = useAuth();
  const { credits, heldCredits } = useStudio();
  const generator = useStudioGenerate(modality);
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const sourceAssetId = query.get('sourceAssetId') || query.get('referenceAssetId') || '';
  const queryLastFrameAssetId = query.get('lastFrameAssetId') || '';
  const initialOperation = query.get('operation') || (isVideo ? (sourceAssetId ? 'image_to_video' : 'text_to_video') : (sourceAssetId ? 'image_to_image' : 'text_to_image'));

  const [leftTab, setLeftTab] = useState('Projects');
  const [canvasTab, setCanvasTab] = useState('Canvas');
  const [rightTab, setRightTab] = useState('Create');
  const [bottomTab, setBottomTab] = useState('Queue');
  const [search, setSearch] = useState('');
  const [projects, setProjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [assets, setAssets] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [references, setReferences] = useState([]);
  const [history, setHistory] = useState([]);
  const [batches, setBatches] = useState([]);
  const [persistedJobs, setPersistedJobs] = useState([]);
  const [capabilities, setCapabilities] = useState({ operations: [], models: [] });
  const [workspaceBusy, setWorkspaceBusy] = useState(true);
  const [notice, setNotice] = useState('Loading the shared SLT workspace...');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState(sourceAssetId);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState(sourceAssetId ? [sourceAssetId] : []);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState([]);
  const [firstFrameAssetId, setFirstFrameAssetId] = useState(sourceAssetId && isVideo && !queryLastFrameAssetId ? sourceAssetId : '');
  const [lastFrameAssetId, setLastFrameAssetId] = useState(queryLastFrameAssetId);
  const [prompt, setPrompt] = useState(query.get('prompt') || '');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [operation, setOperation] = useState(initialOperation);
  const [priority, setPriority] = useState('quality');
  const [modelId, setModelId] = useState('AUTO');
  const [outputCount, setOutputCount] = useState(1);
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('1080p');
  const [quality, setQuality] = useState('High');
  const [camera, setCamera] = useState(CAMERA_OPTIONS[0]);
  const [shot, setShot] = useState(SHOT_OPTIONS[0]);
  const [lens, setLens] = useState(LENS_OPTIONS[1]);
  const [lighting, setLighting] = useState(LIGHT_OPTIONS[0]);
  const [color, setColor] = useState(COLOR_OPTIONS[0]);
  const [composition, setComposition] = useState(COMPOSITION_OPTIONS[0]);
  const [photography, setPhotography] = useState(PHOTO_OPTIONS[0]);
  const [sceneStart, setSceneStart] = useState('');
  const [sceneEnd, setSceneEnd] = useState('');
  const [movementPrompt, setMovementPrompt] = useState('');
  const [generateAudio, setGenerateAudio] = useState(false);
  const [estimatedCredits, setEstimatedCredits] = useState(null);
  const [routePreview, setRoutePreview] = useState(null);
  const [sceneBuilder, setSceneBuilder] = useState(query.get('mode') === 'scene-builder');
  const [sceneStep, setSceneStep] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [playhead, setPlayhead] = useState(0);

  const refreshWorkspace = useCallback(async () => {
    setWorkspaceBusy(true);
    const [projectResult, sessionResult, assetResult, characterResult, referenceResult, historyResult, batchResult, jobResult, capabilityResult] = await Promise.all([
      fetchProjects(),
      fetchGenerationSessions(modality),
      fetchAssets(),
      fetchCharacters(),
      fetchReferences(),
      fetchHistory(modality),
      fetchGenerationBatches(modality),
      fetchGenerationJobs(modality, 80),
      fetchModelCapabilities(modality),
    ]);
    if (projectResult.ok) setProjects(asArray(projectResult.data?.projects));
    if (sessionResult.ok) setSessions(asArray(sessionResult.data?.sessions));
    if (assetResult.ok) setAssets(asArray(assetResult.data?.assets));
    if (characterResult.ok) setCharacters(asArray(characterResult.data?.characters));
    if (referenceResult.ok) setReferences(asArray(referenceResult.data?.references));
    if (historyResult.ok) setHistory(asArray(historyResult.data?.history));
    if (batchResult.ok) setBatches(asArray(batchResult.data?.batches));
    if (jobResult.ok) setPersistedJobs(asArray(jobResult.data?.jobs));
    if (capabilityResult.ok) setCapabilities({
      operations: asArray(capabilityResult.data?.operations),
      models: asArray(capabilityResult.data?.models),
    });
    const failures = [projectResult, sessionResult, assetResult, characterResult, referenceResult, historyResult, batchResult, jobResult, capabilityResult]
      .filter((result) => !result.ok);
    setNotice(failures.length ? failures[0].message : 'Shared workspace synchronized.');
    setWorkspaceBusy(false);
  }, [modality]);

  useEffect(() => {
    refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => {
    if (!sourceAssetId || !assets.some((asset) => asset.id === sourceAssetId)) return;
    setSelectedAssetId(sourceAssetId);
    setSelectedReferenceIds((current) => unique([...current, sourceAssetId]));
  }, [assets, sourceAssetId]);

  const operationOptions = useMemo(() => (isVideo ? VIDEO_OPERATIONS : IMAGE_OPERATIONS).map(([id, label]) => {
    const live = capabilities.operations.find((item) => item.id === id);
    return live || { id, label, implemented: false, available: false, status: 'coming_soon', providers: [], models: [] };
  }), [capabilities.operations, isVideo]);
  const operationInfo = operationOptions.find((item) => item.id === operation) || operationOptions[0];
  const compatibleModels = useMemo(
    () => capabilities.models.filter((model) => model.operations?.includes(operation)),
    [capabilities.models, operation],
  );
  const manualModel = compatibleModels.find((model) => model.id === modelId) || null;
  const activeModel = manualModel || routePreview?.selected || null;
  const durationOptions = useMemo(() => modelDurations(activeModel, modality), [activeModel, modality]);
  const resolutionOptions = useMemo(
    () => activeModel?.outputs?.resolutions || (isVideo ? ['720p', '1080p'] : []),
    [activeModel, isVideo],
  );
  const aspectOptions = useMemo(
    () => activeModel?.outputs?.aspectRatios || (isVideo ? ['16:9', '9:16', '1:1'] : ['1:1', '4:5', '16:9', '9:16']),
    [activeModel, isVideo],
  );
  const nativeAudioAvailable = activeModel?.outputs?.nativeAudio === true;

  useEffect(() => {
    if (modelId !== 'AUTO' && !compatibleModels.some((model) => model.id === modelId)) setModelId('AUTO');
  }, [compatibleModels, modelId]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const references = unique([...selectedReferenceIds, firstFrameAssetId, lastFrameAssetId]);
      const model = compatibleModels.find((item) => item.id === modelId);
      const route = await resolveModelRoute({
        modality,
        operation,
        priority,
        provider: model?.provider || 'AUTO',
        model: model?.model || 'AUTO',
        referenceAssetIds: references,
        durationSeconds: isVideo ? duration : undefined,
        resolution: resolution || undefined,
        audio: generateAudio,
      });
      setRoutePreview(route.data?.route || null);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [compatibleModels, duration, firstFrameAssetId, generateAudio, isVideo, lastFrameAssetId, modality, modelId, operation, priority, resolution, selectedReferenceIds]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const model = compatibleModels.find((item) => item.id === modelId) || routePreview?.selected;
      const result = await estimateGenerationCost(modality, {
        operation,
        provider: model?.provider || 'AUTO',
        model: model?.model || undefined,
        durationSeconds: isVideo ? duration : undefined,
        resolution,
        quality,
        outputCount,
        audio: generateAudio,
      });
      setEstimatedCredits(result.ok ? Number(result.data?.estimatedCredits || 0) : null);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [compatibleModels, duration, generateAudio, isVideo, modality, modelId, operation, outputCount, quality, resolution, routePreview]);

  useEffect(() => {
    if (durationOptions.length && !durationOptions.includes(Number(duration))) setDuration(Number(durationOptions[0]));
  }, [duration, durationOptions]);

  useEffect(() => {
    if (resolutionOptions.length && !resolutionOptions.includes(resolution)) setResolution(resolutionOptions[resolutionOptions.length - 1]);
  }, [resolution, resolutionOptions]);

  useEffect(() => {
    if (aspectOptions.length && !aspectOptions.includes(aspectRatio)) setAspectRatio(aspectOptions[0]);
  }, [aspectOptions, aspectRatio]);

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) || null;
  const generatedAsset = assets.find((asset) => generator.assetUrl && itemPreview(asset) === generator.assetUrl) || null;
  const displayAsset = generatedAsset || selectedAsset;
  const currentOutputUrl = generator.assetUrl || itemPreview(displayAsset);
  const currentContentType = contentTypeFor(displayAsset || {}, isVideo ? 'video/mp4' : 'image/png');
  const referenceAssets = assets.filter((asset) => selectedReferenceIds.includes(asset.id));
  const completedAssets = assets.filter((asset) => {
    const type = String(asset.contentType || '');
    return isVideo ? type.startsWith('video/') : type.startsWith('image/');
  });

  const currentQueue = useMemo(() => {
    const seen = new Set();
    return [...generator.queueItems, ...persistedJobs].filter((item) => {
      const id = item.id || item.jobId;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, 80);
  }, [generator.queueItems, persistedJobs]);

  const activeJobs = currentQueue.filter((job) => !TERMINAL.has(String(job.status || '').toLowerCase()));

  const collections = useMemo(() => ({
    Projects: projects,
    Sessions: sessions,
    Assets: assets,
    Characters: characters,
    References: references,
  }), [assets, characters, projects, references, sessions]);
  const visibleLibrary = asArray(collections[leftTab]).filter((item) => itemTitle(item).toLowerCase().includes(search.toLowerCase()));

  const selectLibraryItem = (item) => {
    if (leftTab === 'Projects') {
      setSelectedProjectId(item.id);
      setNotice(`Project selected: ${itemTitle(item)}`);
      return;
    }
    if (leftTab === 'Sessions') {
      setSelectedSessionId(item.id);
      if (item.projectId) setSelectedProjectId(item.projectId);
      setNotice(`Session selected: ${itemTitle(item)}`);
      return;
    }
    if (leftTab === 'Characters') {
      if (!item.consentGranted) {
        setNotice(`${itemTitle(item)} needs current consent in Character Lab before generation.`);
        return;
      }
      setSelectedCharacterIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]);
      return;
    }
    if (leftTab === 'References') {
      setSelectedAssetId(item.assetId);
      setSelectedReferenceIds((current) => current.includes(item.assetId) ? current.filter((id) => id !== item.assetId) : [...current, item.assetId]);
      return;
    }
    setSelectedAssetId(item.id);
    setSelectedReferenceIds((current) => current.includes(item.id) ? current : [...current, item.id]);
  };

  const selectedLibraryIds = useMemo(() => new Set([
    selectedProjectId,
    selectedSessionId,
    selectedAssetId,
    ...selectedReferenceIds,
    ...references.filter((item) => selectedReferenceIds.includes(item.assetId)).map((item) => item.id),
    ...selectedCharacterIds,
  ]), [references, selectedAssetId, selectedCharacterIds, selectedProjectId, selectedReferenceIds, selectedSessionId]);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setNotice('Validating and uploading to SLT Storage...');
    const uploadKind = file.type.startsWith('video/') ? 'video' : 'image';
    const result = await uploadReferenceAsset({
      file,
      kind: uploadKind,
      module: modality,
      role: 'reference',
      projectId: selectedProjectId || null,
      sessionId: selectedSessionId || null,
    });
    setUploading(false);
    if (!result.ok || !result.data?.asset) {
      setNotice(result.message || 'Upload failed.');
      return;
    }
    const asset = result.data.asset;
    setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
    setSelectedAssetId(asset.id);
    setSelectedReferenceIds((current) => unique([...current, asset.id]));
    await createReference({
      assetId: asset.id,
      referenceType: 'IMAGE',
      name: itemTitle(asset),
      projectId: selectedProjectId || null,
      sessionId: selectedSessionId || null,
    });
    setNotice('Reference validated and stored.');
  };

  const createWorkspaceProject = async () => {
    const result = await saveProject({ title: `Untitled ${isVideo ? 'Video' : 'Image'} Project`, kind: modality });
    if (result.ok && result.data?.project) {
      setProjects((current) => [result.data.project, ...current]);
      setSelectedProjectId(result.data.project.id);
      setNotice('Project created.');
    } else setNotice(result.message || 'Project could not be created.');
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setNotice('Write a prompt before generating.');
      return;
    }
    if (!operationInfo?.available) {
      setNotice(operationInfo?.status === 'coming_soon'
        ? `${operationInfo.label} is Coming Soon. No credits were reserved.`
        : `${operationInfo?.label || operation} is unavailable: ${operationInfo?.message || operationInfo?.customerMessage || 'no compatible provider is connected'}. No credits were reserved.`);
      return;
    }
    const model = compatibleModels.find((item) => item.id === modelId) || routePreview?.selected || null;
    const references = unique([...selectedReferenceIds, firstFrameAssetId, lastFrameAssetId]);
    const source = assets.find((asset) => asset.id === (sourceAssetId || firstFrameAssetId || selectedAssetId));
    const keyframes = [
      firstFrameAssetId ? { assetId: firstFrameAssetId, seconds: 0 } : null,
      lastFrameAssetId ? { assetId: lastFrameAssetId, seconds: duration } : null,
    ].filter(Boolean);
    const result = await generator.runGenerate({
      title: `${isVideo ? 'Video' : 'Image'} · ${operationInfo?.label || operation}`,
      prompt: [prompt.trim(), negativePrompt.trim() ? `Avoid: ${negativePrompt.trim()}` : ''].filter(Boolean).join('\n\n'),
      negativePrompt,
      provider: modelId === 'AUTO' ? 'AUTO' : model?.provider,
      providerLabel: modelId === 'AUTO' ? 'SLT Auto' : model?.provider,
      model: modelId === 'AUTO' ? undefined : model?.model,
      modelId: modelId === 'AUTO' ? undefined : model?.model,
      tool: operation,
      actionId: operation,
      operation,
      capabilityAware: true,
      priority,
      outputCount,
      projectId: selectedProjectId || undefined,
      sessionId: selectedSessionId || undefined,
      referenceAssetIds: references,
      characterIds: selectedCharacterIds,
      sourceAssetId: ['reality_transform', 'video_to_video'].includes(operation) ? source?.id : (operation === 'image_to_video' ? source?.id : undefined),
      referenceImageUrl: source?.contentType?.startsWith('image/') ? source.publicUrl : undefined,
      sourceVideoUrl: source?.contentType?.startsWith('video/') ? source.publicUrl : undefined,
      keyframes,
      firstFrameAssetId: firstFrameAssetId || undefined,
      lastFrameAssetId: lastFrameAssetId || undefined,
      durationSeconds: isVideo ? duration : undefined,
      videoDurationSeconds: isVideo ? duration : undefined,
      aspectRatio,
      ratio: aspectRatio,
      resolution,
      outputResolution: resolution,
      quality,
      camera,
      shot,
      lens,
      lighting,
      color,
      composition,
      photography,
      sceneStart,
      sceneEnd,
      movementPrompt,
      audio: generateAudio,
      generateAudio,
    });
    setNotice(result.ok ? generator.status || 'Generation accepted.' : result.message || 'Generation failed.');
    await refreshWorkspace();
  };

  const setReferenceRole = (role) => {
    if (!selectedAsset) {
      setNotice('Select an Asset first.');
      return;
    }
    setSelectedReferenceIds((current) => unique([...current, selectedAsset.id]));
    if (role === 'first') setFirstFrameAssetId(selectedAsset.id);
    if (role === 'last') setLastFrameAssetId(selectedAsset.id);
    setNotice(role === 'reference' ? 'Asset added as reference.' : `Asset set as ${role} frame.`);
  };

  const openImageInVideo = (role = 'source') => {
    if (!selectedAsset?.id) return setNotice('Select an image Asset first.');
    const params = new URLSearchParams({ studio: 'v2', sourceAssetId: selectedAsset.id, operation: 'image_to_video' });
    if (role === 'last') params.set('lastFrameAssetId', selectedAsset.id);
    if (sceneBuilder && sceneStep === 2 && movementPrompt.trim()) params.set('prompt', movementPrompt.trim());
    navigate(`/video?${params.toString()}`);
  };

  const handleFrameExtraction = async () => {
    if (!selectedAsset?.id || !String(selectedAsset.contentType || '').startsWith('video/')) {
      setNotice('Select a stored video Asset first.');
      return;
    }
    setNotice('Extracting and storing the selected frame...');
    const result = await extractVideoFrame(selectedAsset.id, playhead);
    if (!result.ok || !result.data?.asset) {
      setNotice(result.message || 'Frame extraction failed.');
      return;
    }
    const asset = result.data.asset;
    setAssets((current) => [asset, ...current]);
    setNotice('Frame stored as an Image Asset.');
    navigate(`/image?studio=v2&sourceAssetId=${encodeURIComponent(asset.id)}&operation=image_to_image`);
  };

  const addAssetToCharacter = async () => {
    if (!selectedAsset?.id) return setNotice('Select an Asset first.');
    const characterId = selectedCharacterIds[0];
    if (!characterId) return setNotice('Select a consented Character first.');
    const result = await linkCharacterAsset(characterId, {
      assetId: selectedAsset.id,
      category: 'studio_reference',
      captureStage: 'creative_studio',
    });
    setNotice(result.ok ? 'Asset linked to the Character dataset.' : result.message || 'Character link failed.');
  };

  const displayTabs = isVideo ? ['Canvas', 'Storyboard', 'Versions'] : ['Canvas', 'Result Grid', 'Comparison', 'Versions'];
  const inspectorTabs = isVideo ? ['Create', 'Director', 'Output'] : ['Create', 'Look', 'Output'];

  return (
    <div className={`video-v2 multimodal-v2 is-${modality}`} data-studio-version="v2">
      <header className="video-v2-topbar">
        <div className="video-v2-title-group">
          <p>Sweet Little Trauma</p>
          <h1>{isVideo ? 'Video Studio' : 'Image Studio'}</h1>
          <span>{sceneBuilder ? `Scene Builder · Step ${sceneStep}` : selectedProjectId ? `Project · ${itemTitle(projects.find((item) => item.id === selectedProjectId))}` : 'Unified creative workspace'}</span>
        </div>
        <div className="video-v2-top-actions">
          <span className={`video-v2-live-label ${workspaceBusy ? 'is-busy' : ''}`}>{workspaceBusy ? 'Syncing' : 'Live data'}</span>
          {!isVideo ? <button type="button" className="video-v2-text-button" onClick={() => { setSceneBuilder((current) => !current); setSceneStep(1); }}>Scene Builder</button> : null}
          <button type="button" className="video-v2-text-button" onClick={() => setCanvasTab(isVideo ? 'Versions' : 'Result Grid')}>Library</button>
          <button type="button" className="video-v2-primary-button" disabled={generator.generating || isSpy} onClick={handleGenerate}>Generate</button>
        </div>
      </header>

      <aside className="video-v2-left" aria-label="Shared creative workspace">
        <div className="video-v2-panel-head">
          <span>Workspace</span>
          <button type="button" className="video-v2-icon-button" title="New project" aria-label="New project" onClick={createWorkspaceProject}>+</button>
        </div>
        <div className="video-v2-left-tabs" role="tablist" aria-label="Workspace collections">
          {LEFT_TABS.map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={leftTab === tab} className={leftTab === tab ? 'is-active' : ''} onClick={() => setLeftTab(tab)}>{tab}</button>
          ))}
        </div>
        <label className="video-v2-search">
          <span className="sr-only">Search workspace</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${leftTab.toLowerCase()}`} />
          <span>{visibleLibrary.length}</span>
        </label>
        <div className="video-v2-library-list">
          {visibleLibrary.length ? visibleLibrary.map((item) => (
            <button type="button" key={item.id} className={`video-v2-library-row ${selectedLibraryIds.has(item.id) ? 'is-selected' : ''}`} onClick={() => selectLibraryItem(item)}>
              {itemPreview(item) && !String(contentTypeFor(item)).startsWith('video/') ? <img src={itemPreview(item)} alt="" /> : <span className={`video-v2-library-swatch is-${item.kind === 'video' ? 'blue' : item.consentGranted ? 'cyan' : 'red'}`} aria-hidden="true" />}
              <span><strong>{itemTitle(item)}</strong><small>{item.kind || item.status || item.role || 'SLT item'}{item.jobCount !== undefined ? ` · ${item.jobCount} jobs` : ''}</small></span>
              <span className="video-v2-row-menu">{selectedLibraryIds.has(item.id) ? 'Selected' : ''}</span>
            </button>
          )) : <p className="video-v2-empty-list">No {leftTab.toLowerCase()} yet.</p>}
        </div>
        <div className="video-v2-left-footer">
          <button type="button" className="video-v2-upload-button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>{uploading ? 'Uploading...' : '+ Upload reference'}</button>
          <input ref={fileInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime" onChange={(event) => handleUpload(event.target.files?.[0])} />
          <p>{assets.length} stored Assets · {selectedReferenceIds.length} selected references</p>
        </div>
      </aside>

      <main className="video-v2-canvas-section">
        <div className="video-v2-canvas-toolbar">
          <div>{displayTabs.map((tab) => <button key={tab} type="button" className={canvasTab === tab ? 'is-active' : ''} onClick={() => setCanvasTab(tab)}>{tab}</button>)}</div>
          <div><span>{sceneBuilder ? `Scene ${sceneStep}/2` : `${completedAssets.length} results`}</span></div>
        </div>

        {canvasTab === 'Canvas' ? (
          <section className="video-v2-monitor" aria-label={`${modality} canvas`}>
            <div className="video-v2-monitor-stage">
              {currentOutputUrl ? (
                currentContentType.startsWith('video/')
                  ? <video src={mediaUrl(currentOutputUrl)} controls playsInline />
                  : <img src={mediaUrl(currentOutputUrl)} alt="Current generated result" />
              ) : (
                <div className="video-v2-empty-canvas">
                  {generator.generating ? <span className="video-v2-loader" aria-hidden="true" /> : null}
                  <strong>{generator.generating ? statusLabel(generator.jobStatus) : `No ${modality} selected`}</strong>
                  <p>{generator.generating ? `${elapsedLabel(generator.queueItems[0]?.startedAt, null, generator.now)} elapsed · ${generator.status}` : 'Generate or select a stored Asset from the shared Library.'}</p>
                </div>
              )}
              <p className="video-v2-take-label">{sceneBuilder ? `Scene Builder · Step ${sceneStep}` : operationInfo?.label}</p>
              {currentOutputUrl ? <p className="video-v2-safe-frame">SLT Asset</p> : null}
            </div>
            {isVideo ? (
              <div className="video-v2-player-controls">
                <span>{elapsedLabel(0, playhead * 1000, 0)}</span>
                <input className="video-v2-inline-scrubber" type="range" min="0" max={Number(selectedAsset?.metadata?.durationSeconds || duration || 5)} step="0.04" value={playhead} onChange={(event) => setPlayhead(Number(event.target.value))} aria-label="Selected frame time" />
                <span>{Number(playhead).toFixed(2)}s</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {canvasTab === 'Result Grid' ? (
          <section className="video-v2-result-grid">{completedAssets.map((asset) => <button type="button" key={asset.id} className={selectedAssetId === asset.id ? 'is-selected' : ''} onClick={() => setSelectedAssetId(asset.id)}><img src={itemPreview(asset)} alt={itemTitle(asset)} /><span>{itemTitle(asset)}</span></button>)}</section>
        ) : null}

        {canvasTab === 'Comparison' ? (
          <section className="video-v2-comparison">{completedAssets.slice(0, 2).map((asset) => <figure key={asset.id}><img src={itemPreview(asset)} alt={itemTitle(asset)} /><figcaption>{itemTitle(asset)}</figcaption></figure>)}{completedAssets.length < 2 ? <p>Select or generate two images to compare.</p> : null}</section>
        ) : null}

        {canvasTab === 'Storyboard' ? <section className="video-v2-coming-soon"><strong>Storyboard editing · Coming Soon</strong><p>The existing generation, Asset, version and Scene Builder flows remain available.</p></section> : null}

        {canvasTab === 'Versions' ? (
          <section className="video-v2-result-grid is-versions">{history.map((item) => <button type="button" key={item.id} onClick={() => { const url = outputUrlFor(item); if (url) setSelectedAssetId(assets.find((asset) => asset.publicUrl === url)?.id || ''); setPrompt(item.prompt || prompt); }}><span className={`video-v2-history-state is-${String(item.status || '').toLowerCase()}`} /> <strong>{itemTitle(item)}</strong><small>{item.provider || 'SLT'} · {statusLabel(item.status)}</small></button>)}</section>
        ) : null}

        <StudioErrorPanel
          incident={generator.incident}
          actionMessage={generator.incidentAction}
          busy={generator.retrying}
          onReport={generator.sendIncidentReport}
          onRetry={async () => {
            await generator.retryLastGeneration();
            await refreshWorkspace();
          }}
        />

        <div className="video-v2-result-actions">
          <div><strong>{selectedAsset ? itemTitle(selectedAsset) : 'Current result'}</strong><span>{activeModel?.label || 'SLT Auto'} · {resolution || quality} · {aspectRatio}</span></div>
          <div>
            {isVideo ? <button type="button" onClick={handleFrameExtraction}>Extract frame</button> : <button type="button" onClick={() => openImageInVideo('source')}>Animate in Video</button>}
            {!isVideo ? <button type="button" onClick={() => openImageInVideo('first')}>First frame</button> : null}
            {!isVideo ? <button type="button" onClick={() => openImageInVideo('last')}>Last frame</button> : null}
            <button type="button" onClick={() => setReferenceRole('reference')}>Add reference</button>
            <button type="button" onClick={addAssetToCharacter}>Add to Character</button>
            {!isVideo ? <button type="button" onClick={() => { setSceneBuilder(true); setSceneStep(2); }}>Add to Scene</button> : null}
            <button type="button" onClick={() => { setOperation(isVideo ? (selectedAsset?.contentType?.startsWith('video/') ? 'video_to_video' : 'image_to_video') : 'image_to_image'); setReferenceRole('reference'); setRightTab('Create'); }}>Create variation</button>
            <button type="button" onClick={() => setNotice('Upscale is a separate post-process operation · Coming Soon.')}>Upscale</button>
            {selectedAsset?.id ? <a href={assetDownloadUrl(selectedAsset.id)} download>Download</a> : null}
          </div>
        </div>

        {sceneBuilder ? (
          <section className="video-v2-scene-flow">
            <button type="button" className={sceneStep === 1 ? 'is-active' : ''} onClick={() => setSceneStep(1)}><span>01</span><strong>Frame your scene</strong><small>Image prompt + Character + References</small></button>
            <button type="button" className={sceneStep === 2 ? 'is-active' : ''} disabled={!selectedAsset?.contentType?.startsWith('image/')} onClick={() => setSceneStep(2)}><span>02</span><strong>Animate your scene</strong><small>Selected frame + movement + camera</small></button>
            {sceneStep === 2 ? <button type="button" className="video-v2-scene-launch" onClick={() => openImageInVideo('source')}>Open selected frame in Video Studio</button> : null}
          </section>
        ) : null}
      </main>

      <aside className="video-v2-right" aria-label="Generation settings">
        <div className="video-v2-right-tabs">{inspectorTabs.map((tab) => <button key={tab} type="button" className={rightTab === tab ? 'is-active' : ''} onClick={() => setRightTab(tab)}>{tab}</button>)}</div>

        {rightTab === 'Create' ? (
          <div className="video-v2-inspector-content">
            <label className="video-v2-field"><span>Operation</span><select value={operation} onChange={(event) => setOperation(event.target.value)}>{operationOptions.map((item) => <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.status === 'coming_soon' ? ' · Coming Soon' : !item.available ? ` · ${item.message || item.customerMessage || 'Provider unavailable'}` : ''}</option>)}</select><small>{operationInfo?.available ? 'Available through the SLT capability router.' : operationInfo?.message || operationInfo?.customerMessage || 'No compatible provider is connected for this operation.'}</small></label>
            <label className="video-v2-field video-v2-prompt-field"><span>{sceneBuilder && sceneStep === 2 ? 'Movement prompt' : 'Prompt'}</span><textarea value={sceneBuilder && sceneStep === 2 ? movementPrompt : prompt} onChange={(event) => sceneBuilder && sceneStep === 2 ? setMovementPrompt(event.target.value) : setPrompt(event.target.value)} rows="6" placeholder={sceneBuilder && sceneStep === 2 ? 'Describe movement, timing and camera...' : `Describe the ${modality} you want to create...`} /><small>{(sceneBuilder && sceneStep === 2 ? movementPrompt : prompt).length} / 1200</small></label>
            <label className="video-v2-field"><span>Negative prompt</span><textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} rows="3" placeholder="What should not appear..." /></label>
            <div className="video-v2-reference-stack">
              <span>References · {referenceAssets.length} Assets · {selectedCharacterIds.length} Characters</span>
              {referenceAssets.slice(0, 4).map((asset) => <button type="button" key={asset.id} onClick={() => setSelectedReferenceIds((current) => current.filter((id) => id !== asset.id))}>{itemTitle(asset)} <b>x</b></button>)}
            </div>
            <label className="video-v2-field"><span>Routing priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}>{PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="video-v2-field"><span>Model</span><select value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="AUTO">SLT Auto · capability router</option>{compatibleModels.map((model) => <option key={model.id} value={model.id} disabled={!model.connected}>{model.label}{model.connected ? '' : ` · ${model.message || model.customerMessage || 'Temporarily unavailable'}`}</option>)}</select><small>{routePreview?.message || activeModel?.message || activeModel?.customerMessage || 'Capabilities are read from the backend.'}</small></label>
            <label className="video-v2-field"><span>Outputs</span><div className="video-v2-stepper"><button type="button" onClick={() => setOutputCount((value) => Math.max(1, value - 1))}>-</button><strong>{outputCount}</strong><button type="button" onClick={() => setOutputCount((value) => Math.min(8, value + 1))}>+</button></div></label>
            {isVideo && ['image_to_video', 'first_last_frame', 'keyframes'].includes(operation) ? (
              <div className="video-v2-frame-slots"><button type="button" className={firstFrameAssetId ? 'is-filled' : ''} onClick={() => setReferenceRole('first')}>First frame<br /><small>{itemTitle(assets.find((item) => item.id === firstFrameAssetId), 'Select Asset')}</small></button><button type="button" className={lastFrameAssetId ? 'is-filled' : ''} onClick={() => setReferenceRole('last')}>Last frame<br /><small>{itemTitle(assets.find((item) => item.id === lastFrameAssetId), 'Optional')}</small></button></div>
            ) : null}
          </div>
        ) : null}

        {(rightTab === 'Director' || rightTab === 'Look') ? (
          <div className="video-v2-inspector-content">
            {isVideo ? <><label className="video-v2-field"><span>Camera movement</span><select value={camera} onChange={(event) => setCamera(event.target.value)}>{CAMERA_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label><label className="video-v2-field"><span>Shot</span><select value={shot} onChange={(event) => setShot(event.target.value)}>{SHOT_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label><label className="video-v2-field"><span>Lens</span><select value={lens} onChange={(event) => setLens(event.target.value)}>{LENS_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label><label className="video-v2-field"><span>Scene begins</span><input value={sceneStart} onChange={(event) => setSceneStart(event.target.value)} /></label><label className="video-v2-field"><span>Scene ends</span><input value={sceneEnd} onChange={(event) => setSceneEnd(event.target.value)} /></label></> : <><label className="video-v2-field"><span>Composition</span><select value={composition} onChange={(event) => setComposition(event.target.value)}>{COMPOSITION_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label><label className="video-v2-field"><span>Photography</span><select value={photography} onChange={(event) => setPhotography(event.target.value)}>{PHOTO_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label></>}
            <label className="video-v2-field"><span>Lighting</span><select value={lighting} onChange={(event) => setLighting(event.target.value)}>{LIGHT_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="video-v2-field"><span>Color</span><select value={color} onChange={(event) => setColor(event.target.value)}>{COLOR_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
        ) : null}

        {rightTab === 'Output' ? (
          <div className="video-v2-inspector-content">
            {durationOptions.length ? <label className="video-v2-field"><span>Duration</span><select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{durationOptions.map((item) => <option key={item} value={item}>{item}s</option>)}</select></label> : null}
            <label className="video-v2-field"><span>Aspect ratio</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{aspectOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
            {resolutionOptions.length ? <label className="video-v2-field"><span>Native resolution</span><select value={resolution} onChange={(event) => setResolution(event.target.value)}>{resolutionOptions.map((item) => <option key={item}>{item}</option>)}</select><small>{activeModel?.outputs?.upscaleIsPostProcess ? '4K is a separate Upscale operation.' : ''}</small></label> : null}
            {!isVideo ? <label className="video-v2-field"><span>Quality</span><select value={quality} onChange={(event) => setQuality(event.target.value)}><option>Standard</option><option>High</option></select></label> : null}
            {isVideo ? <label className="video-v2-toggle-row"><span>Native audio {nativeAudioAvailable ? '' : '· Coming Soon for this model'}</span><input type="checkbox" checked={generateAudio} disabled={!nativeAudioAvailable} onChange={(event) => setGenerateAudio(event.target.checked)} /></label> : null}
          </div>
        ) : null}

        <div className="video-v2-cost-box">
          <div><span>Estimated cost</span><strong>{estimatedCredits === null ? 'Checking...' : `${estimatedCredits} credits`}</strong></div>
          <p>{outputCount} output{outputCount === 1 ? '' : 's'} · {activeModel?.label || 'SLT Auto'}{routePreview?.ok === false ? ` · ${routePreview.message}` : ''}</p>
          <button type="button" disabled={generator.generating || isSpy || !operationInfo?.available || !prompt.trim()} onClick={handleGenerate}>{isSpy ? 'Read-only mode' : generator.generating ? statusLabel(generator.jobStatus) : !operationInfo?.available ? 'Unavailable' : `Generate ${modality}`}</button>
        </div>
      </aside>

      <section className="video-v2-timeline" aria-label={isVideo ? 'Video timeline' : 'Image generations and versions'}>
        <div className="video-v2-timeline-head"><div><strong>{isVideo ? 'Timeline' : 'Creative history'}</strong><span>{isVideo ? 'View only · editing Coming Soon' : `${history.length} records`}</span></div><div>{['Generations', 'Versions', 'Variations', 'Queue'].map((tab) => <button type="button" key={tab} className={bottomTab === tab ? 'is-active' : ''} onClick={() => setBottomTab(tab)}>{tab}</button>)}</div></div>
        {isVideo ? <><div className="video-v2-ruler"><span>00:00</span><span>00:03</span><span>00:06</span><span>00:09</span><span>00:12</span></div><div className="video-v2-tracks"><div className="video-v2-track-labels"><span>V1</span><span>FX</span><span>A1</span></div><div className="video-v2-track-area"><div className="video-v2-playhead" style={{ left: `${Math.min(100, (playhead / Math.max(1, duration)) * 100)}%` }} /><div className="video-v2-track-row"><button type="button" disabled style={{ width: '100%' }}><i />Generated clip · editing Coming Soon</button></div><div className="video-v2-track-row is-fx"><span style={{ width: '100%' }}>Post effects · Coming Soon</span></div><div className="video-v2-track-row is-audio"><span style={{ width: '100%' }}>Audio separation · Coming Soon</span></div></div></div></> : <div className="video-v2-bottom-summary"><strong>{bottomTab}</strong><span>{bottomTab === 'Queue' ? `${currentQueue.length} jobs` : bottomTab === 'Versions' ? `${history.length} versions` : `${completedAssets.length} Assets`}</span><p>Every result remains attached to its Project, Session, Batch, Job and persistent Asset.</p></div>}
      </section>

      <section className="video-v2-queue" aria-label="Global generation queue">
        <div className="video-v2-section-title"><div><p>Background jobs</p><h2>Generation queue</h2></div><span>{activeJobs.length} active</span></div>
        <div className="video-v2-queue-list">{currentQueue.length ? currentQueue.slice(0, 12).map((job) => { const status = String(job.status || 'pending').toLowerCase(); return <button type="button" key={job.id || job.jobId} className="video-v2-job-row" onClick={() => { if (job.assetId) setSelectedAssetId(job.assetId); }}><span className={`video-v2-job-status is-${status}`} /><span className="video-v2-job-copy"><strong>{job.label || job.title || `${modality} generation`}</strong><small>{job.model || job.provider || 'SLT Auto'} · {elapsedLabel(job.startedAt || job.createdAt, job.endedAt || job.completedAt, generator.now)}</small></span><span className="video-v2-job-progress"><i style={{ width: `${Number(job.progress || (status === 'completed' ? 100 : 0))}%` }} /></span><span className="video-v2-job-label">{statusLabel(status)}</span></button>; }) : <p className="video-v2-empty-list">No Jobs yet.</p>}</div>
      </section>

      <footer className="video-v2-statusbar"><span>{generator.error || generator.status || notice}</span><span>Credits available: {credits ?? '—'} · Held: {heldCredits ?? 0} · {batches.length} batches</span></footer>
    </div>
  );
}
