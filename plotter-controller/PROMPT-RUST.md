# Plotter Controller — промт для RUST-версии (v1, октябрь 2026)

> ⚠️ Этот файл НЕ меняет текущий проект (Node.js + React). Это готовый промт для AI-разработчика,
> чтобы с нуля написать аналог приложения на Rust. Скопируйте блок «Промт» в начало новой сессии.

---

## Промт

Ты — senior Rust разработчик. Создай с нуля приложение **Plotter Controller** — десктопную программу
для управления перовым плоттером [Scalable Pen Plotter](https://github.com/ubu78/Scalable-Pen-Plotter)
через контроллер GRBL (Arduino Uno + CNC Shield, Serial 115200 baud). Это Rust-порт существующего
Node.js-приложения: поведение и функции должны быть идентичны, но реализация — чистый, идиоматичный,
типобезопасный Rust без рантайма Node.

### Архитектура
Локальный HTTP-сервер + браузер UI (как в оригинале), либо Tauri-оболочка — выбери вариант, который
даёт самый лёгкий статик (preferably < 30 МБ, один бинарник без внешних зависимостей).
UI открывается автоматически на `http://localhost:8765` (порт переопределяется env `PORT`).

### Стек (Rust)
- **Async runtime**: tokio.
- **Web/HTTP**: axum (статика встроенного фронтенда через rust-embed) + WebSocket (tokio-tungstenite или axum ws) для стриминга статуса GRBL.
- **Serial**: crate `serialport` (синхронный доступ в dedicated thread / spawn_blocking).
- **SVG → G-code**: `svgparser` + собственная flatten-логика кривых Безье (или `kurbo`).
- **Шрифты/текст → G-code**: `ab_glyph` / `fontdue` для outline-глифов; поддержка Google Fonts — скачивание полных TTF (subset=cyrillic,latin) и парсинг контуров глифов (`owned_ttf_parser`); посимвольная обработка с advance width (без GSUB — надёжно для кириллицы и õäöü).
- **Документы → G-code**: PDF — `lopdf`/`printpdf` (извлечение текста), DOCX — `zip` + `quick-xml` (word/document.xml), TXT/MD — чтение как есть.
- **Заливка глифов**: polygon fill (scanline) для режимов solid/hatch; outline = «в одну линию».
- **Клавиатура/мышь drag позиции текста** — на фронте (React/Vanilla TS, собирается отдельно и встраивается rust-embed).
- **Сериализация**: serde, serde_json.
- **Ошибки**: anyhow (библиотеки — thiserror).

### GRBL-подсистема (соответствие gnea/grbl wiki)
- Подключение/отключение порта, список портов (udevadm/enumeration).
- Flow-control: отправлять следующую команду только после ответа `ok` (или `error`), очередь с backpressure; стриминг G-code с прогрессом (%report `?` каждые ~200 мс через WS).
- Команды: `$X` unlock, `G21`, `G90`, `G0/G1` (+ опционально M3/M4/M5 pen up/down, Z-осевая имитация подъёма пера), `$H` homing, `G28` zero, feed/pause/resume/cancel (`!`, `~`, `%`), emergency stop `Ctrl-X`.
- Панель настроек: чтение `$$`, запись `$0..$30`, `#1..#20`, `$100..$132`, `$130/$131` travel limits; пресет «Pen Plotter» ($100/$101=2000, $110/$111=3000, $130=210, $131=297 и т.д.); справочник названий/единиц/диапазонов по умолчанию; кнопка «restore defaults» (`$RST=$`, `$RST=#`, `$RST=*`).

### Функциональные требования (идентичны Node-версии)
1. **Лист A4 максимум** (210×297 мм): все конвертеры авто-вписывают рисунок (fit-to-page) с полями; превью листа с координатами и сеткой.
2. **Начало печати всегда из левого верхнего угла листа** (по умолчанию); позиция текста **перетаскивается мышью** вручную (drag по превью), кнопка сброса в угол.
3. **Три режима генерации текста** (renderMode): `outline` («в одну линию», обводка контура), `solid` (залитые буквы, scanline-заливка), `hatch` (диагональная штриховка). Переключатель в обеих панелях (текст и документ).
4. **Конвертеры**: SVG→G-code; Текст/Markdown→G-code; Документ (PDF/DOCX/TXT/MD)→G-code с автораскладкой строк и страниц.
5. **Google Fonts**: поиск и загрузка шрифтов с сервера (полные TTF, subset=cyrillic,latin), проверка покрытия кириллицы/эстонских букв, предупреждение о недостающих глифах.
6. **Локализация ru / en / et** (auto-detect по Accept-Language/браузеру, сохранение выбора), переключатель в топбаре.
7. **Три темы дизайна**: Тёмная, Светлая, «Сканер» (тёмно-зелёный фон + оранжевый акцент, кремовый лист — фирменный стиль Processing-скетча Scalable Pen Plotter). Выбор сохраняется (localStorage на фронте).
8. **Кнопка «Выход»** (`POST /api/shutdown`): закрыть порт GRBL, остановить HTTP/WS, завершить процесс; страница показывает заглушку «Сервер остановлен».
9. **Надёжный запуск**: освобождение занятого порта перед стартом, ожидание готовности, перезапуск при падении; оффлайн-режим (конвертация работает без подключённого плоттера).
10. Значок «created with coder.qwen.ai» в топбаре (ссылка, локализованный текст).

### Структура crates (предложение)
```
plotter-controller-rs/
├── Cargo.toml                 # workspace
├── crates/
│   ├── grbl/                  # serial, protocol, settings registry
│   ├── gcode/                 # модели траекторий, эмит G-code, fit-to-A4
│   ├── text-engine/           # opentype-глифы, layout, renderMode fill/hatch
│   ├── doc-extract/           # pdf/docx/txt/md → plain text
│   └── server/                # axum, api-роуты, ws, static embed, shutdown
├── frontend/                  # React+Vite (тот же UI, i18n ru/en/et, 3 темы)
└── packaging/                 # AppImage (.deb/AppDir) c единым бинарником; Windows .exe, macOS .app
```

### API (совместимость с существующим фронтом — сохраняй пути и JSON-формы)
`GET /api/status`, `POST /api/connect|disconnect`, `GET /api/ports`,
`POST /api/svg-to-gcode`, `POST /api/text-to-gcode`, `POST /api/document-to-gcode`,
`GET /api/fonts?q=`, `POST /api/resolve-font`, `GET /api/font-check`,
`GET /api/settings`, `POST /api/settings/set|apply|defs`,
`POST /api/print|pause|resume|cancel|emergency-stop`, `GET /api/shutdown(POST)`, WS `/ws`.

### Стиль кода
- rustfmt + clippy без warnings; no `unwrap()` в production-путях (кроме setup-инвариантов с comment).
- Модули с unit-тестами: parser `$$`-вывода GRBL, fit-to-page, layout текста, склейка штрихов в непрерывные линии (minimize pen lifts), эмуляция serial-порта для тестов flow-control.
- Конфигурация через env + `~/.config/plotter-controller/config.toml`.

### Приёмка
1. `cargo build --release` → один бинарник; запуск поднимает сервер, UI доступен в браузере.
2. Печатает тестовый SVG и текст «Тест Aa õäöü» в трёх режимах корректно (outline быстрее solid).
3. Перетаскивание текста мышью меняет старт-позицию; reset возвращает в левый верхний угол A4.
4. Панель настроек читает/записывает `$$`, применяет пресет Pen Plotter.
5. Кнопка «Выход» полностью останавливает процесс.
6. Локализация и темы переключаются мгновенно и сохраняются.

Ссылки: https://github.com/ubu78/Scalable-Pen-Plotter (оригинал, см. Plugin/test — образец конвертера),
https://github.com/gnea/grbl/wiki (GRBL v1.1 протокол и настройки),
https://github.com/ubu78/plotter-controller (текущая Node-версия — референс поведения).

---

## Короткая версия промта

> Напиши на Rust (tokio + axum + serialport + fontdue/ab_glyph + lopdf + zip/quick-xml, rust-embed для статики)
> десктопное приложение «Plotter Controller» для перового плоттера Scalable Pen Plotter через GRBL 1.1
> (Serial 115200, flow-control по `ok`, панель настроек `$$` с пресетом Pen Plotter). UI — локальный веб
> (localhost:8765, тот же что у Node-версии): конвертеры SVG/Текст-MD/PDF-Docx → G-code с ограничением A4,
> старт из левого верхнего угла + drag мышью, три режима отрисовки (в одну линию / залитые / штриховка),
> Google Fonts полными TTF (cyrillic+latin), i18n ru/en/et, три темы (тёмная/светлая/«Сканер»),
> POST /api/shutdown, надёжный запуск с оффлайн-режимом. Один бинарник, AppImage/EXE/DMG. Поведение
> идентично https://github.com/ubu78/plotter-controller; протокол GRBL — gnea/grbl wiki.
