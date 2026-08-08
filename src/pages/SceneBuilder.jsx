import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStudioGenerate } from '../hooks/useStudioGenerate';
import {
  addSceneItem,
  assetDownloadUrl,
  createGenerationSession,
  createScene,
  createTimelineItem,
  extractVideoFrame,
  fetchAssets,
  fetchCharacters,
  fetchModelCapabilities,
  fetchProjects,
  fetchReferences,
  fetchScene,
  fetchScenes,
  saveProject,
  updateScene,
} from '../lib/api-client';
import StudioErrorPanel from '../components/studio/StudioErrorPanel';
import TimelineEditor from '../components/studio/TimelineEditor';
import './SceneBuilder.css';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function titleFor(item = {}) {
  return item.displayName || item.title || item.name || item.originalName || item.id || 'Untitled';
}

function completedAssetId(result = {}) {
  return result.data?.asset?.id
    || result.data?.job?.assetId
    || result.data?.batch?.jobs?.find((item) => item.assetId)?.assetId
    || result.data?.jobs?.find((item) => item.assetId)?.assetId
    || null;
}

function preview(asset = {}) {
  if (!asset?.publicUrl) return null;
  if (String(asset.contentType || '').startsWith('video/')) return <video src={asset.publicUrl} controls playsInline />;
  if (String(asset.contentType || '').startsWith('image/')) return <img src={asset.publicUrl} alt={titleFor(asset)} />;
  return null;
}

