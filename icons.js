// Пиктограммы-человечки по типу движения (оригинальные SVG, единый стиль).
// exerciseIcon(name) подбирает движение по ключевым словам в названии упражнения.
(function () {
  const A = 'viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"';
  const dot = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

  const ICONS = {
    // Жим лёжа / грудь
    chest: `<svg ${A}><line x1="7" y1="39" x2="33" y2="39" stroke-width="3.4"/>${dot(12, 34, 4)}<path d="M15 35h13"/><path d="M28 35l7 4"/><path d="M23 35l2-9"/><line x1="17" y1="25" x2="33" y2="25" stroke-width="3.2"/>${dot(17, 25, 2.4)}${dot(33, 25, 2.4)}</svg>`,
    // Жим над головой / плечи
    shoulder: `<svg ${A}>${dot(24, 13, 4)}<path d="M24 17v11"/><path d="M24 28l-6 11M24 28l6 11"/><path d="M24 20l-8-6M24 20l8-6"/><line x1="11" y1="9" x2="37" y2="9" stroke-width="3.4"/>${dot(11, 9, 2.6)}${dot(37, 9, 2.6)}</svg>`,
    // Махи / дельты
    delts: `<svg ${A}>${dot(24, 11, 4)}<path d="M24 15v13"/><path d="M24 17l-9 2M24 17l9 2"/><path d="M24 28l-4 11M24 28l4 11"/>${dot(13, 18, 3.2)}${dot(35, 18, 3.2)}</svg>`,
    // Тяга сверху / подтягивания
    pulldown: `<svg ${A}><line x1="9" y1="9" x2="39" y2="9" stroke-width="3.4"/><path d="M18 10l5 7M30 10l-5 7"/>${dot(24, 21, 4)}<path d="M24 25v8"/><path d="M24 33l-5 8M24 33l5 8"/></svg>`,
    // Тяга в наклоне / горизонтальная
    row: `<svg ${A}>${dot(11, 15, 4)}<path d="M13 18l17 5"/><path d="M14 20l-2 18"/><path d="M30 23l-1 15"/><path d="M30 23l-5 6"/><line x1="24" y1="29" x2="35" y2="32" stroke-width="3.2"/>${dot(35, 32, 2.6)}</svg>`,
    // Бицепс
    curl: `<svg ${A}>${dot(19, 12, 4)}<path d="M19 16v13"/><path d="M19 29l-4 10M19 29l4 10"/><path d="M19 21l8 3-2 6"/>${dot(25, 30, 3.2)}</svg>`,
    // Трицепс
    triceps: `<svg ${A}><line x1="31" y1="7" x2="31" y2="18" stroke-width="3.2"/>${dot(20, 12, 4)}<path d="M20 16v13"/><path d="M20 29l-4 10M20 29l4 10"/><path d="M20 20l7 1"/><path d="M27 21l2 7"/>${dot(29, 29, 2.8)}</svg>`,
    // Ноги / присед
    legs: `<svg ${A}>${dot(24, 8, 3.6)}<line x1="13" y1="14" x2="35" y2="14" stroke-width="3.4"/>${dot(13, 14, 2.6)}${dot(35, 14, 2.6)}<path d="M24 12v9"/><path d="M24 21l-8 7v11M24 21l8 7v11"/></svg>`,
    // Пресс / подъёмы ног в висе
    abs: `<svg ${A}><line x1="9" y1="9" x2="39" y2="9" stroke-width="3.4"/><path d="M19 10l5 6M29 10l-5 6"/>${dot(24, 19, 3.8)}<path d="M24 23v5"/><path d="M24 28h9"/><path d="M33 28v-6"/></svg>`,
    // Кардио
    cardio: `<svg viewBox="0 0 48 48" fill="currentColor"><path d="M24 39s-13-7.6-13-17.2C11 16 15 12.5 19.4 12.5c2.6 0 4.6 1.3 5.6 3 1-1.7 3-3 5.6-3C35 12.5 39 16 39 21.8 39 31.4 24 39 24 39z"/></svg>`,
  };

  function iconKey(name) {
    const n = (name || "").toLowerCase();
    if (/кардио/.test(n)) return "cardio";
    if (/молитва|в висе|скручиван|пресс/.test(n)) return "abs";
    if (/бицепс|молотк|сгибания рук/.test(n)) return "curl";
    if (/трицепс|французск|разгибания в блоке|разгибания из-за|разгибания с двух|узким хватом|отжимания с упором/.test(n)) return "triceps";
    if (/присед|выпад|жим ногами|разгибания ног|сгибания ног|носки|мертвая|румынск|гакк|ягодич/.test(n)) return "legs";
    if (/подтягив|вертикальн|пуловер|пулловер|тяга верхн/.test(n)) return "pulldown";
    if (/мах|отведение|протяжк|задн|разведение|подъемы рук/.test(n)) return "delts";
    if (/тяга|горизонтальн/.test(n)) return "row";
    if (/жим.*сид|жим гантелей сид/.test(n)) return "shoulder";
    return "chest";
  }

  window.exerciseIcon = name => ICONS[iconKey(name)] || ICONS.chest;
})();
