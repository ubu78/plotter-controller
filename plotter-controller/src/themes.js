// themes.js — переключатель дизайна: тёмная тема, светлая тема и «Сканер» (фирменный стиль
// оригинального Processing-скетча Scalable Pen Plotter: зелёный фон, оранжевый пером-кружок).
// Каждая тема задаёт CSS-переменные; применяются через applyTheme() на <html>.

export const THEMES = [
  { code: 'dark',   label: 'Тёмная / Dark / Tume' },
  { code: 'light',  label: 'Светлая / Light / Hele' },
  { code: 'scanner',label: 'Сканер / Scanner / Skänner' },
];

const vars = (o) => ({
  '--bg': o.bg,
  '--panel': o.panel,
  '--panel2': o.panel2,
  '--border': o.border,
  '--text': o.text,
  '--muted': o.muted,
  '--accent': o.accent,
  '--green': o.green,
  '--red': o.red,
  '--yellow': o.yellow,
  '--orange': o.orange,
  '--bed': o.bed,            // лист/стол в превью
  '--bed-stroke': o.bedStroke,
  '--grid': o.grid,          // линии сетки
  '--canvas-bg': o.canvasBg, // фон области превью
  '--console-bg': o.consoleBg,
  '--primary-bg': o.primaryBg,
  '--primary-fg': o.primaryFg,
  '--danger-bg': o.dangerBg,
  '--danger-border': o.dangerBorder,
  '--danger-fg': o.dangerFg,
  '--exit-bg': o.exitBg,
  '--exit-border': o.exitBorder,
  '--exit-fg': o.exitFg,
  '--input-bg': o.inputBg ?? o.panel2,
  '--sel-border': o.selBorder ?? o.accent,
});

export const THEME_VARS = {
  dark: vars({
    bg: '#14171c', panel: '#1d2229', panel2: '#232a33', border: '#313a45',
    text: '#dfe6ee', muted: '#8b98a8', accent: '#38bdf8', green: '#34d399',
    red: '#f87171', yellow: '#fbbf24', orange: '#fb923c',
    bed: '#1a1f26', bedStroke: '#3a4654', grid: '#243040',
    canvasBg: '#0c0f13', consoleBg: '#0c0f13',
    primaryBg: '#0e7490', primaryFg: '#fff',
    dangerBg: '#7f1d1d', dangerBorder: '#991b1b', dangerFg: '#fff',
    exitBg: '#292524', exitBorder: '#57534e', exitFg: '#d6d3d1',
  }),
  light: vars({
    bg: '#eef2f6', panel: '#ffffff', panel2: '#f1f5f9', border: '#cbd5e1',
    text: '#0f172a', muted: '#64748b', accent: '#0284c7', green: '#059669',
    red: '#dc2626', yellow: '#b45309', orange: '#ea580c',
    bed: '#ffffff', bedStroke: '#94a3b8', grid: '#e2e8f0',
    canvasBg: '#dbe3ec', consoleBg: '#f8fafc',
    primaryBg: '#0284c7', primaryFg: '#fff',
    dangerBg: '#dc2626', dangerBorder: '#b91c1c', dangerFg: '#fff',
    exitBg: '#e2e8f0', exitBorder: '#94a3b8', exitFg: '#334155',
    inputBg: '#ffffff', selBorder: '#0284c7',
  }),
  scanner: vars({
    bg: '#0b3d1f', panel: '#0e4d27', panel2: '#126031', border: '#2e8b57',
    text: '#eafbe7', muted: '#9fd3ae', accent: '#ffb347', green: '#7CFC9B',
    red: '#ff8a80', yellow: '#ffd166', orange: '#ff9f1c',
    bed: '#f5efdc', bedStroke: '#ffb347', grid: '#ddd3b8',
    canvasBg: '#083118', consoleBg: '#072c15',
    primaryBg: '#ff9f1c', primaryFg: '#1a1a1a',
    dangerBg: '#b3402e', dangerBorder: '#d9534f', dangerFg: '#fff',
    exitBg: '#126031', exitBorder: '#2e8b57', exitFg: '#eafbe7',
    inputBg: '#0a3f20', selBorder: '#ffb347',
  }),
};

export function getTheme() {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('plotter-theme') : null;
  return ['dark', 'light', 'scanner'].includes(saved) ? saved : 'dark';
}

export function setTheme(code) {
  try { localStorage.setItem('plotter-theme', code); } catch (e) { /* ignore */ }
}

export function applyTheme(code) {
  const root = document.documentElement;
  const v = THEME_VARS[code] || THEME_VARS.dark;
  for (const [k, val] of Object.entries(v)) root.style.setProperty(k, val);
  root.dataset.theme = code;
}
