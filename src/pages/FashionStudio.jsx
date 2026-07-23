import UnifiedStudio from '../components/studio/UnifiedStudio';
import { readStore, storageKeys, writeStore } from '../lib/storage';
import './StudioLayout.css';

const TOOLS = [
  { id: 'create-look', label: 'Create Look', desc: 'Full outfit direction', providers: ['OpenAI Images', 'Ideogram', 'FLUX', 'Recraft'] },
  { id: 'outfit', label: 'Outfit', desc: 'Garment combinations', providers: ['Ideogram', 'OpenAI Images', 'Leonardo', 'FLUX'] },
  { id: 'garment', label: 'Garment', desc: 'Single piece design', providers: ['OpenAI Images', 'Ideogram', 'Leonardo', 'FLUX'] },
  { id: 'textile', label: 'Textile / Pattern', desc: 'Fabric and repeat', providers: ['Recraft', 'Stability', 'OpenAI Images', 'FLUX'] },
  { id: 'palette', label: 'Color Palette', desc: 'Seasonal tones', providers: ['OpenAI Images', 'Recraft', 'Ideogram'] },
  { id: 'try-on', label: 'Virtual Try-on', desc: 'Model placement', providers: ['OpenAI Images', 'Ideogram', 'FLUX', 'Leonardo'] },
  { id: 'editorial', label: 'Editorial Shoot', desc: 'Campaign framing', providers: ['OpenAI Images', 'FLUX', 'Ideogram', 'Stability'] },
  { id: 'runway', label: 'Runway Look', desc: 'Show-ready styling', providers: ['Ideogram', 'OpenAI Images', 'FLUX', 'Recraft'] },
];

const PROVIDERS = [
  { name: 'OpenAI Images', status: 'Gateway' },
  { name: 'Ideogram', status: 'API' },
  { name: 'Recraft', status: 'API' },
  { name: 'Leonardo', status: 'API' },
  { name: 'FLUX', status: 'Async' },
  { name: 'Stability', status: 'API' },
];

const SETTINGS = [
  { key: 'aspectRatio', label: 'Aspect', options: ['4:5', '1:1', '16:9', '2:3', '3:2'], defaultValue: '4:5' },
  { key: 'style', label: 'Style', options: ['Editorial', 'Runway', 'Lookbook', 'Streetwear', 'Boho Chic', 'Luxury Minimal'], defaultValue: 'Editorial' },
  { key: 'fabric', label: 'Fabric', options: ['Fluid fabric', 'Cotton', 'Silk', 'Leather', 'Denim', 'Knit', 'Technical textile'], defaultValue: 'Fluid fabric' },
  { key: 'fit', label: 'Fit', options: ['Relaxed', 'Oversized', 'Tailored', 'Layered', 'Long silhouette', 'Structured'], defaultValue: 'Relaxed' },
  { key: 'model', label: 'Model', options: ['GPT-Image 1', 'FLUX 1.1', 'Ideogram', 'Leonardo'], defaultValue: 'GPT-Image 1' },
];

export default function FashionStudio() {
  const saveProject = ({ assetUrl, activeTool, activeProvider, prompt, settings }) => {
    if (!assetUrl) {
      alert('Generate a look before saving the project.');
      return;
    }
    const projects = readStore(storageKeys.projects, []);
    const entry = {
      id: `fashion_${Date.now()}`,
      kind: 'fashion',
      tool: activeTool.label,
      provider: activeProvider,
      prompt,
      settings,
      assetUrl,
      createdAt: new Date().toISOString(),
    };
    writeStore(storageKeys.projects, [entry, ...projects].slice(0, 30));
    alert('Look saved in local projects.');
  };

  return (
    <UnifiedStudio
      kind="image"
      module="fashion"
      title="Fashion Studio"
      railLabel="Fashion"
      subtitle="Design apparel, looks, patterns, palettes, try-on images and editorial campaigns from one order."
      tools={TOOLS}
      providers={PROVIDERS}
      settings={SETTINGS}
      referenceKind="fashion"
      referenceLabel="Look / Model Reference"
      promptPlaceholder="Describe the garment, palette, silhouette, fabric, styling, campaign or model direction..."
      emptyLabel="Your fashion visual will appear here."
      buildRequest={({ prompt, activeTool, provider, settings, referenceAsset }) => ({
        title: `Fashion · ${activeTool.label}`,
        provider: provider === 'FLUX' ? 'Flux' : provider,
        providerLabel: provider,
        tool: activeTool.label,
        actionId: activeTool.id,
        prompt: [
          `Fashion studio task: ${activeTool.label}`,
          prompt.trim() || 'High-end editorial fashion look with coherent styling.',
          `Style: ${settings.style}`,
          `Fabric: ${settings.fabric}`,
          `Fit: ${settings.fit}`,
          `Aspect ratio: ${settings.aspectRatio}`,
          'Output: apparel-focused visual suitable for campaign, lookbook or product development.',
          referenceAsset?.publicUrl ? `Reference look: ${referenceAsset.publicUrl}` : '',
        ].filter(Boolean).join('\n'),
        payload: {
          ratio: settings.aspectRatio,
          aspectRatio: settings.aspectRatio,
          style: settings.style,
          fabric: settings.fabric,
          fit: settings.fit,
          model: settings.model,
          modelId: settings.model,
        },
      })}
      extraActions={(context) => (
        <button type="button" className="studio-action" disabled={!context.assetUrl} onClick={() => saveProject(context)}>
          [ Save project ]
        </button>
      )}
    />
  );
}
