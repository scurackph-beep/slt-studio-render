import { useState } from 'react';
import { Link } from 'react-router-dom';
import { submitPlatformForm } from '../lib/api-client';
import './StudioLayout.css';

const SUBSCRIPTION_PLANS = [
  {
    name: 'Free',
    price: '$0',
    credits: '30 credits',
    video: 'Up to 10 seconds, limited daily testing',
    includes: ['Browse the platform', 'Preview workflows', 'Use bought credits for short tests'],
  },
  {
    name: 'Pro',
    price: '$59 / month',
    credits: '1,500 credits / month',
    video: 'Up to 10 seconds per render',
    includes: ['Image, sound and video creation', 'Saved library', 'Provider fallback routing'],
  },
  {
    name: 'Studio',
    price: '$149 / month',
    credits: '5,000 credits / month',
    video: 'Up to 15 seconds per render',
    includes: ['Higher daily video volume', 'Music and sound workflows', 'Production history'],
  },
  {
    name: 'Business',
    price: '$299 / month',
    credits: '12,000 credits / month',
    video: 'Up to 30 seconds per render',
    includes: ['Team-ready production use', 'More daily video capacity', 'Priority support queue'],
  },
  {
    name: 'Creator',
    price: '$400 / month',
    credits: '20,000 credits / month',
    video: 'Up to 60 seconds per render',
    includes: ['Advanced creator allowance', 'Film-style workflows', 'Long-form planning support'],
  },
];

const CREDIT_PACKS = [
  { name: '500 extra credits', price: '$30' },
  { name: '1,000 extra credits', price: '$49' },
  { name: '3,000 extra credits', price: '$129' },
  { name: '7,500 extra credits', price: '$299' },
  { name: '15,000 extra credits', price: '$549' },
];

const VIDEO_COSTS = [
  { provider: 'Runway Gen-4 Turbo', estimate: '5 credits / second', minimum: '25 credits minimum' },
  { provider: 'Runway Gen-4.5', estimate: '12 credits / second', minimum: '60 credits minimum' },
  { provider: 'Seedance', estimate: '12 credits / second', minimum: '60 credits minimum' },
  { provider: 'Kling 3.0 Standard', estimate: '8 credits / second', minimum: '40 credits minimum' },
  { provider: 'Kling Omni', estimate: '14 credits / second', minimum: '70 credits minimum' },
  { provider: 'OmniHuman', estimate: '18 credits / second', minimum: '90 credits minimum' },
];

