// grblSettings.js — справочник $-настроек GRBL 1.1
// Источник: https://github.com/gnea/grbl/wiki (Grbl v1.1 Configuration Settings)
// Значения по умолчанию указаны для совместимости с «Scalable Pen Plotter» (Arduino Uno + GRBL).

export const GRBL_SETTINGS = [
  { id: 0, name: 'Step pulse, microseconds', def: 10, min: 1, max: 10, unit: 'µs' },
  { id: 1, name: 'Step idle delay, milliseconds', def: 25, min: 0, max: 255, unit: 'ms' },
  { id: 2, name: 'Step port invert mask', def: 0, min: 0, max: 255, mask: true },
  { id: 3, name: 'Direction port invert mask', def: 0, min: 0, max: 255, mask: true },
  { id: 4, name: 'Step enable invert mask', def: 0, min: 0, max: 255, mask: true },
  { id: 5, name: 'Limit pins invert mask', def: 0, min: 0, max: 255, mask: true },
  { id: 6, name: 'Probe pin invert mask', def: 0, min: 0, max: 255, mask: true },
  { id: 10, name: 'Status report verbosity', def: 3, min: 0, max: 3 },
  { id: 11, name: 'Junction deviation, mm', def: 0.01, min: 0.001, max: 0.1, unit: 'mm', plotterHint: true },
  { id: 12, name: 'Arc tolerance, mm', def: 0.01, min: 0.001, max: 0.1, unit: 'mm' },
  { id: 13, name: 'Report in inches', def: 0, min: 0, max: 1, bool: true },
  { id: 20, name: 'Soft limits enable', def: 0, min: 0, max: 1, bool: true, plotterHint: true },
  { id: 21, name: 'Hard limits enable', def: 0, min: 0, max: 1, bool: true },
  { id: 22, name: 'Homing cycle enable', def: 0, min: 0, max: 1, bool: true },
  { id: 23, name: 'Homing direction invert mask', def: 0, min: 0, max: 255, mask: true },
  { id: 24, name: 'Homing locate feed rate, mm/min', def: 500, min: 1, max: 5000, unit: 'mm/min' },
  { id: 25, name: 'Homing search seek rate, mm/min', def: 5000, min: 1, max: 5000, unit: 'mm/min' },
  { id: 26, name: 'Homing debounce delay, milliseconds', def: 25, min: 0, max: 255, unit: 'ms' },
  { id: 27, name: 'Homing pull-off distance, mm', def: 1, min: 0, max: 100, unit: 'mm' },
  { id: 30, name: 'X-axis max travel, mm', def: 200, min: 1, max: 2000, unit: 'mm', plotterHint: true },
  { id: 31, name: 'Y-axis max travel, mm', def: 200, min: 1, max: 2000, unit: 'mm', plotterHint: true },
  { id: 32, name: 'Z-axis max travel, mm', def: 200, min: 1, max: 2000, unit: 'mm' },
  { id: 100, name: 'X-axis steps per mm', def: 80, min: 0, max: 65535, unit: 'step/mm', plotterHint: true },
  { id: 101, name: 'Y-axis steps per mm', def: 80, min: 0, max: 65535, unit: 'step/mm', plotterHint: true },
  { id: 102, name: 'Z-axis steps per mm', def: 80, min: 0, max: 65535, unit: 'step/mm' },
  { id: 110, name: 'X-axis max rate, mm/min', def: 1000, min: 1, max: 65535, unit: 'mm/min', plotterHint: true },
  { id: 111, name: 'Y-axis max rate, mm/min', def: 1000, min: 1, max: 65535, unit: 'mm/min', plotterHint: true },
  { id: 112, name: 'Z-axis max rate, mm/min', def: 1000, min: 1, max: 65535, unit: 'mm/min' },
  { id: 120, name: 'X-axis acceleration, mm/sec²', def: 10, min: 1, max: 65535, unit: 'mm/s²', plotterHint: true },
  { id: 121, name: 'Y-axis acceleration, mm/sec²', def: 10, min: 1, max: 65535, unit: 'mm/s²', plotterHint: true },
  { id: 122, name: 'Z-axis acceleration, mm/sec²', def: 10, min: 1, max: 65535, unit: 'mm/s²' },
  { id: 130, name: 'X-axis max travel, mm', def: 200, min: 1, max: 2000, unit: 'mm', plotterHint: true },
  { id: 131, name: 'Y-axis max travel, mm', def: 200, min: 1, max: 2000, unit: 'mm', plotterHint: true },
  { id: 132, name: 'Z-axis max travel, mm', def: 200, min: 1, max: 2000, unit: 'mm' },
];

// Подсказки для ключевых настроек плоттера (EN/EU текст; UI показывает свой перевод)
export const PLOTTER_NOTES = {
  11: 'Lower values reduce corner rounding at the cost of speed. For pen plotting 0.01–0.05 is fine.',
  20: 'Soft limits use $130/$131 max travel. Enable after setting correct travel limits and homing ($H).',
  100: 'For Scalable Pen Plotter: GT2 belt 20T pulley + 1/16 microstepping on A4988 ≈ 4000 steps / 20 mm → $100/$101 = 200. With direct drive and different geometry compute: steps/mm = (microsteps × 200 × belt pitch) / pulley teeth… verify by measuring a 100 mm test square.',
  110: 'Keep ≤ 3000 mm/min for stable pen contact; start low and increase gradually.',
  120: 'Low acceleration avoids belt skipping with a light pen carriage. Increase if layers shift.',
  130: 'Set to your actual X work area (A4 paper = 210 mm max). Used by soft limits.',
  131: 'Set to your actual Y work area (A4 paper = 297 mm max). Used by soft limits.',
};
