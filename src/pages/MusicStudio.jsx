import UnifiedStudio from '../components/studio/UnifiedStudio';
import './StudioLayout.css';

const TOOLS = [
  { id: 'track-builder', label: 'Track Builder', desc: 'Compose a new track', providers: ['SLT Composer', 'MiniMax Music', 'Stable Audio', 'Suno'] },
  { id: 'hum-to-song', label: 'Hum to Song', desc: 'Use melody or voice reference', providers: ['SLT Composer', 'MiniMax Music', 'Stable Audio'] },
  { id: 'arrangement', label: 'Arrangement', desc: 'Structure sections and instruments', providers: ['SLT Composer', 'MiniMax Music', 'Stable Audio'] },
  { id: 'stem-separation', label: 'Stem Separation', desc: 'Split vocals and instruments', providers: ['Moises', 'SLT Composer', 'Stable Audio'] },
  { id: 'mix-assistant', label: 'Mix Assistant', desc: 'Balance and production feel', providers: ['SLT Composer', 'Stable Audio', 'MiniMax Music'] },
  { id: 'mastering', label: 'Mastering', desc: 'Prepare release-ready master', providers: ['SLT Composer', 'Stable Audio', 'MiniMax Music'] },
  { id: 'export-stems', label: 'Export Stems', desc: 'Prepare stems and assets', providers: ['SLT Composer', 'Stable Audio'] },
];

const PROVIDERS = [
  { name: 'SLT Composer', model: 'Local planning', status: 'Ready' },
  { name: 'MiniMax Music', model: 'Music generation', status: 'API' },
  { name: 'Stable Audio', model: 'Audio generation', status: 'API' },
  { name: 'Suno', model: 'v5.5', status: 'Prepared' },
  { name: 'ElevenLabs Music', model: 'music_v2', status: 'Prepared' },
  { name: 'Udio', model: 'External account', status: 'Prepared' },
  { name: 'Mubert', model: 'Track API', status: 'Prepared' },
  { name: 'Moises', model: 'Stems', status: 'API' },
];

const SETTINGS = [
  { key: 'mode', label: 'Mode', options: ['Manual Studio', 'Suno Mode', 'Udio Mode'], defaultValue: 'Manual Studio' },
  { key: 'duration', label: 'Duration', options: ['15 seconds', '30 seconds', '60 seconds', '2 minutes', 'Full song'], defaultValue: '60 seconds' },
  { key: 'style', label: 'Style', options: ['Alternative', 'Dream Pop', 'Cinematic', 'Pop', 'Trap', 'Rock', 'Tango', 'Experimental'], defaultValue: 'Alternative' },
  { key: 'vocals', label: 'Vocals', options: ['Instrumental', 'Female vocal', 'Male vocal', 'My voice reference', 'Choir', 'Spoken'], defaultValue: 'Instrumental' },
  { key: 'format', label: 'Format', options: ['MP3', 'WAV', 'Stems'], defaultValue: 'WAV' },
];

export default function MusicStudio() {
  return (
    <UnifiedStudio
      kind="music"
      module="music"
      title="Music Studio"
      railLabel="Music"
      subtitle="Compose, arrange, separate stems, mix and master from one simple music order."
      tools={TOOLS}
      providers={PROVIDERS}
      settings={SETTINGS}
      referenceKind="music"
      referenceLabel="Audio / Melody Reference"
      promptPlaceholder="Describe the song, melody, mood, genre, instruments, lyrics or reference you want..."
      emptyLabel="Your generated track or audio result will appear here."
      buildRequest={({ prompt, activeTool, provider, settings, referenceAsset }) => ({
        title: `Music · ${activeTool.label}`,
        provider,
        providerLabel: provider,
        tool: activeTool.label,
        actionId: activeTool.id,
        prompt: [
          `[${settings.mode}] ${prompt.trim()}`,
          `Task: ${activeTool.label}`,
          `Style: ${settings.style}`,
          `Duration: ${settings.duration}`,
          `Vocals: ${settings.vocals}`,
          `Output format: ${settings.format}`,
          referenceAsset?.publicUrl ? `Reference audio: ${referenceAsset.publicUrl}` : '',
        ].filter(Boolean).join('\n'),
        payload: {
          mode: settings.mode,
          style: settings.style,
          duration: settings.duration,
          vocals: settings.vocals,
          outputFormat: settings.format,
        },
      })}
    />
  );
}