const ABOUT_SECTIONS = [
  {
    eyebrow: 'The Core',
    title: 'The Creative Holding',
    body: [
      'Sweet Little Trauma Studio is the operating layer of a transmedia creative holding designed to centralize, incubate, produce and distribute projects with cultural, artistic and commercial potential.',
      'It is not only an agency, not only an AI platform and not only a production company. It is an ecosystem built to create its own art, technology, stories, media, fashion, music, software, tools, campaigns and cultural products.',
      'The holding structure allows one idea to become several things at once: a song, a video, a visual identity, a fashion drop, a campaign, an app, a game, a character, a show or a complete universe.',
    ],
  },
  {
    eyebrow: 'Brand Concept',
    title: 'The Fracture, The Glow and The Garage',
    body: [
      'The name Sweet Little Trauma lives in contradiction. Sweetness is the surface, trauma is the fracture, and the studio is the place where both are transformed into something useful, visible and beautiful.',
      'The cracked neon rainbow is not decorative. It is the main symbol of the brand: light interrupted, emotion split open, a familiar icon damaged and still glowing. It represents repair, contradiction, memory, humor, survival and spectacle.',
      'The creative atmosphere is a future garage: cinematic, slightly broken, technical, elegant, alive. A place where damaged ideas are rebuilt into songs, images, films, garments, software and worlds.',
    ],
    list: ['Cracked neon rainbow', 'Future garage', 'Broken and luminous', 'Cinematic production', 'Repair as creation', 'Emotional technology'],
  },
  {
    eyebrow: 'The Void',
    title: 'The Space Before The Idea Exists',
    body: [
      'Void is the internal concept for the empty space before a project has a final name, form or category. It is the blank room where strange ideas, unfinished characters, scenes, melodies, business models and visual worlds wait before becoming production.',
      'It is not a visual mode and it is not a decorative mascot. It is a creative state: the unknown, the silence before the song, the black frame before the film starts, the empty screen before the first command.',
      'Inside the platform, this concept supports the way Sweet Little Trauma treats unfinished material. A rough thought can enter the system and be guided toward image, video, music, sound, fashion, engineering or representation.',
    ],
    list: ['Unknown space', 'Idea incubation', 'Unfinished projects', 'Blank frame', 'Creative darkness', 'Future form'],
  },
  {
    eyebrow: 'Operating Pillar 01',
    title: 'Agency, Marketing and Brand Positioning',
    body: [
      'The agency side develops positioning, campaigns, launch systems, content direction, social media architecture, brand voice, visual concepts and marketing workflows for artists, creators, businesses and internal Sweet Little Trauma projects.',
      'The focus is not random posting or generic advertising. The work is strategic: define what the brand is, what it sells, who it speaks to, how it appears online, what content should exist, and how each campaign moves people toward attention, memory and conversion.',
      'Services can include brand positioning, naming, storytelling, content calendars, campaign concepts, creative direction, platform strategy, reels, short-form content, launch assets and performance-ready messaging.',
    ],
    list: ['Brand positioning', 'Marketing strategy', 'Social media campaigns', 'Content systems', 'Launch planning', 'Creative direction'],
  },
  {
    eyebrow: 'Operating Pillar 02',
    title: 'Music Production, Songs and Representation',
    body: [
      'Sweet Little Trauma includes a music production and representation layer for songs, lyrics, melodies, arrangements, toplines, demos, sonic branding, releases, visual identity and artist-facing creative development.',
      'The studio can work as a songwriter room, production lab, catalog builder, sync-minded music house and creative representation system. Songs are not treated as isolated files. They can become videos, fashion references, characters, campaigns, live concepts, licensing opportunities and cultural assets.',
      'Representation means shaping how an artist, song, project or creative identity enters the world: image, sound, story, positioning, rollout, media, content and long-term direction.',
    ],
    list: ['Music production', 'Lyrics and songwriting', 'Artist development', 'Catalog building', 'Sync and licensing direction', 'Release strategy'],
  },
  {
    eyebrow: 'Operating Pillar 03',
    title: 'Software, Apps and Workflow Automation',
    body: [
      'The engineering side develops websites, applications, dashboards, automations, internal tools, creative interfaces, AI assistants and workflow systems for both clients and Sweet Little Trauma internal operations.',
      'This includes automating repetitive work, organizing production pipelines, connecting APIs, building intake systems, routing tasks, creating admin panels, managing assets and turning messy creative processes into usable digital systems.',
      'The goal is to give artists, brands and teams more control over production without forcing them to become technical operators.',
    ],
    list: ['Websites', 'Applications', 'Workflow automation', 'AI assistants', 'Dashboards', 'Internal tools'],
  },
  {
    eyebrow: 'Operating Pillar 04',
    title: 'Audiovisual and Digital Expansion',
    body: [
      'Sweet Little Trauma is also built as a media universe. The platform is designed to expand into a digital radio station, interactive videogames, YouTube reality formats, cinematic productions, character systems and future physical production spaces.',
      'The long-term goal is to create a living network of content and experiences where each project can connect to another: music can become video, video can become character, character can become game, and game can become culture.',
      'This makes the company a producer and distributor of its own universe, not only a service provider for outside work.',
    ],
    list: ['Digital radio station', 'Interactive videogames', 'YouTube reality show', 'Cinematic content', 'Transmedia characters', 'Future production facilities'],
  },
  {
    eyebrow: 'Operating Pillar 05',
    title: 'Aesthetics and Fashion',
    body: [
      'The fashion and apparel direction combines streetwear with boho-chic elegance: relaxed silhouettes, fluid fabrics, long tunics, custom patterns, loose combinations, layered pieces and a sense of calculated ease.',
      'The line is not costume, not trend noise and not ridiculous excess. It should feel wearable, free, strange enough to be remembered and refined enough to last.',
      'Merch is treated as an extension of the universe, not as cheap logo placement. Apparel, objects and physical products should carry the same language as the studio: cracked light, future garage, emotional technology, cinematic restraint and controlled oddness.',
    ],
    list: ['Apparel', 'Merch', 'Streetwear and boho-chic fusion', 'Custom textile patterns', 'Loose layered silhouettes', 'Relaxed calculated elegance'],
  },
  {
    eyebrow: 'Product System',
    title: 'Products, Services and Internal IP',
    body: [
      'Sweet Little Trauma Studio offers both services and owned products. Services include creative production, AI-assisted media creation, marketing, software, music, fashion concepts, representation and automation. Products include digital tools, generated assets, apparel, merch, media formats, characters, shows, games and future physical experiences.',
      'The company is designed so that client work, internal IP and platform tools can feed each other. A campaign can generate a product idea. A song can generate a character. A fashion concept can generate visuals. A software tool can become a product.',
      'This is why the studio is structured as an ecosystem: every department can create value alone, but the real power appears when they connect.',
    ],
    list: ['Creative services', 'Owned IP', 'Digital products', 'Media formats', 'Merch and apparel', 'Platform tools'],
  },
];

