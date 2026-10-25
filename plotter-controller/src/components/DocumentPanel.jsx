import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { FONT_PRESETS, resolveFontUrl } from '../fonts.js';
import { useLang } from '../i18n.js';

const PAGE_FORMATS = { A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4] };
const ACCEPT = '.pdf,.docx,.txt,.md,.markdown';

// Считываем файл в base64 (без префикса data:)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('READ_ERROR'));
    r.readAsDataURL(file);
  });
}

export default function DocumentPanel({ options, setOptions, onConvert, busy }) {
  const { t } = useLang();
  const [file, setFile] = useState(null);
  const [fontSel, setFontSel] = useState(FONT_PRESETS[0].name);
  const [resolvedUrl, setResolvedUrl] = useState(null);
  const [fontInfo, setFontInfo] = useState(null);
  const [fontBusy, setFontBusy] = useState(false);
  const [fontError, setFontError] = useState('');
  const [fontSize, setFontSize] = useState(12);
  const [lineHeight, setLineHeight] = useState(1.4);
  const [align, setAlign] = useState('left');
  const [pageFormat, setPageFormat] = useState('A4');
  const [orientation, setOrientation] = useState('portrait');
  const [textMargin, setTextMargin] = useState(12);
  const [preserveLayout, setPreserveLayout] = useState(true);
  const [autoFit, setAutoFit] = useState(true);
  const [renderMode, setRenderMode] = useState('outline'); // 'outline' | 'solid' | 'hatch'
  const [localError, setLocalError] = useState('');
  const fileRef = useRef(null);

  // Разрешение URL шрифта — как в TextPanel
  useEffect(() => {
    let alive = true;
    setResolvedUrl(null); setFontInfo(null); setFontError('');
    const src = FONT_PRESETS.find((f) => f.name === fontSel)?.url;
    if (!src) return;
    setFontBusy(true);
    (async () => {
      try {
        const direct = /^https?:\/\/[^"]+\.(ttf|otf)(\?|$)/i.test(src) ? src : await resolveFontUrl(src);
        if (!alive) return;
        setResolvedUrl(direct);
        const info = await api.fontCheck(direct, 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя');
        if (alive) setFontInfo(info);
      } catch (e) {
        if (alive) setFontError(e.message);
      }
      if (alive) setFontBusy(false);
    })();
    return () => { alive = false; };
  }, [fontSel]);

  const paper = (() => {
    const f = PAGE_FORMATS[pageFormat] || PAGE_FORMATS.A4;
    let [w, h] = f;
    if (orientation === 'landscape') [w, h] = [h, w];
    const clipped = w > options.plotWidth || h > options.plotHeight;
    return { w: Math.min(w, options.plotWidth), h: Math.min(h, options.plotHeight), clipped };
  })();

  const pickFile = (f) => {
    setLocalError('');
    if (!f) return;
    if (!/\.(pdf|docx|txt|md|markdown)$/i.test(f.name)) {
      setLocalError(t('doc.badType'));
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setLocalError(t('doc.tooBig'));
      return;
    }
    setFile(f);
  };

  const convert = async () => {
    setLocalError('');
    if (!file || !resolvedUrl) return;
    try {
      const fileBase64 = await fileToBase64(file);
      const opts = {
        ...options,
        markdown: /\.(md|markdown)$/i.test(file.name),
        fontSize, lineHeight, align,
        pageFormat, orientation, textMargin,
        preserveLayout, autoFit, renderMode,
        plotWidth: options.plotWidth, plotHeight: options.plotHeight,
      };
      const out = await api.documentToGcode({ fileBase64, fileName: file.name, fontUrl: resolvedUrl, options: opts });
      onConvert({
        docResult: out, plotWidth: options.plotWidth, plotHeight: options.plotHeight,
        // payload для перетаскивания мышью (без позиции — сервер сам поставит в левый-верхний угол)
        docPayload: { fileBase64, fileName: file.name, fontUrl: resolvedUrl, options: opts },
      });
    } catch (e) {
      setLocalError(e.message === 'READ_ERROR' ? t('doc.readError') : e.message);
    }
  };

  const disabled = busy || fontBusy || !file || !resolvedUrl || !!fontError;

  return (
    <div className="panel">
      <h2>{t('doc.title')}</h2>

      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <button onClick={() => fileRef.current.click()}>{t('doc.pick')}</button>
        <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : t('doc.noFile')}
        </span>
        <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: 'none' }}
          onChange={(e) => pickFile(e.target.files[0])} />
      </div>
      {file && (
        <div className="hint" style={{ marginTop: 4 }}>
          {t('doc.hintPdf')}
        </div>
      )}
      {localError && <div className="hint" style={{ color: 'var(--red)' }}>{localError}</div>}

      <div className="row" style={{ marginTop: 8 }}>
        <label className="field">{t('text.font')}
          <select value={fontSel} onChange={(e) => setFontSel(e.target.value)}>
            {FONT_PRESETS.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
        </label>
      </div>
      <div className="hint">
        {fontBusy && t('text.loadingFont')}
        {!fontBusy && fontError && <span style={{ color: 'var(--red)' }}>{fontError}</span>}
        {!fontBusy && fontInfo && (
          <span style={{ color: 'var(--green)' }}>
            ✓ {fontInfo.family}{' '}{fontInfo.hasCyrillic ? t('text.hasCyrillic') : t('text.noCyrillic')}
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
        <label className="field">{t('doc.margins')}
          <input type="number" min={2} max={40} value={textMargin} onChange={(e) => setTextMargin(Number(e.target.value))} />
        </label>
      </div>

      <div className="row check">
        <input id="doc-preserve" type="checkbox" checked={preserveLayout} onChange={(e) => setPreserveLayout(e.target.checked)} />
        <label htmlFor="doc-preserve">{t('doc.preserve')}</label>
      </div>
      <div className="row check">
        <input id="doc-autofit" type="checkbox" checked={autoFit} onChange={(e) => setAutoFit(e.target.checked)} />
        <label htmlFor="doc-autofit">{t('doc.autoFit')}</label>
      </div>

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

      <div className="hint">
        {t('text.paperInfo', { w: paper.w.toFixed(0), h: paper.h.toFixed(0) })}{' '}
        {paper.clipped && <span style={{ color: 'var(--orange)' }}>{t('text.clipped')}</span>}
        {' '}{t('text.workArea', { w: options.plotWidth, h: options.plotHeight })}
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <button className="primary" onClick={convert} disabled={disabled}>
          {busy ? t('doc.converting') : t('doc.convert')}
        </button>
      </div>
    </div>
  );
}
