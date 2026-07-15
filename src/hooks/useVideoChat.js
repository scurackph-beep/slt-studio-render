import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  extractAsyncJob,
  generateStudio,
  pollJob,
  readableStudioMessage,
  normalizeJobProvider,
} from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import { useStudio } from '../context/StudioContext';
import { canUseGuestQuota, consumeGuestQuota } from '../lib/access-control';

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

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function useVideoChat({ initialPrompt = '', directorBrief = '', referenceAsset = null, durationSeconds = 10 } = {}) {
  const { session, isAuthenticated, isCEO, isGuest, isSpy } = useAuth();
  const { credits, refreshLedger } = useStudio();
  const [messages, setMessages] = useState([
    {
      sender: 'AI',
      text: 'Sweet Little Trauma Video Director is online. Describe the scene, choose a creation mode, then pick the provider.',
    },
  ]);
  const [input, setInput] = useState('');
  const [step, setStep] = useState('idle');
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);

  const availableCredits = useMemo(() => {
    if (isCEO || isGuest) return 'API direct';
    if (typeof credits === 'number') return credits;
    return '--';
  }, [credits, isCEO, isGuest]);

  const addMsg = useCallback((sender, text) => {
    setMessages((prev) => [...prev, { sender, text }]);
  }, []);

  useEffect(() => {
    const prompt = String(initialPrompt || '').trim();
    if (!prompt) return;
    setCurrentPrompt(prompt);
    setStep('await_tool');
    addMsg('User', prompt);
    addMsg('AI', 'Understood. Choose the video creation mode.');
  }, [initialPrompt, addMsg]);

  const handleSend = () => {
    if (!input.trim() || step === 'generating') return;

    if (isSpy) {
      addMsg('AI', 'Spy mode is read-only. Create an account, use CEO mode or enter a guest code to generate video.');
      return;
    }

    if (!isAuthenticated) {
      addMsg('AI', 'Session required. Log in from Profile before generating.');
      return;
    }

    const userInput = input;
    addMsg('User', userInput);
    setInput('');

    if (step === 'idle') {
      setCurrentPrompt(userInput);
      setStep('await_tool');
      setTimeout(() => {
        addMsg('AI', 'Understood. Choose the video creation mode.');
      }, 300);
    }
  };

  const selectTool = (tool) => {
    if (isSpy) {
      addMsg('AI', 'Spy mode is read-only. Video creation is blocked.');
      return;
    }
    addMsg('User', `[ TOOL: ${tool.label} ]`);
    setSelectedTool(tool);
    setStep('await_provider');
    setTimeout(() => {
      const options = tool.providers
        .map((name) => `- ${name} (${VIDEO_PROVIDER_COSTS[name] || 100} provider CR est.)`)
        .join('\n');
      addMsg('AI', `Select a provider. CEO/Guest skips SLT billing, but provider API credits are still consumed directly:\n${options}`);
    }, 300);
  };

  const selectProvider = async (provider) => {
    if (isSpy) {
      addMsg('AI', 'Spy mode is read-only. Video creation is blocked.');
      return;
    }
    if (!isAuthenticated) {
      addMsg('AI', 'Session required. Log in from Profile.');
      return;
    }

    if (!currentPrompt.trim()) {
      addMsg('AI', 'Write the scene brief first, then choose the creation mode and provider.');
      setStep('idle');
      return;
    }

    if (isGuest && !canUseGuestQuota('video', session)) {
      addMsg('AI', 'Guest quota reached for video. This guest pass allows 2 video requests.');
      setStep('idle');
      return;
    }

    const cost = VIDEO_PROVIDER_COSTS[provider] || 100;
    if (!isCEO && !isGuest && typeof credits === 'number' && credits < cost) {
      addMsg('AI', `Insufficient credits: ${credits} CR available, about ${cost} CR required.`);
      setStep('idle');
      return;
    }

    addMsg('User', `[ PROVIDER: ${provider} ]`);
    setStep('generating');
    addMsg('AI', `Connecting to ${provider}. Timer started.`);

    try {
      const renderPrompt = [
        currentPrompt,
        directorBrief ? `Director brief:\n${directorBrief}` : '',
        referenceAsset?.publicUrl ? `Reference asset: ${referenceAsset.publicUrl}` : '',
      ].filter(Boolean).join('\n\n');
      const renderDuration = Number(durationSeconds) || 10;
      const result = await generateStudio({
        kind: 'video',
        prompt: renderPrompt,
        provider,
        providerLabel: provider,
        tool: selectedTool?.id || 'TEXT2VIDEO',
        title: 'SLT Project',
        durationSeconds: renderDuration,
        videoDurationSeconds: renderDuration,
        referenceAssets: referenceAsset ? [referenceAsset] : [],
        referenceAssetIds: referenceAsset ? [referenceAsset.id] : [],
        referenceVideoUrl: referenceAsset?.contentType?.startsWith('video/') ? referenceAsset.publicUrl : '',
        referenceImageUrl: referenceAsset?.contentType?.startsWith('image/') ? referenceAsset.publicUrl : '',
        assetUrls: referenceAsset?.publicUrl ? [referenceAsset.publicUrl] : [],
      });

      if (!result.ok) {
        throw new Error(readableStudioMessage(result.message || result.data?.readableError || result.data?.error));
      }

      await refreshLedger().catch(() => null);
      if (isGuest) consumeGuestQuota('video', session);

      const immediateUrl = extractVideoUrl(result);
      const { jobId, provider: jobProvider, needsPoll } = extractAsyncJob(result);

      if (needsPoll && jobId) {
        const startedAt = Date.now();
        addMsg('AI', `[ TIMER 00:00 ] Render queued. Keep this page open or check Library when it completes.`);

        const pollable = ['Seedance', 'OmniHuman', 'Runway', 'Luma', 'Kling'].includes(
          normalizeJobProvider(jobProvider || provider),
        );

        if (pollable) {
          const pollResult = await pollJob(jobId, jobProvider || provider, {
            onTick: ({ attempt }) => {
              if (attempt === 0 || attempt % 3 === 0) {
                addMsg('AI', `[ TIMER ${formatElapsed(Date.now() - startedAt)} ] ${provider} is rendering.`);
              }
            },
          });

          await refreshLedger().catch(() => null);

          if (pollResult.ok && pollResult.completed) {
            const videoUrl = extractVideoUrl(pollResult);
            if (videoUrl) {
              addMsg('AI', `Completed. CDN asset ready:\n${videoUrl}`);
            } else {
              addMsg('AI', 'Completed. Check Library for the saved asset.');
            }
          } else {
            addMsg(
              'AI',
              readableStudioMessage(pollResult.message || 'The generation failed or expired.'),
            );
          }
        } else {
          addMsg('AI', `Render queued on ${provider}. You can keep working and check Library shortly.`);
        }
      } else if (immediateUrl) {
        addMsg('AI', `Generated:\n${immediateUrl}`);
      } else {
        addMsg(
          'AI',
          result.data?.success || result.data?.historyItem?.message || 'Sequence registered.',
        );
      }
    } catch (error) {
      addMsg('AI', readableStudioMessage(error.message));
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
    isGuest,
  };
}
