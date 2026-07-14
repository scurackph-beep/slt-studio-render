import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  extractAsyncJob,
  generateStudio,
  pollJob,
  readableStudioMessage,
  normalizeJobProvider,
} from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import { useStudio } from '../context/StudioContext';

export const VIDEO_CHAT_TOOLS = [
  { id: 'TEXT2VIDEO', label: 'Text to Video', providers: ['Seedance', 'Runway', 'Luma', 'Kling'] },
  { id: 'IMAGE2VIDEO', label: 'Image to Video', providers: ['Runway', 'Luma', 'Seedance', 'PixVerse'] },
  { id: 'LIP_SYNC', label: 'Lip Sync', providers: ['OmniHuman', 'HeyGen', 'D-ID'] },
  { id: 'MOTION_TRANSFER', label: 'Motion Transfer', providers: ['OmniHuman', 'Runway', 'Kling'] },
];

export const VIDEO_PROVIDER_COSTS = {
  Runway: 250,
  Luma: 150,
  Seedance: 100,
  Kling: 120,
  Veo: 200,
  PixVerse: 130,
  OmniHuman: 180,
  HeyGen: 160,
  'D-ID': 140,
};

function isPlatformAssetUrl(url) {
  const value = String(url || '');
  return value.startsWith('/cdn/assets/') || value.includes('/cdn/assets/');
}

function firstPlatformAssetUrl(...groups) {
  return groups
    .flatMap((group) => (Array.isArray(group) ? group : [group]))
    .find((url) => isPlatformAssetUrl(url)) || null;
}

function extractVideoUrl(result) {
  const item = result?.data?.historyItem;
  const payload = item?.result || result?.data?.result || {};
  const job = result?.data?.job;
  return firstPlatformAssetUrl(
    payload.previewUrl,
    payload.outputUrl,
    payload.outputUrls,
    job?.outputUrl,
    job?.outputUrls,
  );
}

