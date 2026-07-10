import { useState } from 'react';
import {
  extractAsyncJob,
  generateStudio,
  pollJob,
  readableStudioMessage,
} from '../lib/api-client';
import { readStore, storageKeys, writeStore } from '../lib/storage';

function persistGeneration(result) {
  const entry = result.data.historyItem || result.data.project;
  if (entry) {
    const history = readStore(storageKeys.history, []);
    writeStore(storageKeys.history, [entry, ...history].slice(0, 40));
  }
  if (result.data.subscription) {
    writeStore(storageKeys.subscription, result.data.subscription);
  }
}

export function useStudioGenerate(kind) {
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState('');

  const runGenerate = async ({ title, prompt, provider, providerLabel, tool }) => {
    setGenerating(true);
    setStatus('Generating…');

    const result = await generateStudio({
      kind,
      title,
      prompt,
      provider,
      providerLabel,
      tool,
    });

    if (!result.ok) {
      setStatus(readableStudioMessage(result.message));
      setGenerating(false);
      return result;
    }

    persistGeneration(result);

    const { jobId, provider: jobProvider, needsPoll } = extractAsyncJob(result);

    if (needsPoll && jobId) {
      setStatus('Processing…');

      const pollResult = await pollJob(jobId, jobProvider || provider, {
        onTick: ({ attempt, maxAttempts }) => {
          setStatus(`Processing… ${attempt + 1}/${maxAttempts}`);
        },
      });

      if (pollResult.ok && pollResult.completed) {
        if (pollResult.data.historyItem || pollResult.data.project) {
          persistGeneration(pollResult);
        }
        setStatus(pollResult.data.message || 'Generation complete.');
      } else {
        setStatus(readableStudioMessage(pollResult.message || pollResult.data?.message));
      }

      setGenerating(false);
      return pollResult;
    }

    setStatus(result.data.success || result.data.message || 'Generation complete.');
    setGenerating(false);
    return result;
  };

  return { generating, status, setStatus, runGenerate };
}
