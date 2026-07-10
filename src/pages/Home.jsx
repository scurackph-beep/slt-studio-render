import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import './Home.css';

const NAV_ITEMS = [
  { label: 'HOME', target: 'hero' },
  { label: 'ABOUT', target: 'about' },
  { label: 'WORK', target: 'studios' },
  { label: 'SERVICES', target: 'services' },
  { label: 'JOURNAL', target: 'journal' },
  { label: 'CONTACT', target: 'contact' },
];

const STUDIO_SECTIONS = [
  { name: 'Video', path: '/video', desc: 'Film, motion, lipsync, storyboards' },
  { name: 'Music', path: '/music', desc: 'Tracks, stems, composition, mastering' },
  { name: 'Sound', path: '/sound', desc: 'Voice, foley, ambience, repair' },
  { name: 'Image', path: '/image', desc: 'Avatars, campaigns, edit, upscale' },
  { name: 'Fashion', path: '/fashion', desc: 'Looks, textiles, runway, try-on' },
  { name: 'Engineering', path: '/engineering', desc: 'Apps, automation, tools' },
  { name: 'CEO', path: '/ceo', desc: 'Admin, analytics, operations' },
];

const SERVICE_ITEMS = [
  { title: 'Film systems', copy: 'Concept, script, shot planning and AI video workflows.' },
  { title: 'Sonic identity', copy: 'Music, voice, foley, ambience and mastering tools.' },
  { title: 'Visual worlds', copy: 'Images, fashion, campaigns, references and brand atmospheres.' },
  { title: 'Engineering', copy: 'Apps, dashboards, automations and custom creative tools.' },
];

const ABOUT_ITEMS = [
  { index: '01', title: 'Story-first', copy: 'Every tool starts with mood, memory, voice and emotional direction.' },
  { index: '02', title: 'AI-assisted', copy: 'Providers are treated like instruments, not replacements for taste.' },
  { index: '03', title: 'Built to ship', copy: 'Studios route into actual workspaces instead of dead marketing links.' },
];

const JOURNAL_NOTES = [
  { title: 'Studio memo', copy: 'The interface should feel like entering a creative garage, not a static landing page.' },
  { title: 'Current build', copy: 'Studios connect to the backend proxy. Generation runs through /api/generate routes.' },
  { title: 'Next layer', copy: 'Wire provider selection, job polling and project storage across all studios.' },
];

const DISCIPLINES = ['Film', 'Photography', 'Motion', 'Design', 'Narrative'];

export default function Home() {
  const navigate = useNavigate();
  const [activeNav, setActiveNav] = useState('HOME');

  const scrollToSection = (target, label = target.toUpperCase()) => {
    setActiveNav(label);
    const element = document.getElementById(target);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    const handleScroll = () => {
      const current = NAV_ITEMS.findLast?.((item) => {
        const element = document.getElementById(item.target);
        return element && element.getBoundingClientRect().top <= 140;
      });

      if (current) {
        setActiveNav(current.label);
      }
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="home">
      <Navbar
        links={NAV_ITEMS}
        activeId={activeNav}
        mode="scroll"
        onNavigate={(link) => scrollToSection(link.target, link.label)}
      />

      <section className="hero" id="hero">
        <div className="hero-inner">
          <h1 className="hero-headline">
            Stories that stay.
          </h1>
          <p className="hero-lead">
            A creative operating system for film, music, image, sound and engineering —
            built to feel human before it feels polished.
          </p>
          <button
            type="button"
            className="text-link hero-cta"
            onClick={() => scrollToSection('studios', 'WORK')}
          >
            Enter the studio
          </button>
        </div>

        <ul className="hero-disciplines" aria-label="Disciplines">
          {DISCIPLINES.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="home-section" id="about">
        <p className="section-kicker">About</p>
        <h2 className="section-title">A studio for emotional technology.</h2>
        <p className="section-body">
          Sweet Little Trauma Studio is a creative operating system for stories, music, images, video,
          apps and experiments that need to feel human before they feel polished.
        </p>
        <div className="text-grid text-grid--3">
          {ABOUT_ITEMS.map((item) => (
            <article className="text-cell" key={item.index}>
              <span className="text-cell-index">{item.index}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section" id="studios">
        <p className="section-kicker">Work</p>
        <h2 className="section-title">Choose your space.</h2>
        <p className="section-body section-body--left">
          Video, music, sound, image, engineering — each studio opens into a working environment.
        </p>
        <div className="text-grid text-grid--studios">
          {STUDIO_SECTIONS.map((studio) => (
            <button
              key={studio.path}
              type="button"
              className="studio-link"
              onClick={() => navigate(studio.path)}
            >
              <span className="studio-link-name">{studio.name}</span>
              <span className="studio-link-desc">{studio.desc}</span>
              <span className="studio-link-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>

      <section className="home-section" id="services">
        <p className="section-kicker">Services</p>
        <h2 className="section-title">Creative systems, not loose buttons.</h2>
        <div className="text-grid text-grid--4">
          {SERVICE_ITEMS.map((item) => (
            <article className="text-cell" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section home-section--media" id="media">
        <p className="section-kicker">Reference</p>
        <h2 className="section-title">Visual atmosphere.</h2>
        <div className="media-grid">
          <figure className="media-placeholder">
            <div className="media-placeholder-inner" aria-hidden="true" />
            <figcaption>Studio still — placeholder</figcaption>
          </figure>
          <figure className="media-placeholder">
            <div className="media-placeholder-inner" aria-hidden="true" />
            <figcaption>Motion frame — placeholder</figcaption>
          </figure>
        </div>
      </section>

      <section className="home-section" id="journal">
        <p className="section-kicker">Journal</p>
        <h2 className="section-title">Studio notes.</h2>
        <ul className="journal-list">
          {JOURNAL_NOTES.map((note) => (
            <li className="journal-entry" key={note.title}>
              <span className="journal-entry-title">{note.title}</span>
              <span className="journal-entry-copy">{note.copy}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-section home-section--contact" id="contact">
        <div>
          <p className="section-kicker">Contact</p>
          <h2 className="section-title">Ready when the story is.</h2>
          <p className="section-body section-body--left">
            Enter a studio from the work grid, or use this page as the public front door.
          </p>
        </div>
        <div className="contact-links">
          <button type="button" className="text-link" onClick={() => scrollToSection('studios', 'WORK')}>
            Open the garage →
          </button>
          <button type="button" className="text-link text-link--muted" onClick={() => navigate('/ceo')}>
            CEO dashboard →
          </button>
        </div>
      </section>
    </div>
  );
}
