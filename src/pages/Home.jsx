import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { assistStudio, uploadReferenceAsset } from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import { readStore, storageKeys, writeStore } from '../lib/storage';
import './Home.css';

const CATEGORIES = [
  {
    id: 'image',
    label: 'IMAGE',
    path: '/image',
    prompt: 'Create, edit, upscale, build avatars, product images, references and campaigns.',
    keywords: ['image', 'photo', 'avatar', 'poster', 'logo', 'upscale', 'edit', 'picture', 'imagen', 'foto'],
  },
  {
    id: 'video',
    label: 'VIDEO',
    path: '/video',
    prompt: 'Generate video, lip sync, motion transfer, scene transfer, avatars and cinematic edits.',
    keywords: ['video', 'clip', 'film', 'lip', 'lipsync', 'sync', 'motion', 'scene', 'movement', 'movimiento'],
  },
  {
    id: 'sound',
    label: 'SOUND FX',
    path: '/sound',
    prompt: 'Create effects, voices, foley, dubbing, cleanup, soundscapes and audio repair.',
    keywords: ['sound', 'fx', 'voice', 'voz', 'audio', 'foley', 'dub', 'noise', 'cleanup'],
  },
  {
    id: 'music',
    label: 'MUSIC',
    path: '/music',
    prompt: 'Compose, hum melodies, build tracks, arrange, mix, master and export stems.',
    keywords: ['music', 'song', 'melody', 'hum', 'tarare', 'sing', 'cantar', 'track', 'stem', 'beat'],
  },
  {
    id: 'fashion',
    label: 'FASHION',
    path: '/fashion',
    prompt: 'Design looks, garments, textiles, palettes, try-on, runway and editorial campaigns.',
    keywords: ['fashion', 'clothes', 'outfit', 'garment', 'dress', 'textile', 'ropa', 'vestuario'],
  },
  {
    id: 'engineering',
    label: 'ENGINEERING',
    path: '/engineering',
    prompt: 'Build apps, games, automations, dashboards, agents and custom production tools.',
    keywords: ['app', 'game', 'web', 'site', 'engineering', 'automation', 'dashboard', 'juego'],
  },
  {
    id: 'assist',
    label: 'VIRTUAL ASSIST',
    path: '/assist',
    prompt: 'Plan the project, choose the correct studio and prepare the next action.',
    keywords: ['assist', 'assistant', 'help', 'ayuda', 'plan', 'organize'],
  },
];