export function useVideoChat({ initialPrompt = '' } = {}) {
  const { isAuthenticated, isCEO } = useAuth();
  const { credits, refreshLedger } = useStudio();
  const [messages, setMessages] = useState([
    {
      sender: 'AI',
      text: 'Sweet Little Trauma - Secure Terminal. Motor en línea. Describe los requerimientos técnicos de tu proyecto.',
    },
  ]);
  const [input, setInput] = useState('');
  const [step, setStep] = useState('idle');
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);

  const availableCredits = useMemo(() => {
    if (isCEO) return '∞';
    if (typeof credits === 'number') return credits;
    return '--';
  }, [credits, isCEO]);

  const addMsg = useCallback((sender, text) => {
    setMessages((prev) => [...prev, { sender, text }]);
  }, []);

  useEffect(() => {
    const prompt = String(initialPrompt || '').trim();
    if (!prompt) return;
    setCurrentPrompt(prompt);
    setStep('await_tool');
    addMsg('User', prompt);
    addMsg('AI', 'Entendido. ¿Qué protocolo usamos? Selecciona una herramienta.');
  }, [initialPrompt, addMsg]);

  const handleSend = () => {
    if (!input.trim() || step === 'generating') return;

    if (!isAuthenticated) {
      addMsg('AI', 'Sesión requerida. Iniciá sesión desde Profile antes de generar.');
      return;
    }

    const userInput = input;
    addMsg('User', userInput);
    setInput('');

    if (step === 'idle') {
      setCurrentPrompt(userInput);
      setStep('await_tool');
      setTimeout(() => {
        addMsg('AI', 'Entendido. ¿Qué protocolo usamos? Selecciona una herramienta.');
      }, 300);
    }
  };

  const selectTool = (tool) => {
    addMsg('User', `[ TOOL: ${tool.label} ]`);
    setSelectedTool(tool);
    setStep('await_provider');
    setTimeout(() => {
      const options = tool.providers
        .map((name) => `- ${name} (${VIDEO_PROVIDER_COSTS[name] || 100} CR est.)`)
        .join('\n');
      addMsg('AI', `Selecciona el proveedor. Costos estimados:\n${options}`);
    }, 300);
  };

  const selectProvider = async (provider) => {
    if (!isAuthenticated) {
      addMsg('AI', 'Sesión requerida. Iniciá sesión desde Profile.');
      return;
    }

    const cost = VIDEO_PROVIDER_COSTS[provider] || 100;
    if (!isCEO && typeof credits === 'number' && credits < cost) {
      addMsg('AI', `ERROR: Fondos insuficientes (${credits} CR disponibles, ~${cost} CR requeridos).`);
      setStep('idle');
      return;
    }

    addMsg('User', `[ PROVIDER: ${provider} ]`);
    setStep('generating');
    addMsg('AI', `[ INICIANDO SECUENCIA ] Conectando a ${provider}...`);

    try {
      const result = await generateStudio({
        kind: 'video',
        prompt: currentPrompt,
        provider,
        providerLabel: provider,
        tool: selectedTool?.id || 'TEXT2VIDEO',
        title: 'SLT Project',
        durationSeconds: 10,
        videoDurationSeconds: 10,
      });

      if (!result.ok) {
        throw new Error(readableStudioMessage(result.message || result.data?.readableError || result.data?.error));
      }

      await refreshLedger().catch(() => null);

      const immediateUrl = extractVideoUrl(result);
      const { jobId, provider: jobProvider, needsPoll } = extractAsyncJob(result);

      if (needsPoll && jobId) {
        addMsg('AI', `[ ENCOLADO - ID: ${jobId} ] Procesando...`);

        const pollable = ['Seedance', 'OmniHuman', 'Runway', 'Luma', 'Kling'].includes(
          normalizeJobProvider(jobProvider || provider),
        );

        if (pollable) {
          const pollResult = await pollJob(jobId, jobProvider || provider, {
            onTick: ({ attempt, maxAttempts }) => {
              if (attempt === 0 || attempt % 3 === 0) {
                addMsg('AI', `[ POLL ${attempt + 1}/${maxAttempts} ] Esperando señal de ${provider}...`);
              }
            },
          });

          await refreshLedger().catch(() => null);

          if (pollResult.ok && pollResult.completed) {
            const videoUrl = extractVideoUrl(pollResult);
            if (videoUrl) {
              addMsg('AI', `[ ÉXITO ] Archivo generado:\n${videoUrl}`);
            } else {
              addMsg('AI', '[ ÉXITO ] Job completado. Revisa Library para el asset.');
            }
          } else {
            addMsg(
              'AI',
              `[ ERROR ] ${readableStudioMessage(pollResult.message || 'La generación falló o expiró.')}`,
            );
          }
        } else {
          addMsg('AI', `[ ENCOLADO ] Job ${jobId} enviado a ${provider}. Consultá /api/jobs/${jobId}.`);
        }
      } else if (immediateUrl) {
        addMsg('AI', `[ ÉXITO ] Generación rápida:\n${immediateUrl}`);
      } else {
        addMsg(
          'AI',
          `[ ÉXITO ] ${result.data?.success || result.data?.historyItem?.message || 'Secuencia registrada.'}`,
        );
      }
    } catch (error) {
      addMsg('AI', `[ FATAL ERROR ] ${error.message}`);
      await refreshLedger().catch(() => null);
    } finally {
      setStep('idle');
      setCurrentPrompt('');
      setSelectedTool(null);
    }
  };

  return {
    messages,
    input,
    setInput,
    handleSend,
    step,
    credits: availableCredits,
    selectTool,
    selectProvider,
    isAuthenticated,
    isCEO,
    tools: VIDEO_CHAT_TOOLS,
    providers: selectedTool?.providers || VIDEO_CHAT_TOOLS[0].providers,
  };
}
