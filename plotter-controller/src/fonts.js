// fonts.js — пресеты шрифтов Google Fonts с кириллицей + генерация прямых URL .ttf
// opentype.js не понимает woff2, поэтому используем старые API Google Fonts (format=ttf),
// которые отдают прямые ссылки на static .ttf файлы.

export const FONT_PRESETS = [
  {
    name: 'Roboto',
    hintKey: 'font.Roboto',
    url: 'https://fonts.googleapis.com/css?family=Roboto:regular',
  },
  {
    name: 'Open Sans',
    hintKey: 'font.OpenSans',
    url: 'https://fonts.googleapis.com/css?family=Open+Sans:regular',
  },
  {
    name: 'Montserrat',
    hintKey: 'font.Montserrat',
    url: 'https://fonts.googleapis.com/css?family=Montserrat:regular',
  },
  {
    name: 'PT Sans',
    hintKey: 'font.PTSans',
    url: 'https://fonts.googleapis.com/css?family=PT+Sans:regular',
  },
  {
    name: 'Caveat',
    hintKey: 'font.Caveat',
    url: 'https://fonts.googleapis.com/css?family=Caveat:regular',
  },
  {
    name: 'Neucha',
    hintKey: 'font.Neucha',
    url: 'https://fonts.googleapis.com/css?family=Neucha:regular',
  },
  {
    name: 'Comfortaa',
    hintKey: 'font.Comfortaa',
    url: 'https://fonts.googleapis.com/css?family=Comfortaa:regular',
  },
  {
    name: 'Playfair Display',
    hintKey: 'font.Playfair',
    url: 'https://fonts.googleapis.com/css?family=Playfair+Display:regular',
  },
  {
    name: 'Fira Mono',
    hintKey: 'font.FiraMono',
    url: 'https://fonts.googleapis.com/css?family=Fira+Mono:regular',
  },
];

// Разрешение CSS-ссылки Google Fonts -> прямой URL полного TTF-файла.
// ВАЖНО: браузерный fetch отдаёт woff2-подмножества (в т.ч. только latin — без кириллицы),
// а «latin» TTF от Google тоже НЕ содержит русских букв. Поэтому разрешение выполняет
// сервер (он запрашивает CSS со старым User-Agent + subset=cyrillic,latin и получает
// единый полный TTF со всей кириллицей).
async function jreq(path, body) {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data;
}

export async function resolveFontUrl(cssUrl) {
  const { url } = await jreq('/resolve-font', { url: cssUrl });
  return url;
}

// Прямая проверка покрытия кириллицы в выбранном шрифте (по тексту пользователя)
export async function checkFontCoverage(fontUrl, text) {
  const { missing } = await jreq('/font-check', { url: fontUrl, text });
  return missing;
}
