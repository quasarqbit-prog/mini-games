(function shellModule() {
  const THEME_KEY = 'leisure-theme';
  const LANG_KEY = 'leisure-lang';
  const CUSTOM_KEY = 'leisure-custom';

  const THEMES = [
    { id: 'dark', ru: 'Тёмная', en: 'Dark', colors: ['#130A0D', '#3F242A', '#523344', '#A67542'] },
    { id: 'light', ru: 'Светлая', en: 'Light', colors: ['#E5EDFA', '#BBD0ED', '#A2B7E4', '#7087BB'] },
    { id: 'butterfly', ru: 'Бабочка', en: 'Butterfly', colors: ['#8DA28C', '#A4530C', '#EEE9C1', '#3A230A'] },
    { id: 'usugaki', ru: 'Комната', en: 'Usugaki', colors: ['#FFA67A', '#817965', '#4E4C5E', '#572F48'] },
    { id: 'ebony', ru: 'Эбен', en: 'Ebony', colors: ['#130A0D', '#3F242A', '#523344', '#A67542'] },
    { id: 'frozen', ru: 'Кристаллы', en: 'Frozen Water', colors: ['#D4E8E1', '#A0B1BB', '#DA9E7D', '#74418B'] },
    { id: 'portage', ru: 'Закат', en: 'Portage', colors: ['#9995E8', '#BF93D0', '#FDB5A5', '#FDD2A3'] },
    { id: 'orbital', ru: 'Орбита', en: 'Orbital', colors: ['#7087BB', '#A2B7E4', '#BBD0ED', '#E5EDFA'] },
    { id: 'topaz', ru: 'Бассейн', en: 'Blue Topaz', colors: ['#1A4D94', '#357CB6', '#D5A25E', '#AB6D48'] },
    { id: 'street', ru: 'Улица', en: 'Chinese Yellow', colors: ['#FDB201', '#F09215', '#C4610B', '#853920'] },
    { id: 'bianchi', ru: 'Море', en: 'Bianchi Green', colors: ['#34C8C5', '#DF84BD', '#FC8A8E', '#FFAE69'] },
    { id: 'lettuce', ru: 'Торт', en: 'Lettuce Mound', colors: ['#93A674', '#CBD9B8', '#D9C9BA', '#8D6A56'] },
  ];

  const TEXT = {
    ru: {
      'lang.label': 'Язык',
      'theme.label': 'Тема',
      'theme.title': 'Темы',
      'theme.custom': 'Своя палитра',
      'theme.apply': 'Применить',
      'theme.close': 'Закрыть',
      'onboard.title': 'Профиль',
      'onboard.avatar': 'Выбрать аватар',
      'onboard.name': 'Никнейм',
      'onboard.start': 'Начать',
      'gate.create': 'Создать лобби',
      'gate.join': 'Присоединиться',
      'gate.code': 'Код лобби',
      'slot.empty': 'Слот для игрока',
      'hub.leave': 'Выйти',
      'hub.choose': 'Выбрать',
      'hub.chosen': 'Выбрано',
      'hub.nobody': 'Сейчас на сайте никого нет',
      'hub.invite': 'Пригласить',
      'note.accept': 'Принять',
      'note.decline': 'Отклонить',
      'profile': 'Профиль',
      'home.lead': 'Открой Wordle, морской бой, кинотеатр или монополию и скинь ссылку другу. Он попадёт в ту же комнату.',
      'home.code': 'Код комнаты',
      'home.join': 'Присоединиться',
      'home.games': 'Игры',
      'home.chat': 'Чат',
      'home.chat.empty': 'Когда кто-то будет онлайн, здесь появится блок для переписки.',
      'home.connecting': 'Подключаемся…',
      'game.wordle': 'Wordle',
      'game.wordle.text': 'Загадайте слово друг другу и угадывайте по очереди. Кто первый угадает — победил.',
      'game.wordle.tag': '2 игрока',
      'game.battle': 'Морской бой',
      'game.battle.text': 'Расставьте флот и стреляйте по полю соперника. Попадание даёт ещё один ход.',
      'game.battle.tag': '2 игрока',
      'game.cinema': 'Кинотеатр',
      'game.cinema.text': 'Смотрите вместе: YouTube, Twitch, Google Drive и Dropbox.',
      'game.cinema.tag': 'вместе',
      'game.mono': 'Монополия',
      'game.mono.text': 'Покупайте улицы, стройте дома и торгуйтесь. Кто останется при деньгах — победил.',
      'game.mono.tag': '2–6 игроков',
      'slot.bg': 'Фон',
      'slot.card': 'Карточки',
      'slot.accent': 'Акцент',
      'slot.mark': 'Выделение',
      'tab.profile': 'Профиль',
      'tab.theme': 'Темы',
      'tab.settings': 'Настройки',
      'profile.id': 'ID',
      'profile.save': 'Сохранить',
      'profile.saved': 'Профиль сохранён',
      'profile.close': 'Закрыть',
      'profile.clear': 'Убрать аватарку',
    },
    en: {
      'lang.label': 'Language',
      'theme.label': 'Theme',
      'theme.title': 'Themes',
      'theme.custom': 'Custom palette',
      'theme.apply': 'Apply',
      'theme.close': 'Close',
      'onboard.title': 'Profile',
      'onboard.avatar': 'Choose avatar',
      'onboard.name': 'Nickname',
      'onboard.start': 'Start',
      'gate.create': 'Create lobby',
      'gate.join': 'Join',
      'gate.code': 'Lobby code',
      'slot.empty': 'Player slot',
      'hub.leave': 'Leave',
      'hub.choose': 'Choose',
      'hub.chosen': 'Chosen',
      'hub.nobody': 'Nobody else is here right now',
      'hub.invite': 'Invite',
      'note.accept': 'Accept',
      'note.decline': 'Decline',
      'profile': 'Profile',
      'home.lead': 'Open Wordle, Battleship, the cinema, or Monopoly and send the link to a friend. They join the same room.',
      'home.code': 'Room code',
      'home.join': 'Join',
      'home.games': 'Games',
      'home.chat': 'Chat',
      'home.chat.empty': 'When someone is online, a conversation will appear here.',
      'home.connecting': 'Connecting…',
      'game.wordle': 'Wordle',
      'game.wordle.text': 'Set a word for each other and take turns guessing. First to solve it wins.',
      'game.wordle.tag': '2 players',
      'game.battle': 'Battleship',
      'game.battle.text': 'Place your fleet and fire at the other board. A hit gives another shot.',
      'game.battle.tag': '2 players',
      'game.cinema': 'Cinema',
      'game.cinema.text': 'Watch together: YouTube, Twitch, Google Drive, and Dropbox.',
      'game.cinema.tag': 'together',
      'game.mono': 'Monopoly',
      'game.mono.text': 'Buy streets, build houses, and trade. Last one with money wins.',
      'game.mono.tag': '2–6 players',
      'slot.bg': 'Background',
      'slot.card': 'Cards',
      'slot.accent': 'Accent',
      'slot.mark': 'Highlight',
      'tab.profile': 'Profile',
      'tab.theme': 'Themes',
      'tab.settings': 'Settings',
      'profile.id': 'ID',
      'profile.save': 'Save',
      'profile.saved': 'Profile saved',
      'profile.close': 'Close',
      'profile.clear': 'Remove avatar',
    },
  };

  let lang = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ru';
  let themeId = localStorage.getItem(THEME_KEY) || 'dark';
  let hooks = null;
  let draftAvatar = '';

  function t(key) {
    return TEXT[lang][key] || TEXT.ru[key] || key;
  }

  function themeName(theme) {
    return lang === 'en' ? theme.en : theme.ru;
  }

  function ink(hex) {
    const value = String(hex || '').replace('#', '');
    if (value.length !== 6) return '#F6EFE4';
    const num = Number.parseInt(value, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? '#1A1208' : '#F6EFE4';
  }

  function colorsOf(id) {
    if (id === 'custom') {
      try {
        const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
        if (Array.isArray(saved) && saved.length === 4) return saved;
      } catch { /* keep the dark palette */ }
      return THEMES[0].colors.slice();
    }
    return (THEMES.find((item) => item.id === id) || THEMES[0]).colors.slice();
  }

  function applyTheme(id) {
    themeId = id === 'custom' || THEMES.some((item) => item.id === id) ? id : 'dark';
    localStorage.setItem(THEME_KEY, themeId);
    const [bg, card, accent, mark] = colorsOf(themeId);
    const text = ink(bg);
    const root = document.documentElement;
    root.dataset.theme = themeId;
    const vars = {
      '--bg': bg,
      '--card': card,
      '--card-2': card,
      '--accent': accent,
      '--mark': mark,
      '--coral': mark,
      '--text': text,
      '--cream': text,
      '--muted': accent,
      '--line': accent,
      '--tile-line': accent,
      '--absent': card,
      '--shadow': '0 9px 0 4px #000',
    };
    Object.entries(vars).forEach(([name, value]) => root.style.setProperty(name, value));
    root.style.colorScheme = text === '#1A1208' ? 'light' : 'dark';
  }

  function applyLang(next) {
    lang = next === 'en' ? 'en' : 'ru';
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      if (node.id === 'lang-btn') return;
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.placeholder = t(node.dataset.i18nPlaceholder);
    });
    const code = document.getElementById('onboard-lang-code');
    if (code) code.textContent = lang === 'en' ? 'eng' : 'ru';
    paintThemes();
    hooks?.rerender();
  }

  function paintThemes() {
    const list = document.getElementById('theme-list');
    if (!list) return;
    list.innerHTML = THEMES.map((theme) => `
      <li>
        <button type="button" class="theme-swatch${theme.id === themeId ? ' on' : ''}" data-theme="${theme.id}">
          <span class="swatches">${theme.colors.map((color) => `<i style="background:${color}"></i>`).join('')}</span>
          <b>${themeName(theme)}</b>
        </button>
      </li>`).join('');
  }

  function openThemes(open) {
    const modal = document.getElementById('theme-modal');
    if (!modal) return;
    modal.hidden = !open;
    if (open) {
      paintThemes();
      const colors = colorsOf(themeId);
      modal.querySelectorAll('[data-slot]').forEach((input) => {
        input.value = colors[Number(input.dataset.slot)] || '#000000';
      });
    }
  }

  function openLang(open) {
    const menu = document.getElementById('lang-menu');
    if (menu) menu.hidden = !open;
  }

  function showOnboard() {
    const modal = document.getElementById('onboard');
    if (!modal || modal.dataset.ready === '1') return;
    const current = hooks?.profile?.() || { name: '', avatar: '' };
    draftAvatar = current.avatar || '';
    const name = document.getElementById('onboard-name');
    if (name) name.value = current.name || '';
    paintDraft();
    modal.hidden = false;
  }

  function paintDraft() {
    const image = document.getElementById('onboard-avatar');
    const letter = document.getElementById('onboard-letter');
    const name = document.getElementById('onboard-name')?.value || '';
    if (!image || !letter) return;
    if (draftAvatar) {
      image.src = draftAvatar;
      image.hidden = false;
      letter.hidden = true;
      return;
    }
    image.hidden = true;
    letter.hidden = false;
    letter.textContent = (name.trim().slice(0, 1) || '?').toUpperCase();
  }

  function mount(nextHooks) {
    hooks = nextHooks;
    applyTheme(themeId);
    applyLang(lang);
    const langBtn = document.getElementById('lang-btn');
    const themeBtn = document.getElementById('theme-btn');
    langBtn?.addEventListener('click', () => openLang(document.getElementById('lang-menu')?.hidden !== false));
    document.getElementById('lang-menu')?.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-lang]');
      if (!choice) return;
      applyLang(choice.dataset.lang);
      openLang(false);
    });
    themeBtn?.addEventListener('click', () => openThemes(true));
    document.getElementById('theme-close')?.addEventListener('click', () => openThemes(false));
    document.getElementById('theme-list')?.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-theme]');
      if (!choice) return;
      applyTheme(choice.dataset.theme);
      paintThemes();
    });
    document.getElementById('theme-custom')?.addEventListener('click', () => {
      const modal = document.getElementById('theme-modal');
      const colors = [...modal.querySelectorAll('[data-slot]')].map((input) => input.value);
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(colors));
      applyTheme('custom');
      paintThemes();
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#lang-pop')) openLang(false);
    });
    document.getElementById('onboard-name')?.addEventListener('input', paintDraft);
    document.getElementById('onboard-file')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file || !hooks?.pixelAvatar) return;
      draftAvatar = await hooks.pixelAvatar(file);
      paintDraft();
    });
    document.getElementById('onboard-lang')?.addEventListener('click', () => {
      applyLang(lang === 'ru' ? 'en' : 'ru');
    });
    document.getElementById('onboard-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = document.getElementById('onboard-name').value.replace(/\s+/g, ' ').trim().slice(0, 20);
      hooks?.saveProfile({ name, avatar: draftAvatar });
      hooks?.createLobby?.();
    });
    const nav = performance.getEntriesByType('navigation')[0];
    if (!nav || nav.type !== 'reload') showOnboard();
  }

  window.Leisure = {
    t,
    mount,
    applyLang,
    applyTheme,
    themes: THEMES,
    themeName,
    currentTheme() { return themeId; },
    colorsOf,
  };
  applyTheme(themeId);
  document.documentElement.lang = lang;
})();