const CATEGORY_ACTIONS = {
  image: [
    { id: 'text-to-image', label: 'Text to Image', copy: 'Generate visuals from a written brief.', providers: ['OpenAI Images', 'FLUX', 'Gemini Image', 'Ideogram'] },
    { id: 'image-to-image', label: 'Image to Image', copy: 'Transform or restyle an existing reference.', providers: ['OpenAI Images', 'FLUX', 'Stability', 'Replicate'] },
    { id: 'product', label: 'Product Shot', copy: 'Create campaign-ready product photography.', providers: ['OpenAI Images', 'Recraft', 'Leonardo', 'FLUX'] },
    { id: 'fashion-look', label: 'Fashion Look', copy: 'Build editorial looks, outfits and styling direction.', providers: ['Ideogram', 'OpenAI Images', 'FLUX', 'Stability'] },
    { id: 'logo', label: 'Logo', copy: 'Generate logo directions and brand marks.', providers: ['Ideogram', 'Recraft', 'OpenAI Images', 'Leonardo'] },
    { id: 'upscale', label: 'Upscale', copy: 'Enhance resolution and visual fidelity.', providers: ['Stability', 'Replicate', 'FLUX', 'OpenAI Images'] },
  ],
  video: [
    { id: 'lip-sync', label: 'Lip Sync', copy: 'Make a person, avatar or character speak or sing with matched mouth movement.', providers: ['OmniHuman', 'HeyGen', 'D-ID', 'Hailuo'] },
    { id: 'motion-transfer', label: 'Motion Transfer', copy: 'Copy movement, gesture, dance, acting or camera energy from one reference to another.', providers: ['OmniHuman', 'Runway', 'Kling', 'Wan'] },
    { id: 'scene-transfer', label: 'Scene Transfer', copy: 'Keep the subject or idea and move it into a new background, mood or cinematic world.', providers: ['Runway', 'Luma', 'Seedance', 'Kling'] },
    { id: 'image-to-video', label: 'Image to Video', copy: 'Animate an image, product, character, portrait, fashion look or concept still.', providers: ['Runway', 'Luma', 'Seedance', 'PixVerse'] },
    { id: 'text-to-video', label: 'Text to Video', copy: 'Start with a written idea and turn it into a short generated clip.', providers: ['Seedance', 'Runway', 'Veo', 'Kling'] },
    { id: 'style-change', label: 'Background / Styling', copy: 'Change background, clothes, hair, lighting, art direction or production design.', providers: ['Runway', 'Luma', 'Seedance', 'Kling'] },
  ],
  sound: [
    { id: 'voice', label: 'Voice', copy: 'Generate or shape a voice performance.', providers: ['ElevenLabs', 'OpenAI Audio', 'MiniMax Speech', 'Moises'] },
    { id: 'clone', label: 'Clone', copy: 'Clone a voice from reference audio.', providers: ['ElevenLabs', 'OpenAI Audio', 'MiniMax Speech'] },
    { id: 'narration', label: 'Narration', copy: 'Create spoken narration for film, ads or explainers.', providers: ['ElevenLabs', 'OpenAI Audio', 'MiniMax Speech'] },
    { id: 'foley', label: 'Foley', copy: 'Design foley layers and tactile sound.', providers: ['Stability Audio', 'ElevenLabs', 'Moises'] },
    { id: 'fx', label: 'Sound FX', copy: 'Generate effects, impacts and transitions.', providers: ['Stability Audio', 'ElevenLabs', 'MiniMax Speech'] },
    { id: 'cleanup', label: 'Cleanup', copy: 'Repair noise, hiss and damaged audio.', providers: ['Moises', 'Stability Audio', 'OpenAI Audio'] },
  ],
  music: [
    { id: 'track-builder', label: 'Track Builder', copy: 'Compose a new track from a creative brief.', providers: ['SLT Composer', 'MiniMax Music', 'Stable Audio', 'Suno'] },
    { id: 'arrangement', label: 'Arrangement', copy: 'Arrange sections, structure and instrumentation.', providers: ['SLT Composer', 'MiniMax Music', 'Stable Audio'] },
    { id: 'stem-separation', label: 'Stem Separation', copy: 'Split vocals, drums, bass and instruments.', providers: ['Moises', 'SLT Composer', 'Stable Audio'] },
    { id: 'mix-assistant', label: 'Mix Assistant', copy: 'Balance levels and production feel.', providers: ['SLT Composer', 'Stable Audio', 'MiniMax Music'] },
    { id: 'mastering', label: 'Mastering', copy: 'Prepare a final master for release.', providers: ['SLT Composer', 'Stable Audio', 'MiniMax Music'] },
    { id: 'export-stems', label: 'Export Stems', copy: 'Export stems and production assets.', providers: ['SLT Composer', 'Stable Audio'] },
  ],
  fashion: [
    { id: 'create-look', label: 'Create Look', copy: 'Design a full outfit direction.', providers: ['OpenAI Images', 'Ideogram', 'FLUX', 'Recraft'] },
    { id: 'outfit', label: 'Outfit', copy: 'Build garment combinations and styling.', providers: ['Ideogram', 'OpenAI Images', 'Leonardo', 'FLUX'] },
    { id: 'textile', label: 'Textile / Pattern', copy: 'Generate fabric, repeat and textile ideas.', providers: ['Recraft', 'Stability', 'OpenAI Images', 'FLUX'] },
    { id: 'try-on', label: 'Virtual Try-on', copy: 'Place looks on model or campaign framing.', providers: ['OpenAI Images', 'Ideogram', 'FLUX', 'Leonardo'] },
    { id: 'editorial', label: 'Editorial Shoot', copy: 'Create campaign and editorial visuals.', providers: ['OpenAI Images', 'FLUX', 'Ideogram', 'Stability'] },
    { id: 'runway', label: 'Runway Look', copy: 'Design show-ready runway styling.', providers: ['Ideogram', 'OpenAI Images', 'FLUX', 'Recraft'] },
  ],
  engineering: [
    { id: 'custom-app', label: 'Custom App Request', copy: 'Request a bespoke app or internal tool.', providers: ['Intake', 'Scoping', 'Build queue'] },
    { id: 'automation', label: 'Business Automation', copy: 'Automate workflows, dashboards and ops.', providers: ['Intake', 'Prototype', 'Delivery'] },
    { id: 'game-brief', label: 'Game Brief', copy: 'Pitch a game concept or interactive experience.', providers: ['Intake', 'Scoping', 'Prototype'] },
    { id: 'prototype-lab', label: 'Prototype Lab', copy: 'Test an idea before full build.', providers: ['Prototype', 'Review', 'Delivery'] },
    { id: 'creative-tools', label: 'Creative Tools', copy: 'Commission a custom creative production tool.', providers: ['Intake', 'Build queue', 'Delivery'] },
    { id: 'submit-idea', label: 'Submit Idea', copy: 'Send a product idea to the engineering queue.', providers: ['Intake', 'Review', 'Roadmap'] },
  ],
  assist: [
    { id: 'plan-project', label: 'Plan Project', copy: 'Break down the idea into the right studio workflow.', providers: ['SLT Producer Agent', 'Film Director Agent', 'CEO Operations Agent'] },
    { id: 'choose-studio', label: 'Choose Studio', copy: 'Find the best module for your goal.', providers: ['SLT Producer Agent', 'Studio Router Agent'] },
    { id: 'provider-routing', label: 'Provider Routing', copy: 'Pick providers, credits and execution path.', providers: ['Studio Router Agent', 'CEO Operations Agent'] },
    { id: 'production-brief', label: 'Production Brief', copy: 'Turn a loose idea into a production-ready brief.', providers: ['Film Director Agent', 'SLT Producer Agent'] },
  ],
};

