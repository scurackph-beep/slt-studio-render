import UnifiedStudio from '../components/studio/UnifiedStudio';
import './StudioLayout.css';

const TOOLS = [
  { id: 'voice', label: 'Voice', desc: 'Generate or edit voices', providers: ['ElevenLabs', 'OpenAI Audio', 'MiniMax Speech'] },
  { id: 'clone', label: 'Clone', desc: 'Clone voice from reference', providers: ['ElevenLabs', 'MiniMax Speech', 'OpenAI Audio'] },
  { id: 'narration', label: 'Narration', desc: 'Voiceover and spoken content', providers: ['ElevenLabs', 'OpenAI Audio', 'MiniMax Speech'] },
  { id: 'dubbing', label: 'Dubbing', desc: 'Translate or replace dialogue', providers: ['ElevenLabs', 'OpenAI Audio', 'Moises'] },
  { id: 'foley', label: 'Foley', desc: 'Physical sound design', providers: ['Stability Audio', 'ElevenLabs', 'MiniMax Speech'] },
  { id: 'fx', label: 'Sound FX', desc: 'Impacts, risers and effects', providers: ['Stability Audio', 'ElevenLabs', 'MiniMax Speech'] },
  { id: 'soundscape', label: 'Soundscape', desc: 'Atmosphere and environment', providers: ['Stability Audio', 'MiniMax Speech', 'OpenAI Audio'] },
  { id: 'cleanup', label: 'Cleanup', desc: 'Noise removal and repair', providers: ['Moises', 'Dolby.io', 'OpenAI Audio'] },
  { id: 'master', label: 'Master', desc: 'Final balance and loudness', providers: ['Moises', 'iZotope', 'Stability Audio'] },
];

const PROVIDERS = [
  { name: 'ElevenLabs', model: 'Flash v2.5', status: 'TTS' },
  { name: 'OpenAI Audio', model: 'TTS', status: 'Voice' },
  { name: 'MiniMax Speech', model: 'Speech', status: 'API' },
  { name: 'Stability Audio', model: 'FX / audio', status: 'API' },
  { name: 'Moises', model: 'Audio tools', status: 'API' },
  { name: 'Dolby.io', model: 'Enhance', status: 'Paused' },
  { name: 'iZotope', model: 'Mastering', status: 'Prepared' },
];

const SETTINGS = [
  { key: 'voice', label: 'Voice', options: ['Neutral', 'Warm', 'Cinematic', 'Narrator', 'My voice reference'], defaultValue: 'Neutral' },
  { key: 'language', label: 'Language', options: ['English', 'Spanish', 'Portuguese', 'French', 'Italian', 'Auto'], defaultValue: 'English' },
  { key: 'duration', label: 'Duration', options: ['5 seconds', '10 seconds', '30 seconds', '60 seconds', 'Match reference'], defaultValue: '10 seconds' },
  { key: 'format', label: 'Format', options: ['MP3', 'WAV'], defaultValue: 'WAV' },
  { key: 'mixTarget', label: 'Target', options: ['Voice', 'Sound FX', 'Foley', 'Dialogue Clean', 'Music Bed', 'Master Bus'], defaultValue: 'Voice' },
];

export default function SoundStudio() {
  return (
    <UnifiedStudio
      kind="sound"
      module="sound"
      title="Sound FX Studio"
      railLabel="Sound FX"
      subtitle="Voice, dubbing, foley, sound effects, cleanup and mastering from one visible flow."
      tools={TOOLS}
      providers={PROVIDERS}
      settings={SETTINGS}
      referenceKind="sound"
      referenceLabel="Audio / Video Reference"
      promptPlaceholder="Describe the voice, effect, foley, cleanup, dubbing or sound design you want..."
      emptyLabel="Your sound, voice or processed audio result will appear here."
      buildRequest={({ prompt, activeTool, provider, settings, referenceAsset }) => ({
        title: `Sound · ${activeTool.label}`,
        provider,
        providerLabel: provider,
        tool: activeTool.label,
        actionId: activeTool.id,
        prompt: [
          prompt.trim(),
          `Task: ${activeTool.label}`,
          `Voice: ${settings.voice}`,
          `Language: ${settings.language}`,
          `Duration: ${settings.duration}`,
          `Format: ${settings.format}`,
          `Mix target: ${settings.mixTarget}`,
          referenceAsset?.publicUrl ? `Reference media: ${referenceAsset.publicUrl}` : '',
        ].filter(Boolean).join('\n'),
        payload: {
          voice: settings.voice,
          language: settings.language,
          duration: settings.duration,
          outputFormat: settings.format,
          mixTarget: settings.mixTarget,
        },
      })}
    />
  );
}