const PAGES = {
  about: {
    eyebrow: 'About Us',
    title: 'Sweet Little Trauma Studio is a cinematic AI production ecosystem.',
    body: 'A transmedia creative holding, production platform and cultural ecosystem for image, video, music, sound, fashion, software, marketing, representation, automation, merchandise, apparel and original intellectual property. It turns creative intention into production without forcing users to get lost inside tools.',
    actions: [{ label: 'Start Creating', to: '/' }],
    hasAboutDetails: true,
  },
  careers: {
    eyebrow: 'Careers',
    title: 'Work with us.',
    body: 'We welcome collaborators, developers, designers, editors, prompt artists, producers and AI operators. Submit your application below.',
    hasForm: true,
  },
  privacy: {
    eyebrow: 'Privacy',
    title: 'Privacy Policy.',
    body: 'This page is ready for the final legal privacy policy. It should describe data collection, account data, uploaded files, generation history, cookies and provider processing.',
    actions: [{ label: 'Contact Support', to: '/contact' }],
  },
  terms: {
    eyebrow: 'Terms',
    title: 'Terms and Conditions.',
    body: 'This page is ready for the final legal terms, including acceptable use, subscription rules, credits, refunds, generated content, licenses and service availability.',
    actions: [{ label: 'Plans', to: '/subscription' }],
  },
  sitemap: {
    eyebrow: 'Site Map',
    title: 'Main areas.',
    body: 'Home, Image Studio, Video Studio, Music Studio, Sound FX Studio, Library, Fashion Studio, Engineering Lab, Virtual Assist, Billing, Profile, Settings, Help and Contact.',
    actions: [
      { label: 'Image', to: '/image' },
      { label: 'Video', to: '/video' },
      { label: 'Music', to: '/music' },
      { label: 'Sound', to: '/sound' },
      { label: 'Library', to: '/library' },
      { label: 'Fashion', to: '/fashion' },
      { label: 'Engineering', to: '/engineering' },
    ],
  },
  subscription: {
    eyebrow: 'Subscription',
    title: 'Plans and credits.',
    body: 'Plans combine monthly credits with optional credit packs. CEO and invited guest modes skip SLT billing, but still consume credits directly from provider accounts.',
    actions: [{ label: 'Open Studio', to: '/' }],
    isSubscription: true,
  },
  profile: {
    eyebrow: 'Profile',
    title: 'Your creative profile.',
    body: 'This area is ready for login, account identity, saved preferences, plan status and generation history.',
    actions: [{ label: 'Settings', to: '/settings' }],
  },
  settings: {
    eyebrow: 'Settings',
    title: 'Studio settings.',
    body: 'This area is prepared for language, theme, default providers, API routing preferences, safety settings and storage options.',
    actions: [{ label: 'Help and Support', to: '/help' }],
  },
  help: {
    eyebrow: 'Help and Support',
    title: 'How can we help?',
    body: 'Use the Home assistant to describe what you want. The system will guide you to the right studio, action and provider. You can also send a support request from Contact.',
    actions: [{ label: 'Go Home', to: '/' }, { label: 'Contact', to: '/contact?kind=support' }],
  },
  assist: {
    eyebrow: 'Virtual Assist',
    title: 'Ask the studio assistant.',
    body: 'The central assistant lives on the Home page. It helps choose the right category, tool, provider and next step.',
    actions: [{ label: 'Open Assistant', to: '/' }],
  },
  'not-found': {
    eyebrow: '404',
    title: 'This area is not ready yet.',
    body: 'The route exists as a safe fallback so the app does not break while the product grows.',
    actions: [{ label: 'Back Home', to: '/' }],
  },
};