const CATEGORY_QUICK_PROMPTS = {
  image: [
    'I want a product photo for a campaign',
    'I want to edit a portrait into editorial style',
    'I want a logo concept for my brand',
    'I want to upscale a reference image',
  ],
  video: [
    'I want to make a lip sync video',
    'I want to turn an image into a video',
    'I want a cinematic text to video clip',
    'I want to transfer motion between references',
  ],
  sound: [
    'I want a cinematic voiceover',
    'I want to clone a voice from audio',
    'I want foley for a short film',
    'I want to clean noisy dialogue',
  ],
  music: [
    'I want to hum a melody and build a song',
    'I want a dream pop instrumental',
    'I want stems separated from a track',
    'I want a mastered final version',
  ],
  fashion: [
    'I want to design a runway look',
    'I want a textile pattern for a collection',
    'I want a virtual try-on visual',
    'I want an editorial fashion campaign',
  ],
  engineering: [
    'I want to build a custom app',
    'I want a business automation dashboard',
    'I want to prototype a game idea',
    'I want to submit a product concept',
  ],
  assist: [
    'Help me choose the right studio',
    'Plan my production workflow',
    'Which provider should I use?',
    'Turn my idea into a production brief',
  ],
};

const CATEGORY_ASSISTANT_INTRO = {
  image: 'Image mode active. Tell me what visual you need or pick a starting action.',
  video: 'Video mode active. Choose an action like lip sync, image to video or text to video.',
  sound: 'Sound FX mode active. Describe the voice, foley, FX or cleanup you need.',
  music: 'Music mode active. Describe the track, stems, mix or master you want.',
  fashion: 'Fashion mode active. Define the look, textile, try-on or editorial direction.',
  engineering: 'Engineering mode active. Send a brief for apps, automations or prototypes.',
  assist: 'Virtual Assist active. I can help route you to the right studio and provider.',
};

function classifyIntent(text) {
  const lower = text.toLowerCase();
  const category = CATEGORIES.find((item) => item.keywords.some((keyword) => lower.includes(keyword))) || CATEGORIES[6];

  let action = null;
  if (category.id === 'video') {
    if (/lip|sync|boca|cantar|sing/.test(lower)) action = CATEGORY_ACTIONS.video[0];
    else if (/motion|movement|move|dance|gesture|movimiento|transfer/.test(lower)) action = CATEGORY_ACTIONS.video[1];
    else if (/scene|background|fondo|escena|setting/.test(lower)) action = CATEGORY_ACTIONS.video[2];
    else if (/image|photo|still|imagen|foto/.test(lower)) action = CATEGORY_ACTIONS.video[3];
    else if (/text|prompt|idea|script/.test(lower)) action = CATEGORY_ACTIONS.video[4];
    else if (/clothes|hair|style|vestuario|peinado|ropa/.test(lower)) action = CATEGORY_ACTIONS.video[5];
    else action = CATEGORY_ACTIONS.video[4];
  } else {
    const actions = CATEGORY_ACTIONS[category.id] || [];
    action = actions.find((item) => lower.includes(item.label.toLowerCase())) || actions[0] || null;
  }

  return { category, action };
}

