import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import { useVideoChat } from '../hooks/useVideoChat';
import './StudioLayout.css';

export default function VideoStudio() {
  const [searchParams] = useSearchParams();
  const initialPrompt = searchParams.get('prompt') || '';
  const {
    messages,
    input,
    setInput,
    handleSend,
    step,
    credits,
    selectTool,
    selectProvider,
    isAuthenticated,
    isCEO,
    isGuest,
    tools,
    providers,
  } = useVideoChat({ initialPrompt });

  return (
    <section className="video-chat">
      <header className="video-chat-header">
        <div>
          <BrandLogo variant="compact" />
          <p className="studio-rail-label">Video Studio</p>
          <h1>Secure Terminal</h1>
          <p>Conversational video generation · {isCEO ? 'CEO mode' : isAuthenticated ? 'Session active' : 'No session'}</p>
        </div>
        <div className="video-chat-meta">
          <span className="video-chat-credits">
            {isCEO ? 'CEO · API direct' : isGuest ? 'Guest · API direct' : `${credits} CR`}
          </span>
          {!isAuthenticated ? (
            <Link to="/profile" className="video-secondary-button">Log in</Link>
          ) : null}
        </div>
      </header>

      <div className="video-chat-shell">
        <div className="video-chat-messages" aria-live="polite">
          {messages.map((message, index) => (
            <div
              key={`${message.sender}-${index}`}
              className={`video-chat-message video-chat-message--${message.sender.toLowerCase()}`}
            >
              <span className="video-chat-sender">{message.sender}</span>
              <pre>{message.text}</pre>
            </div>
          ))}
        </div>

        {step === 'await_tool' ? (
          <div className="video-chat-actions">
            {tools.map((tool) => (
              <button key={tool.id} type="button" className="video-chip" onClick={() => selectTool(tool)}>
                {tool.label}
              </button>
            ))}
          </div>
        ) : null}

        {step === 'await_provider' ? (
          <div className="video-chat-actions">
            {providers.map((provider) => (
              <button key={provider} type="button" className="video-chip" onClick={() => selectProvider(provider)}>
                {provider}
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="video-chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            handleSend();
          }}
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={step === 'generating' ? 'Generando...' : 'Describe los requerimientos técnicos...'}
            rows={3}
            disabled={step === 'generating'}
          />
          <button type="submit" className="video-primary-button" disabled={step === 'generating' || !input.trim()}>
            {step === 'generating' ? 'Processing...' : 'Send'}
          </button>
        </form>
      </div>
    </section>
  );
}