function SubscriptionDetails() {
  return (
    <div className="subscription-detail">
      <div className="subscription-plan-grid">
        {SUBSCRIPTION_PLANS.map((plan) => (
          <article key={plan.name} className="subscription-card">
            <span className="subscription-plan-name">{plan.name}</span>
            <strong>{plan.price}</strong>
            <p>{plan.credits}</p>
            <small>{plan.video}</small>
            <ul>
              {plan.includes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="subscription-info-grid">
        <section className="subscription-panel">
          <p className="studio-aside-label">Extra credit packs</p>
          <div className="subscription-pack-list">
            {CREDIT_PACKS.map((pack) => (
              <span key={pack.name}>
                <strong>{pack.name}</strong>
                {pack.price}
              </span>
            ))}
          </div>
        </section>

        <section className="subscription-panel">
          <p className="studio-aside-label">Video credit estimates</p>
          <div className="subscription-cost-table">
            {VIDEO_COSTS.map((row) => (
              <div key={row.provider}>
                <span>{row.provider}</span>
                <span>{row.estimate}</span>
                <span>{row.minimum}</span>
              </div>
            ))}
          </div>
          <p className="subscription-note">
            Final cost is calculated server-side before the job is queued. Failed provider jobs release reserved credits automatically.
          </p>
        </section>
      </div>
    </div>
  );
}

function AboutDetails() {
  return (
    <div className="about-detail">
      <section className="about-manifesto">
        <p className="studio-aside-label">Brand thesis</p>
        <div>
          <p>
            Sweet Little Trauma is built around contrast: broken and luminous, futuristic and human,
            minimal and emotional, precise and chaotic, technical and cinematic.
          </p>
          <p>
            Its symbol is a cracked neon rainbow: beauty with fracture, light after impact,
            creation as repair, and technology used to transform what hurts into something visible.
          </p>
          <p>
            The company is designed to move between service, product and culture. It can build for clients,
            develop internal intellectual property, produce music, launch apparel, create digital tools,
            represent creative work and turn scattered ideas into connected systems.
          </p>
        </div>
      </section>

      <div className="about-section-grid">
        {ABOUT_SECTIONS.map((section) => (
          <article key={section.title} className="about-section-panel">
            <p className="studio-aside-label">{section.eyebrow}</p>
            <h2>{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.list?.length ? (
              <ul>
                {section.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>

      <section className="about-promise">
        <span>A cinematic AI studio for broken, luminous, impossible ideas.</span>
        <p>
          You bring the idea. The studio helps find the path: from a sentence to an image,
          from a melody to a song, from a scene to a film, from a problem to a tool,
          from a strange feeling to something real.
        </p>
      </section>
    </div>
  );
}

function CareersApplicationForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setStatus('');
    if (message.trim().length < 8) {
      setError('Write at least 8 characters about your experience and interest.');
      return;
    }
    setBusy(true);
    const result = await submitPlatformForm('careers', {
      name,
      email,
      subject: role || 'Careers application',
      message: [portfolio ? `Portfolio: ${portfolio}` : null, message].filter(Boolean).join('\n\n'),
      source: 'careers-page',
    });
    if (!result.ok) {
      setError(result.message || result.data?.readableError || 'Could not send this application.');
      setBusy(false);
      return;
    }
    setStatus('Application received. We will review it and follow up by email.');
    setName('');
    setEmail('');
    setRole('');
    setPortfolio('');
    setMessage('');
    setBusy(false);
  };

  return (
    <>
      <form className="profile-login contact-form" onSubmit={handleSubmit}>
        <label>
          <span>Full name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
        </label>
        <label>
          <span>Role / specialty</span>
          <input value={role} onChange={(event) => setRole(event.target.value)} placeholder="Designer, developer, editor..." />
        </label>
        <label>
          <span>Portfolio or links</span>
          <input value={portfolio} onChange={(event) => setPortfolio(event.target.value)} placeholder="Website, reel, GitHub, Behance..." />
        </label>
        <label>
          <span>Why do you want to join?</span>
          <textarea
            className="studio-textarea"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Tell us about your experience and what you want to build with us..."
            rows={6}
            required
          />
        </label>
        <button type="submit" className="video-primary-button" disabled={busy || message.trim().length < 8}>
          {busy ? 'Sending...' : 'Submit application'}
        </button>
      </form>
      {status ? <p className="studio-async-note">{status}</p> : null}
      {error ? <p className="studio-error-note">{error}</p> : null}
    </>
  );
}

export default function InfoPage({ type = 'about' }) {
  const page = PAGES[type] || PAGES.about;

  return (
    <section className={`info-page ${page.isSubscription ? 'info-page--wide' : ''} ${page.hasAboutDetails ? 'info-page--about' : ''}`}>
      <p className="studio-rail-label">{page.eyebrow}</p>
      <h1 className="info-page-title">{page.title}</h1>
      <p className="info-page-body">{page.body}</p>

      {page.hasAboutDetails ? <AboutDetails /> : null}
      {page.isSubscription ? <SubscriptionDetails /> : null}
      {page.hasForm ? <CareersApplicationForm /> : null}

      {page.actions?.length ? (
        <div className="info-page-actions">
          {page.actions.map((action) => (
            <Link key={`${action.to}-${action.label}`} to={action.to} className="studio-action">
              [ {action.label} ]
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