function localAssistantReply(text, category, action) {
  if (!text.trim()) {
    return CATEGORY_ASSISTANT_INTRO[category.id] || 'Tell me what you want to create.';
  }

  if (action) {
    return `For ${category.label}, start with ${action.label}. Suggested providers: ${action.providers.slice(0, 3).join(', ')}.`;
  }

  return `This sounds like ${category.label}. I can open that studio and keep your request as the starting brief.`;
}

export default function Home() {
  const navigate = useNavigate();
  const { isSpy } = useAuth();
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const [input, setInput] = useState('');
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[1]);
  const [activeAction, setActiveAction] = useState(CATEGORY_ACTIONS.video[0]);
  const [messages, setMessages] = useState([
    {
      sender: 'studio',
      text: 'Hi — I\'m your studio assistant. Describe what you want to create and I\'ll route you to the right tool and provider.',
    },
  ]);
  const [assistantState, setAssistantState] = useState('Ready');
  const [isThinking, setIsThinking] = useState(false);

  const suggestedActions = useMemo(
    () => CATEGORY_ACTIONS[activeCategory.id] || [],
    [activeCategory.id],
  );

  const quickPrompts = useMemo(
    () => CATEGORY_QUICK_PROMPTS[activeCategory.id] || CATEGORY_QUICK_PROMPTS.assist,
    [activeCategory.id],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const handleCategorySelect = (category) => {
    const actions = CATEGORY_ACTIONS[category.id] || [];
    setActiveCategory(category);
    setActiveAction(actions[0] || null);
    setMessages((current) => [
      ...current,
      { sender: 'studio', text: CATEGORY_ASSISTANT_INTRO[category.id] || `Switched to ${category.label}.` },
    ]);
    setAssistantState(`${category.label} selected`);
  };

  const openStudio = (category = activeCategory, action = activeAction, prompt = input) => {
    const params = new URLSearchParams();
    if (prompt.trim()) params.set('prompt', prompt.trim());
    if (action?.id) params.set('tool', action.id);
    if (action?.providers?.[0]) params.set('provider', action.providers[0]);
    navigate(`${category.path}${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const runIntent = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;
    if (isSpy) {
      setInput('');
      const { category, action } = classifyIntent(trimmed);
      setActiveCategory(category);
      if (action) setActiveAction(action);
      setMessages((current) => [
        ...current,
        { sender: 'user', text: trimmed },
        { sender: 'studio', text: 'Spy mode is read-only. You can browse the site and inspect tools, but AI requests, uploads and generation are disabled.' },
      ]);
      setAssistantState('Spy read-only');
      return;
    }

    const { category, action } = classifyIntent(trimmed);
    setActiveCategory(category);
    if (action) setActiveAction(action);
    setInput('');
    setIsThinking(true);

    const reply = localAssistantReply(trimmed, category, action);
    setMessages((current) => [
      ...current,
      { sender: 'user', text: trimmed },
      { sender: 'studio', text: reply },
    ]);

    setAssistantState('Thinking...');
    const ai = await Promise.race([
      assistStudio({
        title: 'Home Intent Assistant',
        provider: 'OpenAI',
        prompt: `You are the Sweet Little Trauma Studio routing assistant. Briefly guide the user to the best module, action and providers. User request: ${trimmed}`,
      }),
      new Promise((resolve) => {
        window.setTimeout(() => resolve({ ok: false, timedOut: true }), 3500);
      }),
    ]);

    if (ai.ok && ai.data?.historyItem?.response) {
      setMessages((current) => [
        ...current,
        { sender: 'studio', text: ai.data.historyItem.response },
      ]);
      setAssistantState('Online');
    } else {
      setAssistantState('Ready');
    }

    setIsThinking(false);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    runIntent(input);
  };

  const handleQuickPrompt = (prompt) => {
    runIntent(prompt);
  };

  const handleChatKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      runIntent(input);
    }
  };

  const handleAttach = () => {
    if (isSpy) {
      setMessages((current) => [
        ...current,
        { sender: 'studio', text: 'Spy mode is read-only. File upload is disabled.' },
      ]);
      setAssistantState('Spy read-only');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (isSpy) {
      setAssistantState('Spy read-only');
      event.target.value = '';
      return;
    }
    setAssistantState('Uploading reference...');
    const module = activeCategory.id === 'assist' ? 'image' : activeCategory.id;
    const kind = module === 'music' || module === 'sound' ? module : module === 'video' ? 'video' : 'image';
    const result = await uploadReferenceAsset({
      file,
      kind,
      module,
      role: 'home-reference',
      note: file.name,
    });
    if (result.ok && result.data?.asset) {
      const uploads = readStore(storageKeys.uploads, []);
      writeStore(storageKeys.uploads, [result.data.asset, ...uploads].slice(0, 20));
      setMessages((current) => [
        ...current,
        { sender: 'studio', text: `Reference uploaded: ${file.name}. Open ${activeCategory.label} to use it.` },
      ]);
      setAssistantState('Reference uploaded');
    } else {
      setMessages((current) => [
        ...current,
        { sender: 'studio', text: result.message || 'Upload failed. Log in from Profile first.' },
      ]);
      setAssistantState('Upload failed');
    }
    event.target.value = '';
  };

  return (
    <section className="home-command">
      <div className="home-command-bg" aria-hidden="true" />

      <div className="home-command-shell">
        <div className="home-category-row" aria-label="Studios">
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`home-category ${activeCategory.id === category.id ? 'is-active' : ''}`}
              onClick={() => handleCategorySelect(category)}
            >
              <span>{category.label}</span>
            </button>
          ))}
        </div>

        <div className="home-intent-grid">
          <div className="home-chat-panel">
            <div className="home-chat-header">
              <p className="home-panel-label">Studio Assistant</p>
              <span className="home-chat-status">{assistantState}</span>
            </div>

            <div className="home-message-list" aria-live="polite">
              {messages.map((message, index) => (
                <div
                  key={`${message.sender}-${index}-${message.text.slice(0, 24)}`}
                  className={`home-message-bubble home-message-bubble--${message.sender}`}
                >
                  <span className="home-message-role">
                    {message.sender === 'user' ? 'You' : 'Assistant'}
                  </span>
                  <p>{message.text}</p>
                </div>
              ))}
              {isThinking ? (
                <div className="home-message-bubble home-message-bubble--studio home-message-bubble--typing">
                  <span className="home-message-role">Assistant</span>
                  <p><span className="home-typing-dots" aria-hidden="true">...</span> Thinking</p>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            {!messages.some((message) => message.sender === 'user') ? (
              <div className="home-chat-suggestions">
                {quickPrompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => handleQuickPrompt(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}

            <form className="home-chat-composer" onSubmit={handleSubmit}>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept="image/*,video/*,audio/*"
                onChange={handleFileSelected}
              />
              <textarea
                ref={chatInputRef}
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, 500))}
                onKeyDown={handleChatKeyDown}
                placeholder="Message the assistant..."
                rows={2}
                disabled={isThinking}
              />
              <div className="home-chat-composer-actions">
                <button type="button" className="home-icon-button" aria-label="Attach file" onClick={handleAttach}>
                  +
                </button>
                <button type="submit" className="home-send-button" disabled={!input.trim() || isThinking}>
                  Send
                </button>
              </div>
            </form>
          </div>

          <div className="home-tool-panel" key={`tool-${activeCategory.id}`}>
            <p className="home-panel-label">{activeCategory.label}</p>
            <h2>{activeCategory.prompt}</h2>

            {suggestedActions.length > 0 ? (
              <div className="home-video-actions">
                {suggestedActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={`home-video-action ${activeAction?.id === action.id ? 'is-active' : ''}`}
                    onClick={() => setActiveAction(action)}
                  >
                    <span>{action.label}</span>
                    <small>{action.copy}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="home-tool-copy">{activeCategory.prompt}</p>
            )}

            <div className="home-provider-strip">
              {(activeAction?.providers || suggestedActions[0]?.providers || []).map((provider) => (
                <span key={provider}>{provider}</span>
              ))}
            </div>

            <button type="button" className="home-open-studio" onClick={() => openStudio()}>
              Open {activeCategory.label}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
