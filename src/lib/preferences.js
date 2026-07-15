export const THEME_OPTIONS = [
  { id: 'atelier', label: 'Atelier Light' },
  { id: 'noir', label: 'Noir Glass' },
  { id: 'porcelain', label: 'Porcelain Glow' },
  { id: 'graphite', label: 'Graphite Film' },
  { id: 'ultraviolet', label: 'Ultraviolet' },
  { id: 'oxygen', label: 'Oxygen White' },
  { id: 'ember', label: 'Ember Cut' },
  { id: 'emerald', label: 'Emerald Lab' },
  { id: 'royal', label: 'Royal Blue' },
  { id: 'mono', label: 'Mono Editorial' },
];

export const LANGUAGE_OPTIONS = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'fr', label: 'French' },
  { id: 'it', label: 'Italian' },
  { id: 'de', label: 'German' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'zh-CN', label: 'Chinese' },
  { id: 'ar', label: 'Arabic' },
  { id: 'hi', label: 'Hindi' },
];

const THEME_KEY = 'slt-ui-theme';
const LANGUAGE_KEY = 'slt-ui-language';

export function storedTheme() {
  if (typeof window === 'undefined') return 'atelier';
  return window.localStorage.getItem(THEME_KEY) || 'atelier';
}

export function storedLanguage() {
  if (typeof window === 'undefined') return 'en';
  return window.localStorage.getItem(LANGUAGE_KEY) || 'en';
}

export function applyTheme(themeId = 'atelier') {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = themeId;
  window.localStorage.setItem(THEME_KEY, themeId);
}

export function applyLanguage(languageId = 'en') {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = languageId;
  window.localStorage.setItem(LANGUAGE_KEY, languageId);
}

export function openTranslatedPage(languageId) {
  if (typeof window === 'undefined' || !languageId || languageId === 'en') return;
  const target = new URL('https://translate.google.com/translate');
  target.searchParams.set('sl', 'auto');
  target.searchParams.set('tl', languageId);
  target.searchParams.set('u', window.location.href);
  window.open(target.toString(), '_blank', 'noopener,noreferrer');
}
