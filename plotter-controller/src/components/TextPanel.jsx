import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { FONT_PRESETS, resolveFontUrl } from '../fonts.js';

const PAGE_FORMATS = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] };

export default function TextPanel({ options, setOptions, onConvert, busy }) {
  const [text, setText] = useState('');
  const [markdown, setMarkdown] = useState(true);
  const [fontSel, setFontSel] = useState(FONT_PRESETS[0].name);
  const [customFontUrl, setCustomFontUrl] = useState('');
  const [resolvedUrl, setResolvedUrl] = useState(null); // прямой TTF URL для отправки на сервер
  const [fontInfo, setFontInfo] = useState(null);      // {family, hasCyrillic}
  const [missingChars, setMissingChars] = useState([]); // символы текста, отсутствующие в шрифте
  const [fontBusy, setFontBusy] = useState(false);
  const [fontError, setFontError] = useState('');
  const [fontSize, setFontSize] = useState(12);
  const [lineHeight, setLineHeight] = useState(1.4);
  const [align, setAlign] = useState('left');
  const [pageFormat, setPageFormat] = useState('A4');
  const [orientation, setOrientation] = useState('portrait');
  const [textMargin, setTextMargin] = useState(12);
  const fileRef = useRef(null);

  const isCustom = fontSel === '__custom';

  // Разрешаем URL шрифта (пресет или пользовательская ссылка) при изменении выбора
  useEffect(() => {
    let alive = true;
    setResolvedUrl(null); setFontInfo(null); setFontError('');
    const src = isCustom ? customFontUrl.trim() : FONT_PRESETS.find((f) => f.name === fontSel)?.url;
    if (!src) return;
    setFontBusy(true);
    (async () => {
      try {
        const direct = /^https?:\/\/[^"]+\.(ttf|otf)(\?|$)/i.test(src) ? src : await resolveFontUrl(src);
        if (!alive) return;
        setResolvedUrl(direct);
        const info = await api.fontCheck(direct, text);
        if (alive) { setFontInfo(info); setMissingChars(info.missing || []); }
      } catch (e) {
        if (alive) setFontError(e.message);
      }
      if (alive) setFontBusy(false);
    })();
    return () => { alive = false; };
  }, [fontSel, customFontUrl, isCustom]);

  // При изменении текста пере-проверяем покрытие шрифта (с небольшой задержкой)
  useEffect(() => {
    if (!resolvedUrl) return;
    const t = setTimeout(async () => {
      try {
        const info = await api.fontCheck(resolvedUrl, text);
        setFontInfo(info);
        setMissingChars(info.missing || []);
      } catch (e) { /* оставляем предыдущее состояние */ }
    }, 500);
    return () => clearTimeout(t);
  }, [text, resolvedUrl]);

  const paper = useMemo(() => {
    const f = PAGE_FORMATS[pageFormat] || PAGE_FORMATS.A4;
    let [w, h] = f;
    if (orientation === 'landscape') [w, h] = [h, w];
    // ограничение размерами стола
    const maxW = options.plotWidth, maxH = options.plotHeight;
    const clipped = w > maxW || h > maxH;
    return { w: Math.min(w, maxW), h: Math.min(h, maxH), clipped };
  }, [pageFormat, orientation, options.plotWidth, options.plotHeight]);

  const readFile = (file) => {
    if (!file) return;
    file.text().then((t) => {
      setText(t);
      if (/\.(md|markdown)$/i.test(file.name)) setMarkdown(true);
      else if (/\.txt$/i.test(file.name)) setMarkdown(false);
    });
  };

  const convert = async () => {
    if (!text.trim() || !resolvedUrl) return;
    const opts = {
      ...options,
      markdown, fontSize, lineHeight, align,
      pageFormat, orientation, textMargin,
      plotWidth: options.plotWidth, plotHeight: options.plotHeight,
    };
    const out = await api.textToGcode(text, resolvedUrl, opts);
    onConvert({ textResult: out, plotWidth: options.plotWidth, plotHeight: options.plotHeight });
  };

  const disabled = busy || fontBusy || !text.trim() || !resolvedUrl || !!fontError;

  return (
    <div className="panel">
      <h2>Текст / Markdown → G-code</h2>

      <textarea
        className="text-input"
        rows={6}
        placeholder={markdown ? 'Вставьте текст или Markdown… Supports # заголовки, **жирный**, - списки' : 'Вставьте текст…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row check" style={{ marginTop: 4 }}>
        <input id="md" type="checkbox" checked={markdown} onChange={(e) => setMarkdown(e.target.checked)} />
        <label htmlFor="md">Markdown (# заголовки, списки, код)</label>
        <button className="small" onClick={() => fileRef.current.click()}>Загрузить .txt/.md</button>
        <input ref={fileRef} type="file" accept=".txt,.md,.markdown" style={{ display: 'none' }}
          onChange={(e) => readFile(e.target.files[0])} />
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <label className="field">Шрифт (Google Fonts)
          <select value={fontSel} onChange={(e) => setFontSel(e.target.value)}>
            {FONT_PRESETS.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            <option value="__custom">Своя ссылка…</option>
          </select>
        </label>
      </div>
      {!isCustom && <div className="hint">{FONT_PRESETS.find((f) => f.name === fontSel)?.hint}</div>}
      {isCustom && (
        <input
          className="text-input mono"
          rows={1}
          style={{ minHeight: 30 }}
          placeholder="https://fonts.google.com/... или прямая ссылка на .ttf"
          value={customFontUrl}
          onChange={(e) => setCustomFontUrl(e.target.value)}
        />
      )}
      <div className="hint">
        {fontBusy && 'Загрузка шрифта…'}
        {!fontBusy && fontError && <span style={{ color: 'var(--red)' }}>{fontError}</span>}
        {!fontBusy && fontInfo && (
          <span style={{ color: 'var(--green)' }}>
            ✓ {fontInfo.family} · глифов: {fontInfo.glyphs}{fontInfo.hasCyrillic ? ' · кириллица есть' : ' · ⚠ кириллицы нет!'}
            {missingChars.length > 0 && <span style={{ color: 'var(--orange)' }}> · ⚠ нет глифов для: {missingChars.slice(0, 12).join(' ')}</span>}
          </span>
        )}
      </div>

      <div className="row">
        <label className="field">Кегль, pt
          <input type="number" min={4} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
        </label>
        <label className="field">Интерлиньяж
          <input type="number" step={0.05} min={0.8} max={3} value={lineHeight} onChange={(e) => setLineHeight(Number(e.target.value))} />
        </label>
        <label className="field">Выравнивание
          <select value={align} onChange={(e) => setAlign(e.target.value)}>
            <option value="left">слева</option>
            <option value="center">по центру</option>
            <option value="right">справа</option>
          </select>
        </label>
      </div>

      <div className="row">
        <label className="field">Бумага
          <select value={pageFormat} onChange={(e) => setPageFormat(e.target.value)}>
            <option>A4 (210×297)</option>
            <option>A5 (148×210)</option>
            <option>Letter (216×279)</option>
          </select>
        </label>
        <label className="field">Ориентация
          <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
            <option value="portrait">книжная</option>
            <option value="landscape">альбомная</option>
          </select>
        </label>
        <label className="field">Поля текста, мм
          <input type="number" min={2} max={40} value={textMargin} onChange={(e) => setTextMargin(Number(e.target.value))} />
        </label>
      </div>

      <div className="hint">
        Бумага {paper.w.toFixed(0)}×{paper.h.toFixed(0)} мм
        {paper.clipped && <span style={{ color: 'var(--orange)' }}> — урезана до рабочего поля плоттера!</span>}
        {' '}· Рабочее поле: {options.plotWidth}×{options.plotHeight} мм (максимум A4)
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" onClick={convert} disabled={disabled}>Конвертировать текст</button>
      </div>
    </div>
  );
}