export default function SceneBuilder() {
  const imageGenerator = useStudioGenerate('image');
  const videoGenerator = useStudioGenerate('video');
  const musicGenerator = useStudioGenerate('music');
  const soundGenerator = useStudioGenerate('sound');
  const [projects, setProjects] = useState([]);
  const [scenes, setScenes] = useState([]);
  const [assets, setAssets] = useState([]);
  const [references, setReferences] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [imageModels, setImageModels] = useState([]);
  const [videoModels, setVideoModels] = useState([]);
  const [musicModels, setMusicModels] = useState([]);
  const [soundModels, setSoundModels] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [title, setTitle] = useState('Untitled scene');
  const [framePrompt, setFramePrompt] = useState('');
  const [movementPrompt, setMovementPrompt] = useState('');
  const [location, setLocation] = useState('');
  const [camera, setCamera] = useState('Locked cinematic frame');
  const [lighting, setLighting] = useState('Natural motivated light');
  const [color, setColor] = useState('Neutral cinematic grade');
  const [dialogue, setDialogue] = useState('');
  const [musicDirection, setMusicDirection] = useState('');
  const [sfxDirection, setSfxDirection] = useState('');
  const [ambienceDirection, setAmbienceDirection] = useState('');
  const [characterId, setCharacterId] = useState('');
  const [referenceIds, setReferenceIds] = useState([]);
  const [frameAssetId, setFrameAssetId] = useState('');
  const [videoAssetId, setVideoAssetId] = useState('');
  const [duration, setDuration] = useState(5);
  const [notice, setNotice] = useState('Create or select a Scene to begin.');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [projectResult, sceneResult, assetResult, referenceResult, characterResult, imageCapabilityResult, videoCapabilityResult, musicCapabilityResult, soundCapabilityResult] = await Promise.all([
      fetchProjects(),
      fetchScenes(projectId),
      fetchAssets(),
      fetchReferences(projectId ? { projectId } : {}),
      fetchCharacters(),
      fetchModelCapabilities('image'),
      fetchModelCapabilities('video'),
      fetchModelCapabilities('music'),
      fetchModelCapabilities('sound'),
    ]);
    if (projectResult.ok) setProjects(list(projectResult.data?.projects));
    if (sceneResult.ok) setScenes(list(sceneResult.data?.scenes));
    if (assetResult.ok) setAssets(list(assetResult.data?.assets));
    if (referenceResult.ok) setReferences(list(referenceResult.data?.references));
    if (characterResult.ok) setCharacters(list(characterResult.data?.characters));
    if (imageCapabilityResult.ok) setImageModels(list(imageCapabilityResult.data?.models));
    if (videoCapabilityResult.ok) setVideoModels(list(videoCapabilityResult.data?.models));
    if (musicCapabilityResult.ok) setMusicModels(list(musicCapabilityResult.data?.models));
    if (soundCapabilityResult.ok) setSoundModels(list(soundCapabilityResult.data?.models));
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sceneId) return;
    const scene = scenes.find((item) => item.id === sceneId);
    if (!scene) return;
    setTitle(scene.title || 'Untitled scene');
    setFramePrompt(scene.prompt || '');
    setMovementPrompt(scene.movementPrompt || '');
    setFrameAssetId(scene.currentFrameAssetId || '');
    setVideoAssetId(scene.currentVideoAssetId || '');
    setSessionId(scene.sessionId || '');
    setLocation(scene.parameters?.location || '');
    setCamera(scene.parameters?.camera || 'Locked cinematic frame');
    setLighting(scene.parameters?.lighting || 'Natural motivated light');
    setColor(scene.parameters?.color || 'Neutral cinematic grade');
    setDialogue(scene.parameters?.dialogue || '');
    setMusicDirection(scene.parameters?.musicDirection || '');
    setSfxDirection(scene.parameters?.sfxDirection || '');
    setAmbienceDirection(scene.parameters?.ambienceDirection || '');
  }, [sceneId, scenes]);

  const frameAsset = assets.find((item) => item.id === frameAssetId) || null;
  const videoAsset = assets.find((item) => item.id === videoAssetId) || null;
  const geminiModel = imageModels.find((item) => item.provider === 'Gemini Image' && item.connected)
    || imageModels.find((item) => item.connected)
    || null;
  const seedanceModel = videoModels.find((item) => item.provider === 'Seedance' && item.connected)
    || videoModels.find((item) => item.connected && item.operations?.includes('image_to_video'))
    || null;
  const musicModel = musicModels.find((item) => item.provider === 'Stable Audio' && item.connected && item.operations?.includes('film_score'))
    || musicModels.find((item) => item.connected && item.operations?.includes('text_to_music'))
    || null;
  const sfxModel = soundModels.find((item) => item.provider === 'Stability Audio' && item.connected && item.operations?.includes('text_to_sfx'))
    || soundModels.find((item) => item.connected && item.operations?.includes('text_to_sfx'))
    || null;
  const voiceModel = soundModels.find((item) => item.connected && item.operations?.includes('text_to_speech')) || null;
  const selectedReferences = useMemo(() => references.filter((item) => referenceIds.includes(item.id)), [referenceIds, references]);

  const ensureWorkspace = async () => {
    if (sceneId) return { projectId, sessionId, sceneId };
    setBusy(true);
    let nextProjectId = projectId;
    if (!nextProjectId) {
      const projectResult = await saveProject({ title: `${title} Project`, kind: 'scene-builder' });
      if (!projectResult.ok) throw new Error(projectResult.message || 'Project creation failed.');
      nextProjectId = projectResult.data.project.id;
      setProjectId(nextProjectId);
    }
    const sessionResult = await createGenerationSession({ title: `${title} Session`, kind: 'multimodal', projectId: nextProjectId });
    if (!sessionResult.ok) throw new Error(sessionResult.message || 'Session creation failed.');
    const nextSessionId = sessionResult.data.session.id;
    setSessionId(nextSessionId);
    const sceneResult = await createScene({
      title,
      prompt: framePrompt,
      movementPrompt,
      projectId: nextProjectId,
      sessionId: nextSessionId,
    });
    if (!sceneResult.ok) throw new Error(sceneResult.message || 'Scene creation failed.');
    const nextSceneId = sceneResult.data.scene.id;
    setSceneId(nextSceneId);
    setBusy(false);
    await refresh();
    return { projectId: nextProjectId, sessionId: nextSessionId, sceneId: nextSceneId };
  };

  const saveSceneText = async (workspace) => {
    const result = await updateScene(workspace.sceneId, {
      title,
      prompt: framePrompt,
      movementPrompt,
      parameters: { location, camera, lighting, color, dialogue, musicDirection, sfxDirection, ambienceDirection },
    });
    if (!result.ok) throw new Error(result.message || 'Scene update failed.');
  };

  const generateSceneAudio = async ({ modality, operation, trackType, prompt, model, label }) => {
    if (!prompt.trim()) return setNotice(`Write the ${label.toLowerCase()} direction first.`);
    if (!model) return setNotice(`${label} is temporarily unavailable because no configured provider supports this operation. No credits were reserved.`);
    setBusy(true);
    try {
      const workspace = await ensureWorkspace();
      await saveSceneText(workspace);
      const generator = modality === 'music' ? musicGenerator : soundGenerator;
      const result = await generator.runGenerate({
        title: `${title} · ${label}`,
        prompt: prompt.trim(),
        operation,
        actionId: operation,
        tool: operation,
        provider: model.provider,
        providerLabel: model.provider,
        model: model.model,
        modelId: model.model,
        capabilityAware: true,
        outputCount: 1,
        projectId: workspace.projectId,
        sessionId: workspace.sessionId,
        durationSeconds: Math.max(5, duration),
      });
      const assetId = completedAssetId(result);
      if (!result.ok || !assetId) throw new Error(result.message || `${label} did not return a persistent Asset.`);
      const linkedAsset = result.data?.asset || assets.find((item) => item.id === assetId) || {};
      await addSceneItem(workspace.sceneId, { itemType: trackType, assetId, track: trackType, position: 10 });
      await createTimelineItem({
        projectId: workspace.projectId,
        sessionId: workspace.sessionId,
        sceneId: workspace.sceneId,
        assetId,
        trackType,
        startSeconds: 0,
        sourceStartSeconds: 0,
        durationSeconds: Math.max(0.25, Number(linkedAsset.metadata?.durationSeconds || duration || 5)),
        position: 0,
      });
      setNotice(`${label} completed, stored and added to the Scene Timeline.`);
      await refresh();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const generateFrame = async () => {
    if (!framePrompt.trim()) return setNotice('Write the visual description for the Scene first.');
    if (!geminiModel) return setNotice('Image generation is temporarily unavailable because no connected image provider supports this operation. No credits were reserved.');
    setBusy(true);
    try {
      const workspace = await ensureWorkspace();
      await saveSceneText(workspace);
      const referenceAssetIds = selectedReferences.map((item) => item.assetId);
      const result = await imageGenerator.runGenerate({
        title: `${title} · frame`,
        prompt: framePrompt.trim(),
        operation: referenceAssetIds.length || characterId ? 'references_to_image' : 'text_to_image',
        actionId: referenceAssetIds.length || characterId ? 'references_to_image' : 'text_to_image',
        tool: referenceAssetIds.length || characterId ? 'references_to_image' : 'text_to_image',
        provider: geminiModel.provider,
        providerLabel: geminiModel.provider,
        model: geminiModel.model,
        modelId: geminiModel.model,
        capabilityAware: true,
        outputCount: 1,
        projectId: workspace.projectId,
        sessionId: workspace.sessionId,
        referenceAssetIds,
        characterIds: characterId ? [characterId] : [],
        aspectRatio: '16:9',
        quality: 'High',
      });
      if (!result.ok || !completedAssetId(result)) throw new Error(result.message || 'The image provider did not return a persistent Asset.');
      const assetId = completedAssetId(result);
      await updateScene(workspace.sceneId, { currentFrameAssetId: assetId });
      await addSceneItem(workspace.sceneId, { itemType: 'IMAGE', assetId, track: 'FRAME', position: 0 });
      setFrameAssetId(assetId);
      setNotice('Frame completed, stored and attached to the Scene.');
      await refresh();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const animateFrame = async () => {
    if (!frameAssetId) return setNotice('Generate or select a Scene frame first.');
    if (!movementPrompt.trim()) return setNotice('Describe the movement and camera action first.');
    if (!seedanceModel) return setNotice('Seedance is temporarily unavailable. No credits were reserved.');
    setBusy(true);
    try {
      const workspace = await ensureWorkspace();
      await saveSceneText(workspace);
      const result = await videoGenerator.runGenerate({
        title: `${title} · shot`,
        prompt: `${framePrompt.trim()}\n\nMovement: ${movementPrompt.trim()}`,
        operation: 'image_to_video',
        actionId: 'image_to_video',
        tool: 'IMAGE2VIDEO',
        provider: seedanceModel.provider,
        providerLabel: seedanceModel.provider,
        model: seedanceModel.model,
        modelId: seedanceModel.model,
        capabilityAware: true,
        outputCount: 1,
        projectId: workspace.projectId,
        sessionId: workspace.sessionId,
        sourceAssetId: frameAssetId,
        referenceAssetIds: [frameAssetId],
        referenceImageUrl: frameAsset?.publicUrl,
        firstFrameAssetId: frameAssetId,
        durationSeconds: duration,
        videoDurationSeconds: duration,
        aspectRatio: '16:9',
        resolution: '720p',
      });
      if (!result.ok || !completedAssetId(result)) throw new Error(result.message || 'Seedance did not return a persistent Asset.');
      const assetId = completedAssetId(result);
      await updateScene(workspace.sceneId, { currentVideoAssetId: assetId, status: 'COMPLETED' });
      await addSceneItem(workspace.sceneId, { itemType: 'VIDEO', assetId, track: 'VIDEO', position: 1 });
      await createTimelineItem({ projectId: workspace.projectId, sessionId: workspace.sessionId, sceneId: workspace.sceneId, assetId, trackType: 'VIDEO', startSeconds: 0, durationSeconds: duration, position: 0 });
      setVideoAssetId(assetId);
      setNotice('Video completed, stored, attached to the Scene and added to Timeline.');
      await refresh();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const extractFrame = async () => {
    if (!videoAssetId) return setNotice('Generate or select a Video Asset first.');
    setBusy(true);
    const result = await extractVideoFrame(videoAssetId, Math.min(1, duration / 2));
    setBusy(false);
    if (!result.ok || !result.data?.asset?.id) return setNotice(result.message || 'Frame extraction failed.');
    setFrameAssetId(result.data.asset.id);
    await updateScene(sceneId, { currentFrameAssetId: result.data.asset.id });
    await addSceneItem(sceneId, { itemType: 'IMAGE', assetId: result.data.asset.id, track: 'EXTRACTED_FRAME', position: 2 });
    setNotice('Frame extracted with FFmpeg and stored as a new Asset version.');
    await refresh();
  };

  const generateVariation = async () => {
    if (!frameAssetId) return setNotice('Select an Image Asset first.');
    if (!geminiModel) return setNotice('Image variation is temporarily unavailable.');
    setBusy(true);
    try {
      const workspace = await ensureWorkspace();
      const result = await imageGenerator.runGenerate({
        title: `${title} · variation`,
        prompt: framePrompt.trim() || 'Create a faithful cinematic variation of the reference.',
        operation: 'image_to_image',
        actionId: 'image_to_image',
        tool: 'image_to_image',
        provider: geminiModel.provider,
        providerLabel: geminiModel.provider,
        model: geminiModel.model,
        modelId: geminiModel.model,
        capabilityAware: true,
        outputCount: 1,
        projectId: workspace.projectId,
        sessionId: workspace.sessionId,
        sourceAssetId: frameAssetId,
        parentAssetId: frameAssetId,
        parentVersionId: frameAssetId,
        versionType: 'VARIATION',
        referenceAssetIds: [frameAssetId],
        referenceImageUrl: frameAsset?.publicUrl,
        aspectRatio: '16:9',
      });
      if (!result.ok || !completedAssetId(result)) throw new Error(result.message || 'Variation did not produce a persistent Asset.');
      const assetId = completedAssetId(result);
      setFrameAssetId(assetId);
      await updateScene(workspace.sceneId, { currentFrameAssetId: assetId });
      await addSceneItem(workspace.sceneId, { itemType: 'IMAGE', assetId, track: 'VARIATION', position: 3 });
      setNotice('Variation completed and stored in Asset lineage.');
      await refresh();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const openScene = async (id) => {
    const result = await fetchScene(id);
    if (!result.ok) return setNotice(result.message || 'Scene could not be opened.');
    const scene = result.data.scene;
    setSceneId(scene.id);
    setProjectId(scene.projectId || '');
    setSessionId(scene.sessionId || '');
    setTitle(scene.title || 'Untitled scene');
    setFramePrompt(scene.prompt || '');
    setMovementPrompt(scene.movementPrompt || '');
    setFrameAssetId(scene.currentFrameAssetId || '');
    setVideoAssetId(scene.currentVideoAssetId || '');
    setLocation(scene.parameters?.location || '');
    setCamera(scene.parameters?.camera || 'Locked cinematic frame');
    setLighting(scene.parameters?.lighting || 'Natural motivated light');
    setColor(scene.parameters?.color || 'Neutral cinematic grade');
    setDialogue(scene.parameters?.dialogue || '');
    setMusicDirection(scene.parameters?.musicDirection || '');
    setSfxDirection(scene.parameters?.sfxDirection || '');
    setAmbienceDirection(scene.parameters?.ambienceDirection || '');
    setNotice('Scene loaded.');
  };

  return (
    <main className="scene-builder-page">
      <header><div><p>Sweet Little Trauma Studio</p><h1>Scene Builder</h1><span>Frame → movement → persistent Video Asset.</span></div><nav><Link to="/projects">Projects</Link><Link to="/references">References</Link><Link to="/characters">Characters</Link><Link to="/image">Image Studio</Link><Link to="/video">Video Studio</Link></nav></header>
      <section className="scene-builder-layout">
        <aside>
          <h2>Scenes</h2>
          <label>Project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setSceneId(''); }}><option value="">New Project</option>{projects.map((item) => <option key={item.id} value={item.id}>{titleFor(item)}</option>)}</select></label>
          <button type="button" onClick={() => { setSceneId(''); setSessionId(''); setFrameAssetId(''); setVideoAssetId(''); setTitle('Untitled scene'); setFramePrompt(''); setMovementPrompt(''); setLocation(''); setDialogue(''); setMusicDirection(''); setSfxDirection(''); setAmbienceDirection(''); }}>New Scene</button>
          <div className="scene-builder-list">{scenes.map((scene) => <button type="button" key={scene.id} className={sceneId === scene.id ? 'is-active' : ''} onClick={() => openScene(scene.id)}><strong>{scene.title}</strong><small>{scene.status} · {scene.currentVideoAssetId ? 'Video ready' : scene.currentFrameAssetId ? 'Frame ready' : 'Draft'}</small></button>)}</div>
          <h2>References</h2>
          <div className="scene-builder-list">{references.map((reference) => <button type="button" key={reference.id} className={referenceIds.includes(reference.id) ? 'is-active' : ''} onClick={() => setReferenceIds((current) => current.includes(reference.id) ? current.filter((id) => id !== reference.id) : [...current, reference.id])}><strong>{reference.name}</strong><small>{reference.referenceType}</small></button>)}</div>
          <label>Character<select value={characterId} onChange={(event) => setCharacterId(event.target.value)}><option value="">No Character</option>{characters.map((item) => <option key={item.id} value={item.id} disabled={!item.consentGranted}>{titleFor(item)}{item.consentGranted ? '' : ' · Consent required'}</option>)}</select></label>
        </aside>

        <section className="scene-builder-stage">
          <div className="scene-builder-preview-grid"><article><p>01 · Master Frame</p>{preview(frameAsset) || <span>No frame yet.</span>}</article><article><p>02 · Animated Shot</p>{preview(videoAsset) || <span>No video yet.</span>}</article></div>
          <div className="scene-builder-actions"><button type="button" disabled={busy || imageGenerator.generating} onClick={generateFrame}>Generate Frame</button><button type="button" disabled={busy || videoGenerator.generating || !frameAssetId} onClick={animateFrame}>Animate with Seedance</button><button type="button" disabled={busy || !videoAssetId} onClick={extractFrame}>Extract Frame</button><button type="button" disabled={busy || !frameAssetId} onClick={generateVariation}>Create Variation</button><button type="button" disabled={busy || !voiceModel || !dialogue.trim()} title={voiceModel ? 'Generate dialogue voice' : 'Temporarily unavailable: voice provider required'} onClick={() => generateSceneAudio({ modality: 'sound', operation: 'text_to_speech', trackType: 'VOICE', prompt: dialogue, model: voiceModel, label: 'Voice' })}>Generate Voice</button><button type="button" disabled={busy || !musicModel || !musicDirection.trim()} title={musicModel ? 'Generate score' : 'Temporarily unavailable: music provider required'} onClick={() => generateSceneAudio({ modality: 'music', operation: 'film_score', trackType: 'MUSIC', prompt: musicDirection, model: musicModel, label: 'Music' })}>Generate Music</button><button type="button" disabled={busy || !sfxModel || !sfxDirection.trim()} title={sfxModel ? 'Generate sound effects' : 'Temporarily unavailable: SFX provider required'} onClick={() => generateSceneAudio({ modality: 'sound', operation: 'text_to_sfx', trackType: 'SFX', prompt: sfxDirection, model: sfxModel, label: 'SFX' })}>Generate SFX</button><button type="button" disabled={busy || !sfxModel || !ambienceDirection.trim()} title={sfxModel ? 'Generate ambience' : 'Temporarily unavailable: ambience provider required'} onClick={() => generateSceneAudio({ modality: 'sound', operation: 'ambience', trackType: 'AMBIENCE', prompt: ambienceDirection, model: sfxModel, label: 'Ambience' })}>Generate Ambience</button>{videoAssetId ? <a href={assetDownloadUrl(videoAssetId)}>Download Video</a> : null}</div>
          <section className="scene-builder-steps"><article className={frameAssetId ? 'is-done' : ''}><b>1</b><div><strong>Frame</strong><small>{geminiModel ? `${geminiModel.provider} · ${geminiModel.model}` : 'Provider unavailable'}</small></div></article><article className={videoAssetId ? 'is-done' : ''}><b>2</b><div><strong>Motion</strong><small>{seedanceModel ? `${seedanceModel.provider} · ${seedanceModel.model}` : 'Seedance unavailable'}</small></div></article><article className={videoAssetId ? 'is-done' : ''}><b>3</b><div><strong>Persist</strong><small>Storage · Asset · Timeline · History</small></div></article></section>
        </section>

        <aside className="scene-builder-inspector">
          <label>Scene title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Frame description<textarea rows="7" value={framePrompt} onChange={(event) => setFramePrompt(event.target.value)} placeholder="Subject, environment, light, composition, wardrobe and visual intention..." /></label>
          <label>Movement order<textarea rows="7" value={movementPrompt} onChange={(event) => setMovementPrompt(event.target.value)} placeholder="Subject action, camera movement, timing and final pose..." /></label>
          <label>Location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Where the Scene takes place" /></label>
          <label>Camera<input value={camera} onChange={(event) => setCamera(event.target.value)} /></label>
          <label>Lighting<input value={lighting} onChange={(event) => setLighting(event.target.value)} /></label>
          <label>Color<input value={color} onChange={(event) => setColor(event.target.value)} /></label>
          <label>Dialogue / Voice<textarea rows="4" value={dialogue} onChange={(event) => setDialogue(event.target.value)} placeholder="Dialogue or narration to synthesize..." /></label>
          <label>Music direction<textarea rows="3" value={musicDirection} onChange={(event) => setMusicDirection(event.target.value)} placeholder="Film score, mood, instrumentation and arc..." /></label>
          <label>SFX direction<textarea rows="3" value={sfxDirection} onChange={(event) => setSfxDirection(event.target.value)} placeholder="Foley, impacts and designed effects..." /></label>
          <label>Ambience direction<textarea rows="3" value={ambienceDirection} onChange={(event) => setAmbienceDirection(event.target.value)} placeholder="Room tone, weather and environmental bed..." /></label>
          <label>Duration<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value="5">5 seconds</option><option value="10">10 seconds</option></select></label>
          <div className="scene-builder-identifiers"><span>Project</span><code>{projectId || 'created on first run'}</code><span>Session</span><code>{sessionId || 'created on first run'}</code><span>Scene</span><code>{sceneId || 'created on first run'}</code></div>
        </aside>
      </section>
      <TimelineEditor
        projectId={projectId}
        sessionId={sessionId}
        sceneId={sceneId}
        assets={assets}
        onRendered={(asset) => {
          if (!asset) return;
          setVideoAssetId(asset.id);
          setNotice('Scene Timeline rendered and stored as a final Video Asset.');
          void refresh();
        }}
      />
      <StudioErrorPanel incident={imageGenerator.incident || videoGenerator.incident || musicGenerator.incident || soundGenerator.incident} error={imageGenerator.error || videoGenerator.error || musicGenerator.error || soundGenerator.error} actionStatus={imageGenerator.incidentAction || videoGenerator.incidentAction || musicGenerator.incidentAction || soundGenerator.incidentAction} onReport={imageGenerator.incident ? imageGenerator.sendIncidentReport : videoGenerator.incident ? videoGenerator.sendIncidentReport : musicGenerator.incident ? musicGenerator.sendIncidentReport : soundGenerator.sendIncidentReport} onRetry={imageGenerator.incident ? imageGenerator.retryLastGeneration : videoGenerator.incident ? videoGenerator.retryLastGeneration : musicGenerator.incident ? musicGenerator.retryLastGeneration : soundGenerator.retryLastGeneration} retrying={imageGenerator.retrying || videoGenerator.retrying || musicGenerator.retrying || soundGenerator.retrying} />
      <footer><span>{imageGenerator.status || videoGenerator.status || musicGenerator.status || soundGenerator.status || notice}</span><span>{frameAssetId ? 'Frame linked' : 'Frame pending'} · {videoAssetId ? 'Video linked' : 'Video pending'}</span></footer>
    </main>
  );
}
