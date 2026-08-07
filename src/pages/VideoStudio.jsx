import UnifiedStudio from '../components/studio/UnifiedStudio';
import { Link } from 'react-router-dom';
import VideoStudioNext from './VideoStudioNext';
import VideoStudioV2Preview from './VideoStudioV2Preview';
import './StudioLayout.css';

const TOOLS = [
  {
    id: 'text-to-video',
    apiTool: 'TEXT2VIDEO',
    label: 'Text to Video',
    desc: 'Write the scene and generate a video',
    providers: ['Seedance', 'Runway', 'Luma', 'Kling'],
    aliases: ['TEXT2VIDEO'],
  },
  {
    id: 'image-to-video',
    apiTool: 'IMAGE2VIDEO',
    label: 'Image to Video',
    desc: 'Animate a still or product image',
    providers: ['Runway', 'Luma', 'Seedance', 'PixVerse'],
    aliases: ['IMAGE2VIDEO'],
  },
  {
    id: 'lip-sync',
    apiTool: 'LIP_SYNC',
    label: 'Lip Sync',
    desc: 'Match voice, song or speech to a face',
    providers: ['OmniHuman', 'HeyGen', 'D-ID'],
    aliases: ['LIP_SYNC', 'lipsync'],
  },
  {
    id: 'motion-transfer',
    apiTool: 'MOTION_TRANSFER',
    label: 'Motion Transfer',
    desc: 'Copy movement, gesture or performance',
    providers: ['OmniHuman', 'Runway', 'Kling'],
    aliases: ['MOTION_TRANSFER'],
  },
  {
    id: 'reality-transform',
    apiTool: 'REALITY_TRANSFORM',
    label: 'Reality Transform',
    desc: 'Keep the performance, replace the world around it',
    providers: ['Runway', 'Luma Modify'],
    aliases: ['VIDEO2VIDEO', 'VIDEO_TO_VIDEO', 'SCENE_TRANSFER', 'BACKGROUND_STYLING'],
    requiresVideoReference: true,
  },
];

const PROVIDERS = [
  { name: 'Seedance', status: 'API' },
  { name: 'Runway', status: 'API' },
  { name: 'Luma Modify', status: 'API' },
  { name: 'Luma', status: 'API' },
  { name: 'Kling', status: 'API' },
  { name: 'OmniHuman', status: 'Prepared' },
  { name: 'PixVerse', status: 'API' },
  { name: 'HeyGen', status: 'Prepared' },
  { name: 'D-ID', status: 'Prepared' },
];

const SETTINGS = [
  { key: 'duration', label: 'Duration', options: ['5', '10', '15', '30', '60'], defaultValue: '10' },
  { key: 'resolution', label: 'Resolution', options: ['1080p', '2K', '4K', '8K'], defaultValue: '4K' },
  { key: 'frameRate', label: 'Frame Rate', options: ['24 fps', '30 fps', '60 fps'], defaultValue: '24 fps' },
  { key: 'camera', label: 'Camera', options: ['Steadicam', 'Handheld', 'Dolly in', 'Drone', 'Locked tripod', 'Crane move'], defaultValue: 'Steadicam' },
  { key: 'shot', label: 'Shot', options: ['Wide shot', 'Medium shot', 'Close-up', 'Extreme close-up', 'Over the shoulder', 'Tracking shot'], defaultValue: 'Medium shot' },
  { key: 'color', label: 'Color', options: ['Natural cinema', 'Noir', 'Cold blue', 'Warm tungsten', 'Bleach bypass', 'Editorial color'], defaultValue: 'Natural cinema' },
  { key: 'lens', label: 'Lens', options: ['24mm', '35mm', '50mm', '85mm', 'Anamorphic', 'Macro'], defaultValue: '35mm' },
  { key: 'intention', label: 'Intention', options: ['Cinematic', 'Commercial', 'Reel', 'Panic', 'Terror', 'Luxury editorial', 'Music video'], defaultValue: 'Cinematic' },
  {
    key: 'transformStrength',
    label: 'Transformation',
    options: ['Preserve', 'Balanced', 'Reimagine'],
    defaultValue: 'Balanced',
    tools: ['reality-transform'],
  },
  {
    key: 'preserve',
    label: 'Preserve',
    options: ['Performance + camera + props', 'Performance + camera', 'Performance only'],
    defaultValue: 'Performance + camera + props',
    tools: ['reality-transform'],
  },
  { key: 'sceneStart', label: 'Scene starts', type: 'text', placeholder: 'Subject enters the frame...' },
  { key: 'sceneEnd', label: 'Scene ends', type: 'text', placeholder: 'Close-up, reveal, product shot...' },
  { key: 'wardrobe', label: 'Wardrobe', type: 'text', placeholder: 'Clothes, hair, styling, props...' },
];

