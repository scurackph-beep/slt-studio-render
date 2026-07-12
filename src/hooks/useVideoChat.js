import { useState } from 'react';
import {
  extractAsyncJob,
  generateStudio,
  pollJob,
  readableStudioMessage,
  normalizeJobProvider,
} from '../lib/api-client';

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

export function useVideoChat() {
  const [messages, setMessages] = useState([
    {
      sender: 'AI',
      text: 'Sweet Little Trauma - Secure Terminal. Motor en línea. Describe los requerimientos técnicos de tu proyecto.',
    },
  ]);
  const [input, setInput] = useState('');
  const [credits, setCredits] = useState(15400);
  const [step, setStep] = useState('idle');
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);

  const addMsg = (sender, text) => {
    setMessages((prev) => [...prev, { sender, text }]);
  };

  const handleSend = () => {
    if (!input.trim() || step === 'generating') return;
    const userInput = input;
    addMsg('User', userInput);
    setInput('');

    if (step === 'idle') {
      setCurrentPrompt(userInput);
      setStep('await_tool');
      setTimeout(() => {
        addMsg(
          'AI',
          'Entendido. ¿Qué protocolo usamos? Selecciona una herramienta: [ TEXT2VIDEO ] o [ IMAGE2VIDEO ]',
        );
      }, 500);
    }
  };

  const selectTool = (tool) => {
    addMsg('User', `[ TOOL: ${tool} ]`);
    setSelectedTool(tool);
    setStep('await_provider');
    setTimeout(() => {
      addMsg(
        'AI',
        'Selecciona el proveedor. Costos de red deducibles:\n- RUNWAY (250 CR)\n- LUMA (150 CR)\n- SEEDANCE (100 CR)',
      );
    }, 500);
  };

  const selectProvider = async (provider, cost) => {
    if (credits < cost) {
      addMsg('AI', 'ERROR: Fondos insuficientes. El capitalismo no perdona.');
      setStep('idle');
      return;
    }

    addMsg('User', `[ PROVIDER: ${provider} | -${cost} CR ]`);
    setCredits((prev) => prev - cost);
    setStep('generating');
    addMsg('AI', `[ INICIANDO SECUENCIA ] Conectando a ${provider}. Deduciendo ${cost} créditos...`);

    try {
      const result = await generateStudio({
        kind: 'video',
        prompt: currentPrompt,
        provider,
        providerLabel: provider,
        tool: selectedTool || 'TEXT2VIDEO',
        title: 'SLT Project',
      });

      if (!result.ok) {
        throw new Error(readableStudioMessage(result.message));
      }

      const serverCredits = result.data?.checks?.credits?.remaining;
      if (typeof serverCredits === 'number') {
        setCredits(serverCredits);
      }

      const immediateUrl = extractVideoUrl(result);
      const { jobId, provider: jobProvider, needsPoll } = extractAsyncJob(result);

      if (needsPoll && jobId) {
        addMsg('AI', `[ ENCOLADO - ID: ${jobId} ] Procesando en la oscuridad...`);

        const pollable = ['Seedance', 'OmniHuman'].includes(normalizeJobProvider(jobProvider || provider));

        if (pollable) {
          const pollResult = await pollJob(jobId, jobProvider || provider, {
            onTick: ({ attempt, maxAttempts }) => {
              if (attempt === 0 || attempt % 3 === 0) {
                addMsg('AI', `[ POLL ${attempt + 1}/${maxAttempts} ] Esperando señal de ${provider}...`);
              }
            },
          });

          if (pollResult.ok && pollResult.completed) {
            const videoUrl = extractVideoUrl(pollResult);
            if (videoUrl) {
              addMsg('AI', `[ ÉXITO ] Archivo generado:\n${videoUrl}`);
            } else {
              addMsg('AI', '[ ÉXITO ] Job completado. Revisa el historial del workspace.');
            }
          } else {
            addMsg(
              'AI',
              `[ ERROR ] ${readableStudioMessage(pollResult.message || 'La IA externa falló o devolvió caos.')}`,
            );
          }
        } else {
          addMsg(
            'AI',
            `[ ENCOLADO ] Job ${jobId} enviado a ${provider}. Polling local no disponible para este nodo.`,
          );
        }
      } else if (immediateUrl) {
        addMsg('AI', `[ ÉXITO ] Generación rápida:\n${immediateUrl}`);
      } else {
        addMsg(
          'AI',
          `[ ÉXITO ] ${result.data?.success || result.data?.historyItem?.message || 'Secuencia registrada en el servidor.'}`,
        );
      }
    } catch (error) {
      addMsg(
        'AI',
        `[ FATAL ERROR ] ${error.message}. ¿Está encendido el servidor backend y el .env cargado?`,
      );
      setCredits((prev) => prev + cost);
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
    credits,
    selectTool,
    selectProvider,
  };
}
