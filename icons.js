// Иконки-снаряды в едином стиле (SVG, обводка = currentColor).
// exerciseIcon(name) подбирает иконку по ключевым словам в названии упражнения.
(function () {
  const s = 'viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    // Гантель
    dumbbell: `<svg ${s}><rect x="18" y="21.5" width="12" height="5" rx="1" fill="currentColor" stroke="none"/><rect x="8" y="14" width="6" height="20" rx="2"/><rect x="14" y="18" width="4" height="12" rx="1.5"/><rect x="30" y="18" width="4" height="12" rx="1.5"/><rect x="34" y="14" width="6" height="20" rx="2"/></svg>`,
    // Штанга / Смит
    barbell: `<svg ${s}><line x1="5" y1="24" x2="43" y2="24"/><rect x="10.5" y="15" width="5" height="18" rx="1.5"/><rect x="16" y="18" width="3.5" height="12" rx="1.2"/><rect x="28.5" y="18" width="3.5" height="12" rx="1.2"/><rect x="32.5" y="15" width="5" height="18" rx="1.5"/></svg>`,
    // Блок / трос / кроссовер
    cable: `<svg ${s}><line x1="8" y1="9" x2="40" y2="9"/><circle cx="24" cy="13" r="3.2"/><line x1="24" y1="16.4" x2="24" y2="30"/><line x1="14" y1="32" x2="34" y2="32"/><line x1="14" y1="32" x2="14" y2="37"/><line x1="34" y1="32" x2="34" y2="37"/></svg>`,
    // Тренажёр (стек)
    machine: `<svg ${s}><rect x="16" y="9" width="16" height="30" rx="2"/><line x1="16" y1="16" x2="32" y2="16"/><line x1="16" y1="22" x2="32" y2="22"/><line x1="16" y1="28" x2="32" y2="28"/><line x1="24" y1="28" x2="24" y2="34"/></svg>`,
    // Свой вес (турник)
    pullup: `<svg ${s}><line x1="7" y1="11" x2="41" y2="11"/><path d="M16 11v6a3 3 0 0 0 6 0"/><path d="M26 11v6a3 3 0 0 0 6 0"/><circle cx="24" cy="29" r="3"/><path d="M24 32v8"/></svg>`,
    // Кардио
    cardio: `<svg ${s}><path d="M24 38s-12-7-12-16a7 7 0 0 1 12-4 7 7 0 0 1 12 4c0 9-12 16-12 16z"/></svg>`,
    // По умолчанию (гиря)
    default: `<svg ${s}><path d="M19 18a5 5 0 0 1 10 0"/><path d="M17 18h14a3 3 0 0 1 3 3c0 8-4 17-10 17s-10-9-10-17a3 3 0 0 1 3-3z"/></svg>`,
  };

  function iconKey(name) {
    const n = (name || "").toLowerCase();
    if (/кардио/.test(n)) return "cardio";
    if (/подтягив|в висе|отжиман/.test(n)) return "pullup";
    if (/гантел|молотк/.test(n)) return "dumbbell";
    if (/хаммер|peck|пек-дек|тренажер|жим ногами|разгибания ног|сгибания ног|сведения ног|разведения ног/.test(n)) return "machine";
    if (/блок|кроссовер|молитва|канат/.test(n)) return "cable";
    if (/смит|штанг|гриф|мертвая|присед|французск|протяжк/.test(n)) return "barbell";
    return "default";
  }

  window.exerciseIcon = name => ICONS[iconKey(name)] || ICONS.default;
})();
