import UnifiedStudio from '../components/studio/UnifiedStudio';
import './StudioLayout.css';

const TOOLS = [
  { id: 'text-to-image', label: 'Text to Image', desc: 'Prompt to image', providers: ['OpenAI Images', 'Gemini Image', 'Grok Image', 'FLUX'] },
  { id: 'image-to-image', label: 'Image to Image', desc: 'Transform a reference', providers: ['OpenAI Images', 'FLUX', 'Stability', 'Replicate'] },
  { id: 'edit', label: 'Edit', desc: 'Crop, resize, adjust', providers: ['OpenAI Images', 'Stability', 'Recraft'] },
  { id: 'product', label: 'Product Shot', desc: 'Product photography', providers: ['OpenAI Images', 'Recraft', 'Leonardo', 'FLUX'] },
  { id: 'avatar', label: 'Avatar', desc: 'Character or profile creation', providers: ['OpenAI Images', 'Gemini Image', 'Leonardo', 'FLUX'] },
  { id: 'logo', label: 'Logo', desc: 'Logo generation', providers: ['Ideogram', 'Recraft', 'OpenAI Images', 'Leonardo'] },
  { id: 'upscale', label: 'Upscale', desc: 'Enhance resolution', providers: ['Stability', 'Replicate', 'FLUX', 'OpenAI Images'] },
];

const PROVIDERS = [
  { name: 'OpenAI Images', status: 'Gateway' },
  { name: 'Gemini Image', status: 'Gateway' },
  { name: 'Grok Image', status: 'Gateway' },
  { name: 'FLUX', status: 'Async' },
  { name: 'Ideogram', status: 'API' },
  { name: 'Recraft', status: 'API' },
  { name: 'Leonardo', status: 'API' },
  { name: 'Stability', status: 'API' },
  { name: 'Replicate', status: 'Async' },
];

const SETTINGS = [
  { key: 'aspectRatio', label: 'Aspect', options: ['1:1', '4:5', '16:9', '3:2', '2:3'], defaultValue: '1:1' },
  { key: 'quality', label: 'Quality', options: ['High', 'Standard'], defaultValue: 'High' },
  { key: 'style', label: 'Style', options: ['Photographic', 'Editorial', 'Digital Art', 'Logo', 'Product', 'Fashion'], defaultValue: 'Photographic' },
  { key: 'model', label: 'Model', options: ['GPT-Image 1', 'FLUX 1.1', 'Imagen', 'Grok Image'], defaultValue: 'GPT-Image 1' },
];

export default function ImageStudio() {
  return (
    <UnifiedStudio
      kind="image"
      module="image"
      title="Image Studio"
      railLabel="Image"
      subtitle="Create, edit, transform, upscale and prepare visuals from a single prompt-first workflow."
      tools={TOOLS}
      providers={PROVIDERS}
      settings={SETTINGS}
      referenceKind="image"
      referenceLabel="Image Reference"
      promptPlaceholder="Describe the image, subject, style, light, mood, product, avatar or edit you want..."
      emptyLabel="Your image result will appear here."
      buildRequest={({ prompt, activeTool, provider, settings }) => ({
        title: `Image · ${activeTool.label}`,
        provider,
        providerLabel: provider,
        tool: activeTool.label,
        actionId: activeTool.id,
        prompt: [
          prompt.trim(),
          `Task: ${activeTool.label}`,
          `Style: ${settings.style}`,
          `Quality: ${settings.quality}`,
          `Aspect ratio: ${settings.aspectRatio}`,
        ].join('\n'),
        payload: {
          ratio: settings.aspectRatio,
          aspectRatio: settings.aspectRatio,
          quality: settings.quality,
          style: settings.style,
          model: settings.model,
          modelId: settings.model,
        },
      })}
    />
  );
}
