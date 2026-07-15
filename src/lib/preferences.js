export const THEME_OPTIONS = [
  { id: 'garage', label: 'Garage Future' },
  { id: 'dark-core', label: 'Dark Core' },
  { id: 'white-porcelain', label: 'White Porcelain' },
  { id: 'argentina', label: 'Argentina' },
  { id: 'pop-art', label: 'Pop Art' },
  { id: 'bangkok', label: 'Bangkok Neon' },
  { id: 'fifa-2026', label: 'FIFA 2026' },
  { id: 'parravicini', label: 'Parravicini' },
  { id: 'tango-noir', label: 'Tango Noir' },
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
  if (typeof window === 'undefined') return 'garage';
  const savedTheme = window.localStorage.getItem(THEME_KEY);
  if (THEME_OPTIONS.some((option) => option.id === savedTheme)) return savedTheme;
  return 'garage';
}

export function storedLanguage() {
  if (typeof window === 'undefined') return 'en';
  return window.localStorage.getItem(LANGUAGE_KEY) || 'en';
}

export function applyTheme(themeId = 'garage') {
  if (typeof document === 'undefined') return;
  const nextTheme = THEME_OPTIONS.some((option) => option.id === themeId) ? themeId : 'garage';
  document.documentElement.dataset.theme = nextTheme;
  window.localStorage.setItem(THEME_KEY, nextTheme);
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
