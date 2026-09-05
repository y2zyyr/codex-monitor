/* ModelYard Community client: small DOM-only enhancement layer. */
(function () {
  'use strict';

  var data = window.__COMMUNITY_DATA__ || {};
  var timeApi = window.TiboLocaleTime;
  var htmlLanguage = (document.documentElement.lang || '').toLowerCase();
  var locale = htmlLanguage.indexOf('zh') === 0 ? 'zh' : htmlLanguage.indexOf('ja') === 0 ? 'ja' : htmlLanguage.indexOf('es') === 0 ? 'es' : htmlLanguage.indexOf('fr') === 0 ? 'fr' : 'en';
  var isZh = locale === 'zh';
  var copy = isZh ? {
    nicknameRequired: '请输入昵称。',
    nicknameReserved: '此昵称为官方账号保留。',
    contentRequired: '请输入内容。',
    nicknameTooLong: '昵称超出长度限制。',
    contentTooLong: '内容超出长度限制。',
    topicRequired: '请选择一个主题。',
    securityCheck: '请完成安全验证后再发布。',
    posting: '发布中……',
    posted: '留言已发布。',
    pending: '留言已提交，等待审核。',
    postError: '暂时无法发布留言，请稍后再试。',
    loading: '加载中……',
    loadError: '暂时无法加载社区内容。',
    loadMore: '加载更多',
    showOriginal: '显示原文',
    hideOriginal: '收起原文',
    original: '原文',
    translatedFrom: '译自',
    unknownLanguage: '未知语言',
    openExternal: '打开外部链接',
    stars: '星标',
    forks: '复刻',
    language: '语言',
    license: '许可证',
    repo: 'GitHub 仓库',
    justNow: '刚刚',
    minute: '分钟前',
    hour: '小时前',
    day: '天前',
    topic: '主题', allTopics: '全部主题', search: '搜索', searchPlaceholder: '搜索留言、链接或昵称', searchButton: '搜索动态', clearFilters: '清除筛选', allPosts: '全部留言', featuredPosts: '精选', githubPosts: 'GitHub 仓库', showing: '显示', filteredResults: '筛选结果', pinned: '置顶', featured: '精选', announcement: '公告', verifiedAdmin: '已认证管理员', aiAccount: '自动账号', noMatchingPosts: '没有符合这些筛选条件的留言。', noPosts: '还没有留言。', firstPost: '来发布第一条留言吧。'
  } : {
    nicknameRequired: 'Please enter a nickname.',
    nicknameReserved: 'This nickname is reserved for official accounts.',
    contentRequired: 'Please enter a message.',
    nicknameTooLong: 'Nickname is too long.',
    contentTooLong: 'Message is too long.',
    topicRequired: 'Please choose a topic.',
    securityCheck: 'Please complete the security check before posting.',
    posting: 'Posting…',
    posted: 'Your message was posted.',
    pending: 'Your message was submitted for review.',
    postError: 'Unable to post right now. Please try again later.',
    loading: 'Loading…',
    loadError: 'Unable to load the community right now.',
    loadMore: 'Load more',
    showOriginal: 'Show original',
    hideOriginal: 'Hide original',
    original: 'Original',
    translatedFrom: 'Translated from',
    unknownLanguage: 'unknown language',
    openExternal: 'Open external link',
    stars: 'Stars',
    forks: 'Forks',
    language: 'Language',
    license: 'License',
    repo: 'GitHub repository',
    justNow: 'just now',
    minute: 'min ago',
    hour: 'hr ago',
    day: 'days ago',
    topic: 'Topic', allTopics: 'All topics', search: 'Search', searchPlaceholder: 'Search messages, links, or nicknames', searchButton: 'Search feed', clearFilters: 'Clear filters', allPosts: 'All posts', featuredPosts: 'Featured', githubPosts: 'GitHub repos', showing: 'Showing', filteredResults: 'Filtered results', pinned: 'Pinned', featured: 'Featured', announcement: 'Announcement', verifiedAdmin: 'Verified administrator', aiAccount: 'Automated account', noMatchingPosts: 'No posts match these filters.', noPosts: 'No posts yet.', firstPost: 'Be the first to leave a message.'
  };

  if (locale === 'ja') copy = {
    nicknameRequired: 'ニックネームを入力してください。', nicknameReserved: 'このニックネームは公式アカウント用に予約されています。', contentRequired: '内容を入力してください。', nicknameTooLong: 'ニックネームが長すぎます。', contentTooLong: '内容が長すぎます。', topicRequired: 'トピックを選択してください。', securityCheck: '投稿前にセキュリティチェックを完了してください。', posting: '投稿中…', posted: 'メッセージを投稿しました。', pending: 'メッセージを送信しました。審査をお待ちください。', postError: '投稿できません。しばらくしてからお試しください。', loading: '読み込み中…', loadError: 'コミュニティを読み込めません。', loadMore: 'さらに読み込む', showOriginal: '原文を表示', hideOriginal: '原文を隠す', original: '原文', translatedFrom: '翻訳元', unknownLanguage: '不明な言語', openExternal: '外部リンクを開く', stars: 'スター', forks: 'フォーク', language: '言語', license: 'ライセンス', repo: 'GitHub リポジトリ', justNow: 'たった今', minute: '分前', hour: '時間前', day: '日前', topic: 'トピック', allTopics: 'すべてのトピック', search: '検索', searchPlaceholder: 'メッセージ、リンク、ニックネームを検索', searchButton: 'フィードを検索', clearFilters: 'フィルターをクリア', allPosts: 'すべての投稿', featuredPosts: 'おすすめ', githubPosts: 'GitHub リポジトリ', showing: '表示中', filteredResults: '絞り込み結果', pinned: 'ピン留め', featured: 'おすすめ', announcement: 'お知らせ', verifiedAdmin: '認証済み管理者', aiAccount: '自動アカウント', noMatchingPosts: '条件に一致する投稿はありません。', noPosts: 'まだ投稿はありません。', firstPost: '最初のメッセージを投稿しましょう。'
  };
  if (locale === 'es') copy = {
    nicknameRequired: 'Introduce un apodo.', nicknameReserved: 'Este apodo está reservado para cuentas oficiales.', contentRequired: 'Introduce un mensaje.', nicknameTooLong: 'El apodo es demasiado largo.', contentTooLong: 'El mensaje es demasiado largo.', topicRequired: 'Elige un tema.', securityCheck: 'Completa la comprobación de seguridad antes de publicar.', posting: 'Publicando…', posted: 'Tu mensaje se ha publicado.', pending: 'Tu mensaje se ha enviado para revisión.', postError: 'No se puede publicar ahora. Inténtalo de nuevo más tarde.', loading: 'Cargando…', loadError: 'No se puede cargar la comunidad ahora.', loadMore: 'Cargar más', showOriginal: 'Mostrar original', hideOriginal: 'Ocultar original', original: 'Original', translatedFrom: 'Traducido del', unknownLanguage: 'idioma desconocido', openExternal: 'Abrir enlace externo', stars: 'Estrellas', forks: 'Forks', language: 'Lenguaje', license: 'Licencia', repo: 'Repositorio de GitHub', justNow: 'ahora mismo', minute: 'min', hour: 'h', day: 'días', topic: 'Tema', allTopics: 'Todos los temas', search: 'Buscar', searchPlaceholder: 'Buscar mensajes, enlaces o apodos', searchButton: 'Buscar en el feed', clearFilters: 'Borrar filtros', allPosts: 'Todas las publicaciones', featuredPosts: 'Destacadas', githubPosts: 'Repositorios de GitHub', showing: 'Mostrando', filteredResults: 'Resultados filtrados', pinned: 'Fijada', featured: 'Destacada', announcement: 'Anuncio', verifiedAdmin: 'Administrador verificado', aiAccount: 'Cuenta automatizada', noMatchingPosts: 'No hay publicaciones que coincidan con estos filtros.', noPosts: 'Aún no hay publicaciones.', firstPost: 'Sé la primera persona en dejar un mensaje.'
  };
  if (locale === 'fr') copy = {
    nicknameRequired: 'Saisissez un pseudo.', nicknameReserved: 'Ce pseudo est réservé aux comptes officiels.', contentRequired: 'Saisissez un message.', nicknameTooLong: 'Le pseudo est trop long.', contentTooLong: 'Le message est trop long.', topicRequired: 'Choisissez un sujet.', securityCheck: 'Terminez le contrôle de sécurité avant de publier.', posting: 'Publication…', posted: 'Votre message a été publié.', pending: 'Votre message a été envoyé pour modération.', postError: 'Publication impossible pour le moment. Réessayez plus tard.', loading: 'Chargement…', loadError: 'La communauté est momentanément indisponible.', loadMore: 'Charger plus', showOriginal: 'Afficher l’original', hideOriginal: 'Masquer l’original', original: 'Original', translatedFrom: 'Traduit du', unknownLanguage: 'langue inconnue', openExternal: 'Ouvrir le lien externe', stars: 'Étoiles', forks: 'Forks', language: 'Langage', license: 'Licence', repo: 'Dépôt GitHub', justNow: 'à l’instant', minute: 'min', hour: 'h', day: 'jours', topic: 'Sujet', allTopics: 'Tous les sujets', search: 'Rechercher', searchPlaceholder: 'Rechercher des messages, liens ou pseudos', searchButton: 'Rechercher dans le fil', clearFilters: 'Effacer les filtres', allPosts: 'Toutes les publications', featuredPosts: 'À la une', githubPosts: 'Dépôts GitHub', showing: 'Affichage', filteredResults: 'Résultats filtrés', pinned: 'Épinglée', featured: 'À la une', announcement: 'Annonce', verifiedAdmin: 'Administrateur vérifié', aiAccount: 'Compte automatisé', noMatchingPosts: 'Aucune publication ne correspond à ces filtres.', noPosts: 'Aucune publication pour le moment.', firstPost: 'Soyez la première personne à laisser un message.'
  };

  var topicLabels = locale === 'ja' ? {
    general: '一般', 'ai-coding': 'AI コーディング', llm: 'LLM', rag: 'RAG', agents: 'エージェント', prompts: 'プロンプト', 'ai-tools': 'AI ツール', 'open-source': 'オープンソース'
  } : locale === 'es' ? {
    general: 'General', 'ai-coding': 'Programación con IA', llm: 'LLM', rag: 'RAG', agents: 'Agentes', prompts: 'Prompts', 'ai-tools': 'Herramientas de IA', 'open-source': 'Código abierto'
  } : locale === 'fr' ? {
    general: 'Général', 'ai-coding': 'Programmation IA', llm: 'LLM', rag: 'RAG', agents: 'Agents', prompts: 'Prompts', 'ai-tools': 'Outils IA', 'open-source': 'Open source'
  } : isZh ? {
    general: '综合', 'ai-coding': 'AI 编程', llm: '大语言模型', rag: 'RAG', agents: '智能体', prompts: '提示词', 'ai-tools': 'AI 工具', 'open-source': '开源项目'
  } : {
    general: 'General', 'ai-coding': 'AI coding', llm: 'LLMs', rag: 'RAG', agents: 'Agents', prompts: 'Prompts', 'ai-tools': 'AI tools', 'open-source': 'Open source'
  };

  var filters = Object.assign({ query: null, topic: null, featuredOnly: false, githubOnly: false }, data.filters || {});

  var languageLabels = locale === 'ja' ? {
    en: '英語', zh: '中国語', ja: '日本語', ko: '韓国語', fr: 'フランス語', de: 'ドイツ語', es: 'スペイン語', pt: 'ポルトガル語', it: 'イタリア語', ru: 'ロシア語', ar: 'アラビア語', und: '不明な言語'
  } : locale === 'es' ? {
    en: 'inglés', zh: 'chino', ja: 'japonés', ko: 'coreano', fr: 'francés', de: 'alemán', es: 'español', pt: 'portugués', it: 'italiano', ru: 'ruso', ar: 'árabe', und: 'idioma desconocido'
  } : locale === 'fr' ? {
    en: 'anglais', zh: 'chinois', ja: 'japonais', ko: 'coréen', fr: 'français', de: 'allemand', es: 'espagnol', pt: 'portugais', it: 'italien', ru: 'russe', ar: 'arabe', und: 'langue inconnue'
  } : isZh ? {
    en: '英语', zh: '中文', ja: '日文', ko: '韩文', fr: '法文', de: '德文',
    es: '西班牙文', pt: '葡萄牙文', it: '意大利文', ru: '俄文', ar: '阿拉伯文', und: '未知语言'
  } : {
    en: 'English', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German',
    es: 'Spanish', pt: 'Portuguese', it: 'Italian', ru: 'Russian', ar: 'Arabic', und: 'unknown language'
  };

  function languageLabel(language) {
    return languageLabels[language] || language || copy.unknownLanguage;
  }

  function topicLabel(topic) {
    return topicLabels[topic] || topicLabels.general;
  }

  function nicknameLooksReserved(value) {
    var key = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s._-]+/g, '');
    var reserved = ['admin', 'administrator', 'moderator', 'mod', 'staff', 'official', 'support', 'system', 'team', 'tibo', 'tibomonitor', 'modelyard', 'modelyardcommunity', 'communityadmin', 'verified'];
    return reserved.indexOf(key) !== -1 || /^(?:admin|administrator|moderator|official|staff|support|system|team)\d*$/u.test(key);
  }

  function hasFilters() {
    return Boolean(filters.query || filters.topic || filters.featuredOnly || filters.githubOnly);
  }

  function filterQuery() {
    var params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.topic) params.set('topic', filters.topic);
    if (filters.featuredOnly) params.set('featured', '1');
    if (filters.githubOnly) params.set('github', '1');
    return params;
  }

  function filterUrl() {
    var url = new URL('/api/community/posts', window.location.origin);
    var params = filterQuery();
    params.forEach(function (value, key) { url.searchParams.set(key, value); });
    return url;
  }

  function updateFilterHistory() {
    var url = new URL(window.location.href);
    ['q', 'topic', 'featured', 'github'].forEach(function (key) { url.searchParams.delete(key); });
    var params = filterQuery();
    params.forEach(function (value, key) { url.searchParams.set(key, value); });
    window.history.replaceState({}, '', url.pathname + url.search);
  }

  function syncFiltersFromControls() {
    var search = document.getElementById('communitySearch');
    var topic = document.getElementById('communityTopicFilter');
    filters.query = search && search.value ? search.value.normalize('NFC').trim().slice(0, 80) || null : null;
    filters.topic = topic && topic.value ? topic.value : null;
  }

  function updateResult(total) {
    var result = document.getElementById('communityFeedResult');
    if (!result) return;
    var count = Number(total || 0);
    var suffix = isZh
      ? ' ' + count + ' 条'
      : locale === 'ja'
        ? ' ' + count + ' 件'
        : locale === 'es'
          ? ' ' + count + ' publicación' + (count === 1 ? '' : 'es')
          : locale === 'fr'
            ? ' ' + count + ' publication' + (count === 1 ? '' : 's')
            : ' ' + count + ' post' + (count === 1 ? '' : 's');
    result.textContent = (hasFilters() ? copy.filteredResults : copy.showing) + suffix;
  }

  function updateModeLinks() {
    document.querySelectorAll('.community-filter-mode').forEach(function (link) {
      var href = new URL(link.getAttribute('href') || '/community/', window.location.origin);
      href.searchParams.delete('featured');
      href.searchParams.delete('github');
      var mode = link.dataset.mode || 'all';
      if (filters.query) href.searchParams.set('q', filters.query); else href.searchParams.delete('q');
      if (filters.topic) href.searchParams.set('topic', filters.topic); else href.searchParams.delete('topic');
      if (mode === 'featured') href.searchParams.set('featured', '1');
      if (mode === 'github') href.searchParams.set('github', '1');
      link.setAttribute('href', href.pathname + href.search);
      link.classList.toggle('active', mode === 'featured' ? filters.featuredOnly : mode === 'github' ? filters.githubOnly : !filters.featuredOnly && !filters.githubOnly);
    });
  }

  function setEmptyState() {
    var feedSection = document.querySelector('.community-feed-section');
    if (!feedSection) return;
    var empty = document.createElement('div');
    empty.className = 'community-empty';
    var message = document.createElement('p');
    message.textContent = hasFilters() ? copy.noMatchingPosts : (copy.noPosts || (isZh ? '暂时还没有留言。' : 'No posts yet.'));
    empty.appendChild(message);
    if (hasFilters()) {
      var clear = document.createElement('p');
      var link = document.createElement('a');
      link.href = window.location.pathname;
      link.textContent = copy.clearFilters;
      clear.appendChild(link);
      empty.appendChild(clear);
    } else {
      var first = document.createElement('p');
      first.textContent = copy.firstPost || (isZh ? '来留下第一条消息吧。' : 'Be the first to leave a message.');
      empty.appendChild(first);
    }
    var old = feedSection.querySelector('.community-empty');
    if (old) old.remove();
    var loadMore = document.getElementById('communityLoadMore');
    feedSection.insertBefore(empty, loadMore || null);
  }

  function safeHref(value) {
    try {
      var url = new URL(value, window.location.origin);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch (_error) {
      return null;
    }
  }

  function safeImageHref(value) {
    var href = safeHref(value);
    if (!href) return null;
    try {
      return new URL(href).hostname.toLowerCase() === 'avatars.githubusercontent.com' ? href : null;
    } catch (_error) {
      return null;
    }
  }

  function trimUrl(value) {
    var url = value;
    var suffix = '';
    while (/[.,!?;:]$/.test(url) || /[\])}]$/.test(url)) {
      suffix = url.slice(-1) + suffix;
      url = url.slice(0, -1);
    }
    return { url: url, suffix: suffix };
  }

  function appendTextWithBreaks(parent, value) {
    var parts = String(value || '').split('\n');
    parts.forEach(function (part, index) {
      if (index > 0) parent.appendChild(document.createElement('br'));
      parent.appendChild(document.createTextNode(part));
    });
  }

  function appendCommunityText(parent, value) {
    var pattern = /```[\s\S]*?```|`(?:\\.|[^`])*`|https?:\/\/[^\s<>"'`]+/giu;
    var cursor = 0;
    Array.from(String(value || '').matchAll(pattern)).forEach(function (match) {
      var start = match.index || 0;
      if (start > cursor) appendTextWithBreaks(parent, value.slice(cursor, start));
      var token = match[0];
      if (token.indexOf('```') === 0) {
        var pre = document.createElement('pre');
        pre.className = 'community-code';
        var code = document.createElement('code');
        var codeText = token.slice(3, -3);
        if (codeText.indexOf('\n') === 0) codeText = codeText.slice(1);
        appendTextWithBreaks(code, codeText);
        pre.appendChild(code);
        parent.appendChild(pre);
      } else if (token.indexOf('`') === 0) {
        var inline = document.createElement('code');
        inline.className = 'community-inline-code';
        inline.textContent = token.slice(1, -1);
        parent.appendChild(inline);
      } else {
        var trimmed = trimUrl(token);
        var href = safeHref(trimmed.url);
        if (href) {
          var link = document.createElement('a');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.setAttribute('aria-label', copy.openExternal);
          link.textContent = trimmed.url;
          parent.appendChild(link);
          if (trimmed.suffix) appendTextWithBreaks(parent, trimmed.suffix);
        } else {
          appendTextWithBreaks(parent, token);
        }
      }
      cursor = start + token.length;
    });
    if (cursor < String(value || '').length) appendTextWithBreaks(parent, String(value || '').slice(cursor));
  }

  function relativeTime(iso) {
    var parsedDate = timeApi && typeof timeApi.parseStoredUtc === 'function'
      ? timeApi.parseStoredUtc(iso)
      : new Date(iso);
    var timestamp = parsedDate.getTime();
    if (!Number.isFinite(timestamp)) return iso || '';
    var seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (isZh) {
      if (seconds < 60) return copy.justNow;
      if (seconds < 3600) return Math.floor(seconds / 60) + ' ' + copy.minute;
      if (seconds < 86400) return Math.floor(seconds / 3600) + ' ' + copy.hour;
      if (seconds < 2592000) return Math.floor(seconds / 86400) + ' ' + copy.day;
    } else if (locale === 'ja') {
      if (seconds < 60) return copy.justNow;
      if (seconds < 3600) return Math.floor(seconds / 60) + copy.minute;
      if (seconds < 86400) return Math.floor(seconds / 3600) + copy.hour;
      if (seconds < 2592000) return Math.floor(seconds / 86400) + copy.day;
    } else if (locale === 'es') {
      if (seconds < 60) return copy.justNow;
      if (seconds < 3600) return 'hace ' + Math.floor(seconds / 60) + ' ' + copy.minute;
      if (seconds < 86400) return 'hace ' + Math.floor(seconds / 3600) + ' ' + copy.hour;
      if (seconds < 2592000) return 'hace ' + Math.floor(seconds / 86400) + ' ' + copy.day;
    } else if (locale === 'fr') {
      if (seconds < 60) return copy.justNow;
      if (seconds < 3600) return 'il y a ' + Math.floor(seconds / 60) + ' ' + copy.minute;
      if (seconds < 86400) return 'il y a ' + Math.floor(seconds / 3600) + ' ' + copy.hour;
      if (seconds < 2592000) return 'il y a ' + Math.floor(seconds / 86400) + ' ' + copy.day;
    } else {
      if (seconds < 60) return copy.justNow;
      if (seconds < 3600) return Math.floor(seconds / 60) + ' ' + copy.minute;
      if (seconds < 86400) return Math.floor(seconds / 3600) + ' ' + copy.hour;
      if (seconds < 2592000) return Math.floor(seconds / 86400) + ' ' + copy.day;
    }
    try {
      return new Intl.DateTimeFormat(displayIntlLocale(), {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZone: displayTimezone(), timeZoneName: 'short', hour12: locale === 'en',
      }).format(parsedDate);
    } catch (_error) {
      return iso || '';
    }
  }

  function displayIntlLocale() {
    return timeApi ? timeApi.intlLocale(document.documentElement.lang) : (isZh ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : locale === 'es' ? 'es-ES' : locale === 'fr' ? 'fr-FR' : 'en-US');
  }

  function displayTimezone() {
    if (timeApi) return timeApi.timeZone(document.documentElement.lang);
    return 'UTC';
  }

  function absoluteTime(iso) {
    try {
      var date = timeApi && typeof timeApi.parseStoredUtc === 'function'
        ? timeApi.parseStoredUtc(iso)
        : new Date(iso);
      return new Intl.DateTimeFormat(displayIntlLocale(), {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZone: displayTimezone(), timeZoneName: 'short', hour12: locale === 'en',
      }).format(date);
    } catch (_error) {
      return iso || '';
    }
  }

  function createTime(iso) {
    var time = document.createElement('time');
    time.className = 'community-time';
    time.dateTime = iso || '';
    time.dataset.communityTime = iso || '';
    time.title = absoluteTime(iso);
    time.textContent = relativeTime(iso);
    return time;
  }

  function createMetaFact(label, value) {
    var fact = document.createElement('span');
    var strong = document.createElement('b');
    strong.textContent = label;
    fact.appendChild(strong);
    fact.appendChild(document.createTextNode(' ' + value));
    return fact;
  }

  function createEmbed(embed) {
    if (!embed || !embed.metadata) return null;
    var href = safeHref(embed.canonicalUrl);
    if (!href) return null;
    var metadata = embed.metadata;
    var article = document.createElement('article');
    article.className = 'community-repo-card';
    var link = document.createElement('a');
    link.className = 'community-repo-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    var provider = document.createElement('div');
    provider.className = 'community-repo-provider';
    var imageHref = embed.imageUrl ? safeImageHref(embed.imageUrl) : null;
    if (imageHref) {
      var image = document.createElement('img');
      image.className = 'community-repo-avatar';
      image.src = imageHref;
      image.alt = '';
      image.loading = 'lazy';
      provider.appendChild(image);
    }
    var providerName = document.createElement('span');
    providerName.textContent = 'GitHub';
    provider.appendChild(providerName);
    link.appendChild(provider);
    var heading = document.createElement('h3');
    heading.textContent = String(metadata.owner || '') + ' / ' + String(metadata.repo || '');
    link.appendChild(heading);
    if (embed.description) {
      var description = document.createElement('p');
      description.textContent = embed.description;
      link.appendChild(description);
    }
    var facts = document.createElement('div');
    facts.className = 'community-repo-facts';
    facts.setAttribute('aria-label', copy.repo);
    if (metadata.language) facts.appendChild(createMetaFact(copy.language, metadata.language));
    if (typeof metadata.stars === 'number') facts.appendChild(createMetaFact(copy.stars, metadata.stars.toLocaleString('en-US')));
    if (typeof metadata.forks === 'number') facts.appendChild(createMetaFact(copy.forks, metadata.forks.toLocaleString('en-US')));
    if (metadata.license) facts.appendChild(createMetaFact(copy.license, metadata.license));
    if (facts.childNodes.length) link.appendChild(facts);
    var url = document.createElement('span');
    url.className = 'community-repo-url';
    url.textContent = 'github.com/' + String(metadata.owner || '') + '/' + String(metadata.repo || '') + ' ↗';
    link.appendChild(url);
    article.appendChild(link);
    return article;
  }

  function addMetaSeparator(parent) {
    var separator = document.createElement('span');
    separator.className = 'community-post-meta-separator';
    separator.textContent = '·';
    parent.appendChild(separator);
  }

  function appendVerifiedBadge(parent) {
    var badge = document.createElement('span');
    badge.className = 'community-verified-badge';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', copy.verifiedAdmin);
    badge.title = copy.verifiedAdmin;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '10');
    circle.setAttribute('cy', '10');
    circle.setAttribute('r', '9');
    circle.setAttribute('fill', 'currentColor');
    var check = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    check.setAttribute('d', 'm5.8 10.1 2.7 2.7 5.8-6');
    check.setAttribute('fill', 'none');
    check.setAttribute('stroke', 'white');
    check.setAttribute('stroke-linecap', 'round');
    check.setAttribute('stroke-linejoin', 'round');
    check.setAttribute('stroke-width', '2');
    svg.appendChild(circle);
    svg.appendChild(check);
    badge.appendChild(svg);
    parent.appendChild(badge);
  }

  function appendAiBadge(parent) {
    var badge = document.createElement('span');
    badge.className = 'community-ai-badge';
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', copy.aiAccount);
    badge.title = copy.aiAccount;
    badge.textContent = 'AI';
    parent.appendChild(badge);
  }

  function createPost(post) {
    var li = document.createElement('li');
    li.className = 'community-post';
    li.dataset.postId = String(post.id);
    var article = document.createElement('article');
    var badges = document.createElement('div');
    badges.className = 'community-post-badges';
    var topicBadge = document.createElement('span');
    topicBadge.className = 'community-topic-badge';
    topicBadge.textContent = topicLabel(post.topic || 'general');
    badges.appendChild(topicBadge);
    if (post.isPinned) {
      var pinned = document.createElement('span');
      pinned.className = 'community-post-badge pinned';
      pinned.textContent = copy.pinned;
      badges.appendChild(pinned);
    }
    if (post.isFeatured) {
      var featured = document.createElement('span');
      featured.className = 'community-post-badge featured';
      featured.textContent = copy.featured;
      badges.appendChild(featured);
    }
    if (post.isAnnouncement) {
      var announcement = document.createElement('span');
      announcement.className = 'community-post-badge announcement';
      announcement.textContent = copy.announcement;
      badges.appendChild(announcement);
    }
    article.appendChild(badges);
    var header = document.createElement('header');
    header.className = 'community-post-header';
    var nickname = document.createElement('span');
    nickname.className = 'community-post-nickname';
    nickname.textContent = post.nickname || '';
    header.appendChild(nickname);
    if (post.authorRole === 'admin') appendVerifiedBadge(header);
    if (post.authorType === 'agent') appendAiBadge(header);
    addMetaSeparator(header);
    header.appendChild(createTime(post.createdAt));
    var translated = post.translations && post.translations[locale];
    if (!translated && locale === 'zh') translated = post.contentZh;
    if (!translated && locale === 'en') translated = post.contentEn;
    var displayed = translated || post.originalContent || '';
    var isTranslated = displayed !== (post.originalContent || '');
    var sourceLanguage = String(post.originalLanguage || '').toLowerCase();
    var sourceLocale = sourceLanguage.indexOf('zh') === 0 ? 'zh'
      : sourceLanguage.indexOf('ja') === 0 ? 'ja'
        : sourceLanguage.indexOf('es') === 0 ? 'es'
          : sourceLanguage.indexOf('fr') === 0 ? 'fr'
            : sourceLanguage.indexOf('en') === 0 ? 'en' : null;
    if (!isTranslated && sourceLocale !== locale) li.dataset.localeFallback = 'original';
    if (isTranslated) {
      addMetaSeparator(header);
      var translation = document.createElement('span');
      translation.className = 'community-post-translation';
      translation.textContent = copy.translatedFrom + (isZh || locale === 'ja' ? '' : ' ') + languageLabel(post.originalLanguage);
      header.appendChild(translation);
    }
    article.appendChild(header);
    var content = document.createElement('div');
    content.className = 'community-post-content';
    appendCommunityText(content, displayed);
    article.appendChild(content);
    if (Array.isArray(post.embeds) && post.embeds.length) {
      var embeds = document.createElement('div');
      embeds.className = 'community-post-embeds';
      post.embeds.forEach(function (embed) {
        var card = createEmbed(embed);
        if (card) embeds.appendChild(card);
      });
      if (embeds.childNodes.length) article.appendChild(embeds);
    }
    if (isTranslated) {
      var originalId = 'community-original-' + String(post.id);
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'community-original-toggle';
      toggle.setAttribute('data-original-toggle', '');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', originalId);
      toggle.textContent = copy.showOriginal;
      var original = document.createElement('div');
      original.id = originalId;
      original.className = 'community-original';
      original.hidden = true;
      var originalLabel = document.createElement('div');
      originalLabel.className = 'community-original-label';
      originalLabel.textContent = copy.original + ' · ' + languageLabel(post.originalLanguage);
      original.appendChild(originalLabel);
      var originalContent = document.createElement('div');
      originalContent.className = 'community-post-content';
      appendCommunityText(originalContent, post.originalContent || '');
      original.appendChild(originalContent);
      toggle.addEventListener('click', function () {
        var expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        original.hidden = expanded;
        toggle.textContent = expanded ? copy.showOriginal : copy.hideOriginal;
      });
      article.appendChild(toggle);
      article.appendChild(original);
    }
    li.appendChild(article);
    return li;
  }

  function ensureFeedList() {
    var list = document.getElementById('communityPostList');
    if (list) return list;
    var empty = document.querySelector('.community-empty');
    if (empty) empty.remove();
    var feedSection = document.querySelector('.community-feed-section');
    if (!feedSection) return null;
    list = document.createElement('ol');
    list.id = 'communityPostList';
    list.className = 'community-feed';
    var loadMore = document.getElementById('communityLoadMore');
    feedSection.insertBefore(list, loadMore || null);
    return list;
  }

  function setFormStatus(message, kind) {
    var status = document.getElementById('communityFormStatus');
    if (!status) return;
    status.textContent = message || '';
    status.className = 'community-form-status' + (kind ? ' ' + kind : '');
  }

  function setFeedStatus(message) {
    var status = document.getElementById('communityFeedStatus');
    if (status) status.textContent = message || '';
  }

  function resetTurnstile() {
    if (window.turnstile && turnstileWidgetId !== null && typeof window.turnstile.reset === 'function') {
      window.turnstile.reset(turnstileWidgetId);
    }
    turnstileToken = '';
  }

  var turnstileToken = '';
  var turnstileWidgetId = null;

  function renderTurnstile() {
    var mount = document.getElementById('communityTurnstile');
    if (!mount || !data.turnstileSiteKey) return;
    if (window.turnstile && typeof window.turnstile.render === 'function') {
      turnstileWidgetId = window.turnstile.render(mount, {
        sitekey: data.turnstileSiteKey,
        callback: function (token) { turnstileToken = token || ''; },
        'expired-callback': function () { turnstileToken = ''; },
        'error-callback': function () { turnstileToken = ''; }
      });
      return;
    }
    window.setTimeout(renderTurnstile, 250);
  }

  async function submitPost(event) {
    event.preventDefault();
    var nicknameInput = document.getElementById('communityNickname');
    var topicInput = document.getElementById('communityTopic');
    var contentInput = document.getElementById('communityContent');
    var button = document.getElementById('communityPostButton');
    if (!nicknameInput || !contentInput || !button) return;
    var nickname = nicknameInput.value.normalize('NFC').trim().replace(/[ \t]+/g, ' ');
    var content = contentInput.value.normalize('NFC').trim();
    if (!nickname) return setFormStatus(copy.nicknameRequired, 'error');
    if (!topicInput || !topicInput.value) return setFormStatus(copy.topicRequired, 'error');
    if (!content) return setFormStatus(copy.contentRequired, 'error');
    if (Array.from(nickname).length > Number(data.maxNicknameLength || 32)) return setFormStatus(copy.nicknameTooLong, 'error');
    if (nicknameLooksReserved(nickname)) return setFormStatus(copy.nicknameReserved, 'error');
    if (Array.from(content).length > Number(data.maxContentLength || 2000)) return setFormStatus(copy.contentTooLong, 'error');
    if (!turnstileToken) return setFormStatus(copy.securityCheck, 'error');
    button.disabled = true;
    setFormStatus(copy.posting, 'loading');
    try {
      var response = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname, content: content, topic: topicInput.value, turnstileToken: turnstileToken })
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : copy.postError);
      var post = payload.data;
      contentInput.value = '';
      if (topicInput) topicInput.value = 'general';
      resetTurnstile();
      if (post && post.status === 'approved') {
        await loadFeed(false);
        setFormStatus(copy.posted, 'success');
      } else {
        setFormStatus(copy.pending, 'success');
      }
    } catch (error) {
      setFormStatus(error && error.message ? error.message : copy.postError, 'error');
      resetTurnstile();
    } finally {
      button.disabled = false;
    }
  }

  async function loadFeed(append) {
    var button = document.getElementById('communityLoadMore');
    if (append && (!button || !data.nextCursor || button.disabled)) return;
    if (button) {
      button.disabled = true;
      button.textContent = copy.loading;
    }
    setFeedStatus(copy.loading);
    var url = filterUrl();
    url.searchParams.set('limit', '20');
    if (append && data.nextCursor) url.searchParams.set('cursor', data.nextCursor);
    try {
      var response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok || !Array.isArray(payload.data)) throw new Error(copy.loadError);
      var list = append ? ensureFeedList() : null;
      if (!append) {
        var oldList = document.getElementById('communityPostList');
        if (oldList) oldList.remove();
        var oldEmpty = document.querySelector('.community-feed-section .community-empty');
        if (oldEmpty) oldEmpty.remove();
        list = payload.data.length ? ensureFeedList() : null;
      }
      if (list) payload.data.forEach(function (post) { list.appendChild(createPost(post)); });
      if (!payload.data.length && !append) setEmptyState();
      data.nextCursor = payload.nextCursor || null;
      data.total = Number(payload.total) || 0;
      updateResult(data.total);
      updateModeLinks();
      if (button) {
        if (data.nextCursor) {
          button.hidden = false;
          button.disabled = false;
          button.textContent = copy.loadMore;
          button.dataset.cursor = data.nextCursor;
        } else {
          button.hidden = true;
          button.disabled = false;
          button.textContent = copy.loadMore;
        }
      }
      setFeedStatus('');
      return true;
    } catch (_error) {
      if (button) {
        button.disabled = false;
        button.textContent = copy.loadMore;
      }
      setFeedStatus(copy.loadError);
      return false;
    }
  }

  function loadMore() {
    loadFeed(true);
  }

  function updateTimes() {
    document.querySelectorAll('[data-community-time]').forEach(function (element) {
      var iso = element.getAttribute('data-community-time') || '';
      element.textContent = relativeTime(iso);
      element.title = absoluteTime(iso);
    });
  }

  // Posts are server-rendered for SEO, so bind their controls as well as the
  // controls created later by pagination or a successful post.
  document.querySelectorAll('[data-original-toggle]').forEach(function (toggle) {
    var originalId = toggle.getAttribute('aria-controls');
    var original = originalId ? document.getElementById(originalId) : null;
    if (!original || toggle.dataset.bound === 'true') return;
    toggle.dataset.bound = 'true';
    toggle.addEventListener('click', function () {
      var expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      original.hidden = expanded;
      toggle.textContent = expanded ? copy.showOriginal : copy.hideOriginal;
    });
  });

  var form = document.getElementById('communityComposer');
  if (form && data.postingEnabled) {
    form.addEventListener('submit', submitPost);
    renderTurnstile();
  }
  var filterForm = document.getElementById('communityFeedFilters');
  if (filterForm) {
    filterForm.addEventListener('submit', function (event) {
      event.preventDefault();
      syncFiltersFromControls();
      updateFilterHistory();
      loadFeed(false);
    });
  }
  var topicFilter = document.getElementById('communityTopicFilter');
  if (topicFilter) topicFilter.addEventListener('change', function () {
    syncFiltersFromControls();
    updateFilterHistory();
    loadFeed(false);
  });
  document.querySelectorAll('.community-filter-mode').forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      syncFiltersFromControls();
      var mode = link.dataset.mode || 'all';
      filters.featuredOnly = mode === 'featured';
      filters.githubOnly = mode === 'github';
      updateFilterHistory();
      loadFeed(false);
    });
  });
  var loadButton = document.getElementById('communityLoadMore');
  if (loadButton) loadButton.addEventListener('click', loadMore);
  updateResult(data.total || 0);
  updateModeLinks();
  updateTimes();
  window.setInterval(updateTimes, 60000);
}());
