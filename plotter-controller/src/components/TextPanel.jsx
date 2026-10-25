import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { FONT_PRESETS, resolveFontUrl } from '../fonts.js';
import { useLang } from '../i18n.js';

const PAGE_FORMATS = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] };

export default function TextPanel({ options, setOptions, onConvert, busy }) {
  const { t } = useLang();
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
  const [renderMode, setRenderMode] = useState('outline'); // 'outline' | 'solid' | 'hatch'
  // Ручная позиция начала текста: левый-верхний угол блока на столе, мм (X вправо, Y вверх от нуля стола).
  // null = авто (по умолчанию — левый верхний угол листа с учётом полей).
  const [startX, setStartX] = useState('');
  const [startY, setStartY] = useState('');
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

  const buildPayloadOptions = () => {
    const opts = {
      ...options,
      markdown, fontSize, lineHeight, align,
      pageFormat, orientation, textMargin, renderMode,
      plotWidth: options.plotWidth, plotHeight: options.plotHeight,
    };
    // ручная позиция старта (левый-верхний угол текста на столе); пусто = авто (угол листа)
    const sx = parseFloat(String(startX).replace(',', '.'));
    const sy = parseFloat(String(startY).replace(',', '.'));
    if (Number.isFinite(sx)) opts.offsetX = Math.max(0, Math.min(options.plotWidth, sx));
    if (Number.isFinite(sy)) opts.offsetY = Math.max(0, Math.min(options.plotHeight, sy));
    // offsetX/offsetY действуют только парой — если задан только один, сбрасываем оба в авто
    if (!(Number.isFinite(sx) && Number.isFinite(sy))) { delete opts.offsetX; delete opts.offsetY; }
    return opts;
  };

  // Перетаскивание текста мышью: сохраняем контекст, App будет перегенерировать G-code с новой позицией
  const convert = async () => {
    if (!text.trim() || !resolvedUrl) return;
    const opts = buildPayloadOptions();
    const out = await api.textToGcode(text, resolvedUrl, opts);
    onConvert({
      textResult: out, plotWidth: options.plotWidth, plotHeight: options.plotHeight,
      textPayload: { text, fontUrl: resolvedUrl, options: opts },
    });
  };

  // Актуальный payload для перетаскивания (обновляется при изменении настроек текста)
  useEffect(() => {
    if (text.trim() && resolvedUrl && typeof setTextCtx === 'function') {
      setTextCtx((prev) => prev ? { text, fontUrl: resolvedUrl, options: buildPayloadOptions() } : prev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, resolvedUrl, markdown, fontSize, lineHeight, align, pageFormat, orientation, textMargin, renderMode, startX, startY]);

  const disabled = busy || fontBusy || !text.trim() || !resolvedUrl || !!fontError;

  return (
    <div className="panel">
      <h2>{t('text.title')}</h2>

      <textarea
        className="text-input"
        rows={6}
        placeholder={markdown ? t('text.placeholderMd') : t('text.placeholder')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row check" style={{ marginTop: 4 }}>
        <input id="md" type="checkbox" checked={markdown} onChange={(e) => setMarkdown(e.target.checked)} />
        <label htmlFor="md">{t('text.mdLabel')}</label>
        <button className="small" onClick={() => fileRef.current.click()}>{t('text.upload')}</button>
        <input ref={fileRef} type="file" accept=".txt,.md,.markdown" style={{ display: 'none' }}
          onChange={(e) => readFile(e.target.files[0])} />
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <label className="field">{t('text.font')}
          <select value={fontSel} onChange={(e) => setFontSel(e.target.value)}>
            {FONT_PRESETS.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            <option value="__custom">{t('text.customOption')}</option>
          </select>
        </label>
      </div>
      {!isCustom && <div className="hint">{t(FONT_PRESETS.find((f) => f.name === fontSel)?.hintKey)}</div>}
      {isCustom && (
        <input
          className="text-input mono"
          rows={1}
          style={{ minHeight: 30 }}
          placeholder={t('text.customPlaceholder')}
          value={customFontUrl}
          onChange={(e) => setCustomFontUrl(e.target.value)}
        />
      )}
      <div className="hint">
        {fontBusy && t('text.loadingFont')}
        {!fontBusy && fontError && <span style={{ color: 'var(--red)' }}>{fontError}</span>}
        {!fontBusy && fontInfo && (
          <span style={{ color: 'var(--green)' }}>
            ✓ {fontInfo.family} · {t('text.glyphs')} {fontInfo.glyphs}{' '}
            {fontInfo.hasCyrillic ? t('text.hasCyrillic') : t('text.noCyrillic')}
            {missingChars.length > 0 && <span style={{ color: 'var(--orange)' }}> {t('text.missingGlyphs', { chars: missingChars.slice(0, 12).join(' ') })}</span>}
          </span>
        )}
      </div>

      <div className="row">
        <label className="field">{t('text.size')}
          <input type="number" min={4} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
        </label>
        <label className="field">{t('text.lineHeight')}
          <input type="number" step={0.05} min={0.8} max={3} value={lineHeight} onChange={(e) => setLineHeight(Number(e.target.value))} />
        </label>
        <label className="field">{t('text.align')}
          <select value={align} onChange={(e) => setAlign(e.target.value)}>
            <option value="left">{t('text.alignLeft')}</option>
            <option value="center">{t('text.alignCenter')}</option>
            <option value="right">{t('text.alignRight')}</option>
          </select>
        </label>
      </div>

      <div className="row">
        <label className="field">{t('text.paper')}
          <select value={pageFormat} onChange={(e) => setPageFormat(e.target.value)}>
            <option>A4 (210×297)</option>
            <option>A5 (148×210)</option>
            <option>Letter (216×279)</option>
          </select>
        </label>
        <label className="field">{t('text.orientation')}
          <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
            <option value="portrait">{t('text.portrait')}</option>
            <option value="landscape">{t('text.landscape')}</option>
          </select>
        </label>
        <label className="field">{t('text.margin')}
          <input type="number" min={2} max={40} value={textMargin} onChange={(e) => setTextMargin(Number(e.target.value))} />
        </label>
      </div>

      <div className="hint">
        {t('text.paperInfo', { w: paper.w.toFixed(0), h: paper.h.toFixed(0) })}{' '}
        {paper.clipped && <span style={{ color: 'var(--orange)' }}>{t('text.clipped')}</span>}
        {' '}{t('text.workArea', { w: options.plotWidth, h: options.plotHeight })}
      </div>

      <div className="row" style={{ marginTop: 4, alignItems: 'flex-end' }}>
        <label className="field">{t('text.startX')}
          <input type="number" min={0} max={options.plotWidth} step={1} value={startX} placeholder="auto"
            onChange={(e) => setStartX(e.target.value)} />
        </label>
        <label className="field">{t('text.startY')}
          <input type="number" min={0} max={options.plotHeight} step={1} value={startY} placeholder="auto"
            onChange={(e) => setStartY(e.target.value)} />
        </label>
        {(startX !== '' || startY !== '') && (
          <button className="small" title={t('text.startResetTitle')}
            onClick={() => { setStartX(''); setStartY(''); }}>⌜ {t('text.startReset')}</button>
        )}
      </div>
      <div className="hint">{t('text.startHint')}</div>

      <div className="row" style={{ marginTop: 8 }}>
        <label className="field">{t('text.renderMode')}
          <select value={renderMode} onChange={(e) => setRenderMode(e.target.value)}>
            <option value="outline">{t('text.modeOutline')}</option>
            <option value="handwrite">{t('text.modeHandwrite')}</option>
            <option value="solid">{t('text.modeSolid')}</option>
            <option value="hatch">{t('text.modeHatch')}</option>
          </select>
        </label>
      </div>
      <div className="hint">{t('text.renderHint')}</div>

      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" onClick={convert} disabled={disabled}>{t('text.convert')}</button>
      </div>
    </div>
  );
}
