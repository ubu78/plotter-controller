// SettingsPanel.jsx — панель настройки $-параметров GRBL 1.1
// Справочные данные: https://github.com/gnea/grbl/wiki (Grbl v1.1 Configuration Settings)
import React, { useEffect, useMemo, useState } from 'react';
import { useLang } from '../i18n.js';

const CATS = [
  { key: 'basic', ids: [0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13] },
  { key: 'limits', ids: [20, 21, 22, 23, 24, 25, 26, 27, 30, 31, 32] },
  { key: 'motion', ids: [100, 101, 102, 110, 111, 112, 120, 121, 122, 130, 131, 132] },
];

// Рекомендуемый пресет для Scalable Pen Plotter (GT2 ремень, шкив 20T, A4988 1/16)
const PLOTTER_PRESET = {
  11: 0.01, 20: 0, 100: 200, 101: 200, 110: 3000, 111: 3000, 112: 1000,
  120: 20, 121: 20, 122: 10, 130: 210, 131: 297,
};

export default function SettingsPanel({ connected }) {
  const { t, lang } = useLang();
  const [defs, setDefs] = useState([]);
  const [notes, setNotes] = useState({});
  const [current, setCurrent] = useState(null); // {id: value}
  const [draft, setDraft] = useState({});       // изменённые значения
  const [cat, setCat] = useState('motion');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/settings/defs').then((r) => r.json())
      .then((d) => { setDefs(d.defs || []); setNotes(d.notes || {}); })
      .catch(() => {});
  }, []);

  const read = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/settings');
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      const map = {};
      (d.settings || []).forEach((s) => { map[s.id] = s.value; });
      setCurrent(map);
      setDraft({});
      setMsg(t('settings.readOk', { n: Object.keys(map).length }));
    } catch (e) { setMsg(String(e.message || e)); }
    setBusy(false);
  };

  const writeOne = async (id) => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/settings/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value: draft[id] }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setCurrent((c) => ({ ...c, [id]: Number(draft[id]) }));
      setDraft((dr) => { const n = { ...dr }; delete n[id]; return n; });
      setMsg(t('settings.written', { cmd: d.cmd }));
    } catch (e) { setMsg(String(e.message || e)); }
    setBusy(false);
  };

  const applyChanges = async (changes, label) => {
    if (!changes.length) return;
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/settings/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMsg(label + ': ' + d.applied);
      await read();
    } catch (e) { setMsg(String(e.message || e)); }
    setBusy(false);
  };

  const applyPreset = () => {
    const cur = current || {};
    const changes = Object.entries(PLOTTER_PRESET)
      .filter(([id, v]) => cur[id] === undefined || cur[id] !== v)
      .map(([id, v]) => ({ id: Number(id), value: v }));
    applyChanges(changes, t('settings.preset'));
  };

  const restoreDefaults = () => {
    if (!window.confirm(t('settings.restoreConfirm'))) return;
    const changes = defs.map((d) => ({ id: d.id, value: d.def }));
    applyChanges(changes, t('settings.defaults'));
  };

  const catIds = useMemo(() => new Set(CATS.find((c) => c.key === cat).ids), [cat]);
  const shown = defs.filter((d) => catIds.has(d.id));
  const dirtyCount = Object.keys(draft).length;

  return (
    <div className="panel">
      <h2>{t('settings.title')}</h2>
      <p className="hint">{t('settings.hint')}</p>

      <div className="row" style={{ marginBottom: 8 }}>
        <button onClick={read} disabled={!connected || busy}>{t('settings.read')}</button>
        <button onClick={applyPreset} disabled={!connected || busy || !current}>{t('settings.applyPreset')}</button>
        <button className="danger" onClick={restoreDefaults} disabled={!connected || busy}>{t('settings.restore')}</button>
      </div>

      <div className="tabs">
        {CATS.map((c) => (
          <button key={c.key} className={'tab' + (cat === c.key ? ' active' : '')}
                  onClick={() => setCat(c.key)}>{t('settings.cat.' + c.key)}</button>
        ))}
      </div>

      <table className="settings-table">
        <thead>
          <tr>
            <th>$</th><th>{t('settings.col.name')}</th><th>{t('settings.col.current')}</th>
            <th>{t('settings.col.new')}</th><th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((d) => {
            const cur = current ? current[d.id] : undefined;
            const dv = draft[d.id] !== undefined ? draft[d.id] : (cur !== undefined ? cur : d.def);
            const changed = draft[d.id] !== undefined && Number(draft[d.id]) !== cur;
            const note = notes[d.id];
            return (
              <tr key={d.id} className={changed ? 'changed' : ''}>
                <td>${d.id}</td>
                <td>
                  {lang === 'ru' ? (RU_NAMES[d.id] || d.name) : d.name}
                  {d.unit ? <span className="unit">, {d.unit}</span> : null}
                  {note && <div className="note">{lang === 'et' && ET_NOTES[d.id] ? ET_NOTES[d.id] : note}</div>}
                </td>
                <td>{cur !== undefined ? cur : '—'}</td>
                <td>
                  {(d.bool || d.mask) ? (
                    <select value={dv} onChange={(e) => setDraft({ ...draft, [d.id]: e.target.value })}>
                      {Array.from({ length: d.max - d.min + 1 }, (_, i) => d.min + i).map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <input type="number" min={d.min} max={d.max} step="any" value={dv}
                           onChange={(e) => setDraft({ ...draft, [d.id]: e.target.value })} />
                  )}
                </td>
                <td>
                  <button className="small" onClick={() => writeOne(d.id)}
                          disabled={!connected || busy || !changed}>{t('settings.write')}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {dirtyCount > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => applyChanges(Object.entries(draft).map(([id, v]) => ({ id: Number(id), value: v })), t('settings.applyAll'))}
                  disabled={!connected || busy}>
            {t('settings.applyAll')} ({dirtyCount})
          </button>
          <button onClick={() => setDraft({})} disabled={busy}>{t('settings.discard')}</button>
        </div>
      )}

      {msg && <p className="hint" style={{ marginTop: 8 }}>{msg}</p>}
    </div>
  );
}

// Русские названия настроек (по wiki GRBL)
const RU_NAMES = {
  0: 'Импульс шага, мкс', 1: 'Задержка обесточивания шагов, мс', 2: 'Инверсия портов шага (маска)',
  3: 'Инверсия портов направления (маска)', 4: 'Инверсия включения драйверов (маска)',
  5: 'Инверсия концевиков (маска)', 6: 'Инверсия датчика щупа (маска)', 10: 'Подробность отчёта о статусе',
  11: 'Отклонение в углах, мм', 12: 'Допуск дуги, мм', 13: 'Отчёт в дюймах',
  20: 'Мягкие ограничения', 21: 'Жёсткие ограничения', 22: 'Цикл.homming', 23: 'Инверсия направления homing (маска)',
  24: 'Скорость поиска home, мм/мин', 25: 'Скорость seeks home, мм/мин', 26: 'Дебаунс концевиков, мс',
  27: 'Отступ после home, мм', 30: 'Макс. ход X, мм', 31: 'Макс. ход Y, мм', 32: 'Макс. ход Z, мм',
  100: 'Шагов на мм, ось X', 101: 'Шагов на мм, ось Y', 102: 'Шагов на мм, ось Z',
  110: 'Макс. скорость X, мм/мин', 111: 'Макс. скорость Y, мм/мин', 112: 'Макс. скорость Z, мм/мин',
  120: 'Ускорение X, мм/с²', 121: 'Ускорение Y, мм/с²', 122: 'Ускорение Z, мм/с²',
  130: 'Макс. перемещение X, мм', 131: 'Макс. перемещение Y, мм', 132: 'Макс. перемещение Z, мм',
};

// Эстонские подсказки для ключевых параметров
const ET_NOTES = {
  11: 'Väiksemad väärtused vähendavad nurkade ümardamist, kuid aeglustavad tööd. Pliiatsijoonistuse jaoks sobib 0,01–0,05.',
  20: 'Pehmed piirangud kasutavad $130/$131 maksimaalset käiku. Lubage pärast õigete piiride ja homingi ($H) seadistamist.',
  100: 'Scalable Pen Plotter: GT2 rihm, 20 hammast rullik + 1/16 mikrosamm ≈ 200 sammu/mm. Kontrollige 100 mm testruuduga.',
  110: 'Hoidke ≤ 3000 mm/min, et pliiats säilitaks kontakti paberiga.',
  120: 'Madal kiirendus väldib rihma libisemist kerge pliiatsikäru juures.',
  130: 'Määrake X-tööala tegelik suurus (A4 paber = maks 210 mm).',
  131: 'Määrake Y-tööala tegelik suurus (A4 paber = maks 297 mm).',
};
