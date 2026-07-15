import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import { assistStudio, readableStudioMessage } from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import './StudioLayout.css';

const AGENTS = [
  {
    id: 'producer',
    name: 'SLT Producer Agent',
    role: 'Routes ideas into the right studio, provider and next step.',
    provider: 'OpenAI',
  },
  {
    id: 'director',
    name: 'Film Director Agent',
    role: 'Builds shot lists, scenes, camera language and production briefs.',
    provider: 'OpenAI',
  },
  {
    id: 'sound',
    name: 'Audio & Music Agent',
    role: 'Plans voice, music, sound design, stems and mix direction.',
    provider: 'OpenAI',
  },
  {
    id: 'ops',
    name: 'CEO Operations Agent',
    role: 'Summarizes provider routing, credits, projects and execution risks.',
    provider: 'Meta Llama',
  },
];

const QUICK_ASSIST = [
  'Choose the right studio for my idea.',
  'Turn this into a production brief.',
  'Which provider should I use and why?',
  'Build a step-by-step plan for video, image and sound.',
];

export default function VirtualAssist() {
  const { isAuthenticated, isCEO, isGuest, isSpy } = useAuth();
  const [agentId, setAgentId] = useState('producer');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([
    {
      sender: 'agent',
      text: 'Tell me what you want to create. I will route it into a studio workflow, recommended providers and next actions.',
    },
  ]);

  const agent = useMemo(
    () => AGENTS.find((item) => item.id === agentId) || AGENTS[0],
    [agentId],
  );

  const addMessage = (sender, text) => {
    setMessages((current) => [...current, { sender, text }]);
  };

  const sendMessage = async (message = input) => {
    const prompt = message.trim();
    if (!prompt || busy) return;
    setInput('');
    addMessage('user', prompt);

    if (isSpy) {
      addMessage('agent', 'Spy mode is read-only. You can inspect the assistant flow, but live agent requests are disabled.');
      return;
    }

    if (!isAuthenticated) {
      addMessage('agent', 'Log in, enter CEO mode or use a guest code to talk to the live studio agent.');
      return;
    }

    setBusy(true);
    const systemPrompt = [
      `You are ${agent.name} inside Sweet Little Trauma Studio.`,
      agent.role,
      'Answer in English, concise and operational. Recommend the right module, action, provider options and any required user input.',
      `User request: ${prompt}`,
    ].join('\n');

    const result = await assistStudio({
      title: agent.name,
      provider: agent.provider,
      prompt: systemPrompt,
    });

    if (result.ok) {
      addMessage(
        'agent',
        result.data?.historyItem?.response || result.data?.success || 'Agent response ready.',
      );
    } else {
      addMessage('agent', readableStudioMessage(result.message || result.data?.readableError || result.data?.error));
    }
    setBusy(false);
  };

  return (
    <section className="assist-page">
      <header className="assist-header">
        <div>
          <BrandLogo variant="compact" />
          <p className="studio-rail-label">Virtual Assist</p>
          <h1>Studio Agent</h1>
          <p>
            {isCEO ? 'CEO mode · API direct' : isGuest ? 'Guest mode · API direct' : isAuthenticated ? 'Live agent ready' : 'Session required'}
          </p>
        </div>
        {!isAuthenticated ? (
          <Link to="/profile" className="video-secondary-button">Open access portal</Link>
        ) : null}
      </header>

      <div className="assist-grid">
        <aside className="assist-agent-list">
          <p className="studio-aside-label">Agents</p>
          {AGENTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`assist-agent ${agentId === item.id ? 'is-active' : ''}`}
              onClick={() => setAgentId(item.id)}
            >
              <span>{item.name}</span>
              <small>{item.role}</small>
            </button>
          ))}
        </aside>

        <main className="assist-chat-panel">
          <div className="assist-message-list" aria-live="polite">
            {messages.map((message, index) => (
              <article key={`${message.sender}-${index}`} className={`assist-message assist-message--${message.sender}`}>
                <span>{message.sender === 'user' ? 'You' : agent.name}</span>
                <p>{message.text}</p>
              </article>
            ))}
            {busy ? (
              <article className="assist-message assist-message--agent">
                <span>{agent.name}</span>
                <p>Thinking through the production path...</p>
              </article>
            ) : null}
          </div>

          <div className="assist-quick-row">
            {QUICK_ASSIST.map((prompt) => (
              <button key={prompt} type="button" onClick={() => sendMessage(prompt)}>
                {prompt}
              </button>
            ))}
          </div>

          <form
            className="assist-input"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage();
            }}
          >
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, 1000))}
              placeholder="Ask the studio agent what to do next..."
              rows={4}
              disabled={busy}
            />
            <button type="submit" className="video-primary-button" disabled={busy || !input.trim()}>
              {busy ? 'Working' : 'Ask Agent'}
            </button>
          </form>
        </main>
      </div>
    </section>
  );
}