export default function VideoStudio() {
  const studioMode = new URLSearchParams(window.location.search).get('studio');

  if (studioMode === 'next') {
    return <VideoStudioNext />;
  }

  if (studioMode !== 'original') {
    return <VideoStudioV2Preview />;
  }

  return (
    <UnifiedStudio
      kind="video"
      module="video"
      title="Video Studio"
      railLabel="Video"
      subtitle="Prompt-first video creation with visible modes, references, cinematic parameters and provider routing."
      tools={TOOLS}
      providers={PROVIDERS}
      settings={SETTINGS}
      referenceKind="video"
      referenceLabel="Video / Image Reference"
      promptPlaceholder="Describe what happens in the video: action, character, camera, mood, location and ending..."
      emptyLabel="Your video render will appear here."
      extraActions={() => <Link to="/characters" className="studio-action">[ Character Lab ]</Link>}
      buildRequest={({ prompt, activeTool, provider, settings, referenceAsset }) => {
        const duration = Number(settings.duration) || 10;
        const fps = Number.parseInt(settings.frameRate, 10) || 24;
        const realityTransform = activeTool.id === 'reality-transform';
        const directorBrief = [
          `Task: ${activeTool.label}`,
          `Camera: ${settings.camera}`,
          `Shot: ${settings.shot}`,
          `Color: ${settings.color}`,
          `Lens: ${settings.lens}`,
          `Intention: ${settings.intention}`,
          `Resolution: ${settings.resolution}`,
          `Frame rate: ${settings.frameRate}`,
          `Scene starts: ${settings.sceneStart || 'define from prompt'}`,
          `Scene ends: ${settings.sceneEnd || 'define from prompt'}`,
          `Wardrobe / styling: ${settings.wardrobe || 'define from prompt'}`,
          realityTransform ? `Transformation strength: ${settings.transformStrength}` : '',
          realityTransform ? `Preserve: ${settings.preserve}` : '',
          referenceAsset?.publicUrl ? `Reference asset: ${referenceAsset.publicUrl}` : '',
        ].filter(Boolean).join('\n');

        return {
          title: `Video · ${activeTool.label}`,
          provider,
          providerLabel: provider,
          model: realityTransform
            ? (provider === 'Runway' ? 'aleph2' : 'luma/modify-video')
            : undefined,
          tool: activeTool.apiTool || activeTool.label,
          actionId: activeTool.apiTool || activeTool.id,
          prompt: `${prompt.trim()}\n\nDirector brief:\n${directorBrief}`,
          payload: {
            durationSeconds: duration,
            videoDurationSeconds: duration,
            resolution: settings.resolution,
            outputResolution: settings.resolution,
            targetResolution: settings.resolution,
            frameRate: settings.frameRate,
            fps,
            camera: settings.camera,
            shot: settings.shot,
            color: settings.color,
            lens: settings.lens,
            intention: settings.intention,
            sceneStart: settings.sceneStart,
            sceneEnd: settings.sceneEnd,
            wardrobe: settings.wardrobe,
            realityTransform,
            transformStrength: settings.transformStrength,
            preservationMode: settings.preserve,
            sourceAssetId: realityTransform ? referenceAsset?.id || null : null,
            sourceVideoUrl: realityTransform && referenceAsset?.contentType?.startsWith('video/')
              ? referenceAsset.publicUrl
              : '',
            sourceDurationSeconds: realityTransform
              ? referenceAsset?.metadata?.durationSeconds || duration
              : undefined,
            model: realityTransform
              ? (provider === 'Runway' ? 'aleph2' : 'luma/modify-video')
              : undefined,
          },
        };
      }}
    />
  );
}
