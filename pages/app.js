(() => {
  "use strict";

  const HOME = "veil://home";
  const SEARCH_PREFIX = "veil://search?q=";
  const SPECTRE_URL = "veil://spectre-web";
  const STORAGE_KEY = "veil-browser-state-v3";
  const SCENES = {
    river: { video: "./assets/river-loop.mp4", poster: "./assets/river-poster.jpg" },
    waves: { video: "./assets/ocean-waves.mp4", poster: "./assets/ocean-waves-poster.jpg" },
    ocean: { video: "./assets/ocean-sky.mp4", poster: "./assets/ocean-sky-poster.jpg" },
  };
  const desktop = window.veilDesktop || null;
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    tabs: $("#tabs"),
    address: $("#address"),
    home: $("#home-page"),
    results: $("#results-page"),
    webviews: $("#webviews"),
    spectre: $("#spectre-page"),
    webviewHost: $("#webview-host"),
    progress: $("#load-progress"),
    pageError: $("#page-error"),
    pageErrorText: $("#page-error-text"),
    resultInput: $("#results-input"),
    resultList: $("#results-list"),
    resultCount: $("#results-count"),
    imageBlock: $("#image-block"),
    imageStrip: $("#image-strip"),
    imageToggle: $("#toggle-images"),
    imageViewer: $("#image-viewer"),
    imageViewerPicture: $("#image-viewer-picture"),
    imageViewerTitle: $("#image-viewer-title"),
    imageViewerOpen: $("#image-viewer-open"),
    shortcuts: $("#bookmark-shortcuts"),
    panel: $("#side-panel"),
    panelBackdrop: $("#panel-backdrop"),
    panelTitle: $("#panel-title"),
    panelKicker: $("#panel-kicker"),
    panelBody: $("#panel-body"),
    suggestions: $("#suggestions"),
    toast: $("#toast"),
    back: $("#back"),
    forward: $("#forward"),
    reload: $("#reload"),
    siteState: $("#site-state"),
    bookmarkCurrent: $("#bookmark-current"),
    riverBackground: $("#river-background"),
  };

  const makeTab = (privateTab = false) => ({
    id: crypto.randomUUID(),
    title: privateTab ? "Приватная вкладка" : "Новая вкладка",
    url: HOME,
    history: [HOME],
    historyIndex: 0,
    private: privateTab,
    favicon: "",
  });

  const defaultState = () => {
    const first = makeTab();
    return {
      tabs: [first],
      activeTabId: first.id,
      bookmarks: [],
      globalHistory: [],
      settings: {
        trackers: true,
        stripReferrer: true,
        doNotTrack: true,
        searchImages: true,
        showBookmarks: true,
        compactMode: false,
        motion: "on",
        zoom: 100,
      },
    };
  };

  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || !Array.isArray(saved.tabs)) return defaultState();
      saved.tabs = saved.tabs.filter((tab) => !tab.private).map((tab) => ({
        ...makeTab(false),
        ...tab,
        private: false,
        history: Array.isArray(tab.history) && tab.history.length ? tab.history : [HOME],
      }));
      if (!saved.tabs.length) saved.tabs = [makeTab()];
      saved.bookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks : [];
      saved.globalHistory = Array.isArray(saved.globalHistory) ? saved.globalHistory : [];
      saved.settings = {
        trackers: true,
        stripReferrer: true,
        doNotTrack: true,
        searchImages: true,
        showBookmarks: true,
        compactMode: false,
        motion: "on",
        zoom: 100,
        ...(saved.settings || {}),
      };
      if (["calm", "max"].includes(saved.settings.motion)) saved.settings.motion = "on";
      if (!saved.tabs.some((tab) => tab.id === saved.activeTabId)) saved.activeTabId = saved.tabs[0].id;
      return saved;
    } catch {
      return defaultState();
    }
  };

  let state = loadState();
  let currentResults = [];
  let currentImages = [];
  let activeFilter = "all";
  let searchRequest = 0;
  let imagesExpanded = true;
  let viewerTargetURL = "";
  let viewerReturnFocus = null;
  let activeScene = localStorage.getItem("veil-scene") || "river";
  let toastTimer = null;
  const views = new Map();
  const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const activeTab = () => state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0];
  const isHome = (url) => url === HOME;
  const isSearch = (url) => url.startsWith(SEARCH_PREFIX);
  const isSpectre = (url) => url === SPECTRE_URL;
  const isWeb = (url) => /^https?:\/\//i.test(url);
  const queryFromURL = (url) => decodeURIComponent(url.slice(SEARCH_PREFIX.length));
  const displayHost = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Spectre web"; }
  };
  const escapeHTML = (value) => {
    const node = document.createElement("span");
    node.textContent = String(value || "");
    return node.innerHTML;
  };
  const safeURL = (value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  };

  const save = () => {
    const persistable = {
      ...state,
      tabs: state.tabs.filter((tab) => !tab.private),
    };
    if (!persistable.tabs.length) {
      const replacement = makeTab();
      persistable.tabs = [replacement];
      persistable.activeTabId = replacement.id;
    } else if (!persistable.tabs.some((tab) => tab.id === persistable.activeTabId)) {
      persistable.activeTabId = persistable.tabs[0].id;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  };

  const showToast = (message) => {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2400);
  };

  const motionEnabled = () => !systemReducedMotion && state.settings.motion !== "off";
  const applyAppearance = () => {
    document.documentElement.classList.toggle("no-motion", !motionEnabled());
    document.documentElement.classList.toggle("motion-calm", state.settings.motion === "calm");
    document.documentElement.classList.toggle("compact", Boolean(state.settings.compactMode));
    document.documentElement.classList.toggle("hide-bookmarks", !state.settings.showBookmarks);
    if (elements.riverBackground) {
      if (motionEnabled()) elements.riverBackground.play().catch(() => {});
      else elements.riverBackground.pause();
    }
    for (const view of views.values()) {
      if (view.dataset.ready === "true" && view.setZoomFactor) {
        view.setZoomFactor(Number(state.settings.zoom || 100) / 100);
      }
    }
  };

  const applyScene = (name) => {
    const scene = SCENES[name] || SCENES.river;
    activeScene = SCENES[name] ? name : "river";
    if (elements.riverBackground) {
      elements.riverBackground.poster = scene.poster;
      const source = elements.riverBackground.querySelector("source");
      if (source.getAttribute("src") !== scene.video) {
        source.src = scene.video;
        elements.riverBackground.load();
      }
      if (motionEnabled()) elements.riverBackground.play().catch(() => {});
    }
    document.querySelectorAll("[data-scene]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.scene === activeScene)));
    localStorage.setItem("veil-scene", activeScene);
  };

  const triggerWarp = (callback) => {
    if (!motionEnabled()) { callback(); return; }
    const warp = $("#page-warp");
    warp.classList.remove("active");
    void warp.offsetWidth;
    warp.classList.add("active");
    setTimeout(callback, 230);
    setTimeout(() => warp.classList.remove("active"), 760);
  };

  const normalizeInput = (raw) => {
    const value = String(raw || "").trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return { type: "url", value };
    if (/^[\w-]+(?:\.[\w-]+)+(?:[/?#].*)?$/i.test(value)) return { type: "url", value: `https://${value}` };
    return { type: "search", value };
  };

  const pushHistory = (tab, url) => {
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    if (tab.history.at(-1) !== url) tab.history.push(url);
    tab.history = tab.history.slice(-150);
    tab.historyIndex = tab.history.length - 1;
  };

  const logVisit = (tab) => {
    if (tab.private || !isWeb(tab.url)) return;
    const existing = state.globalHistory.findIndex((item) => item.url === tab.url);
    if (existing >= 0) state.globalHistory.splice(existing, 1);
    state.globalHistory.unshift({ title: tab.title || displayHost(tab.url), url: tab.url, time: Date.now() });
    state.globalHistory = state.globalHistory.slice(0, 300);
  };

  const updateControls = () => {
    const tab = activeTab();
    elements.back.disabled = tab.historyIndex <= 0;
    elements.forward.disabled = tab.historyIndex >= tab.history.length - 1;
    elements.reload.disabled = isHome(tab.url);
    elements.siteState.textContent = isWeb(tab.url) ? (tab.url.startsWith("https:") ? "◇" : "!") : "◇";
    elements.siteState.title = tab.url.startsWith("https:") ? "Защищённое соединение" : "Страница Spectre web";
    elements.bookmarkCurrent.textContent = state.bookmarks.some((item) => item.url === tab.url) ? "★" : "☆";
  };

  const renderTabs = () => {
    elements.tabs.innerHTML = state.tabs.map((tab) => {
      const favicon = tab.favicon
        ? `<img src="${escapeHTML(tab.favicon)}" alt="" />`
        : tab.private ? "◐" : "V";
      return `<button class="tab ${tab.id === state.activeTabId ? "active" : ""} ${tab.private ? "private" : ""}" data-tab="${tab.id}" role="tab"><span class="tab-favicon">${favicon}</span><span class="tab-title">${escapeHTML(tab.title)}</span><span class="tab-close" data-close="${tab.id}">×</span></button>`;
    }).join("");
    document.title = `${activeTab().title} — Spectre web`;
  };

  const renderBookmarks = () => {
    elements.shortcuts.innerHTML = state.bookmarks.slice(0, 12).map((item) =>
      `<button class="bookmark-chip" data-bookmark-url="${escapeHTML(item.url)}"><span>◆</span>${escapeHTML(item.title || displayHost(item.url))}</button>`,
    ).join("");
  };

  const createWebview = (tab) => {
    let view = views.get(tab.id);
    if (view) return view;
    view = document.createElement("webview");
    view.dataset.tabId = tab.id;
    const partition = tab.private ? `veil-private-${tab.id}` : "persist:veil-main";
    view.setAttribute("partition", partition);
    view.setAttribute("allowpopups", "");
    if (desktop) desktop.protectPartition(partition).catch(() => {});

    view.addEventListener("dom-ready", () => {
      view.dataset.ready = "true";
      if (view.setZoomFactor) view.setZoomFactor(Number(state.settings.zoom || 100) / 100);
    });

    view.addEventListener("did-start-loading", () => {
      if (tab.id === state.activeTabId) {
        elements.progress.style.width = "38%";
        elements.pageError.hidden = true;
      }
    });
    view.addEventListener("did-stop-loading", () => {
      if (tab.id === state.activeTabId) {
        elements.progress.style.width = "100%";
        setTimeout(() => { elements.progress.style.width = "0"; }, 220);
      }
      updateControls();
    });
    view.addEventListener("did-navigate", (event) => syncFromWebview(tab, event.url, true));
    view.addEventListener("did-navigate-in-page", (event) => syncFromWebview(tab, event.url, true));
    view.addEventListener("page-title-updated", (event) => {
      if (!event.title) return;
      tab.title = event.title.slice(0, 100);
      logVisit(tab);
      save();
      renderTabs();
    });
    view.addEventListener("page-favicon-updated", (event) => {
      const favicon = (event.favicons || []).find((item) => /^https?:/i.test(item));
      if (!favicon) return;
      tab.favicon = favicon;
      save();
      renderTabs();
    });
    view.addEventListener("did-fail-load", (event) => {
      if (event.errorCode === -3 || tab.id !== state.activeTabId) return;
      elements.pageErrorText.textContent = event.errorDescription || "Проверьте адрес и подключение к интернету.";
      elements.pageError.hidden = false;
    });
    view.addEventListener("new-window", (event) => {
      event.preventDefault();
      if (safeURL(event.url)) openNewTab(event.url);
    });
    elements.webviewHost.appendChild(view);
    views.set(tab.id, view);
    return view;
  };

  const syncFromWebview = (tab, url, allowPush) => {
    if (!safeURL(url)) return;
    const commanded = views.get(tab.id)?.dataset.commanded;
    if (commanded === url) {
      delete views.get(tab.id).dataset.commanded;
    } else if (allowPush && tab.url !== url) {
      pushHistory(tab, url);
    }
    tab.url = url;
    tab.title = displayHost(url);
    logVisit(tab);
    save();
    if (tab.id === state.activeTabId) elements.address.value = url;
    renderTabs();
    updateControls();
  };

  const showCurrentPage = () => {
    const tab = activeTab();
    elements.address.value = isHome(tab.url) ? "" : isSearch(tab.url) ? queryFromURL(tab.url) : tab.url;
    elements.home.hidden = !isHome(tab.url);
    elements.results.hidden = !isSearch(tab.url);
    elements.webviews.hidden = !isWeb(tab.url);
    elements.spectre.hidden = !isSpectre(tab.url);
    elements.pageError.hidden = true;
    for (const [id, view] of views) view.style.display = id === tab.id && isWeb(tab.url) ? "flex" : "none";

    if (isWeb(tab.url)) {
      if (!desktop) {
        const proxyPath = tab.url.startsWith(location.origin) ? tab.url : `/proxy/${encodeURIComponent(displayHost(tab.url))}`;
        let frame = views.get(tab.id);
        if (!frame) {
          frame = document.createElement("iframe");
          frame.className = "site-frame";
          frame.setAttribute("sandbox", "allow-forms allow-modals allow-popups allow-same-origin allow-scripts");
          elements.webviewHost.appendChild(frame);
          views.set(tab.id, frame);
        }
        frame.src = proxyPath;
        frame.style.display = "block";
        elements.pageError.hidden = true;
      } else {
        const view = createWebview(tab);
        view.style.display = "flex";
        if (view.getURL() !== tab.url) {
          view.dataset.commanded = tab.url;
          view.src = tab.url;
        }
      }
    } else if (isSearch(tab.url)) {
      const query = queryFromURL(tab.url);
      elements.resultInput.value = query;
      runSearch(query);
    }
    const visiblePage = isHome(tab.url) ? elements.home : isSearch(tab.url) ? elements.results : isSpectre(tab.url) ? elements.spectre : null;
    if (visiblePage && motionEnabled()) {
      visiblePage.classList.remove("page-enter");
      void visiblePage.offsetWidth;
      visiblePage.classList.add("page-enter");
      setTimeout(() => visiblePage.classList.remove("page-enter"), 650);
    }
    renderTabs();
    updateControls();
  };

  const navigateTo = (raw, options = {}) => {
    if (options.animate !== false) {
      triggerWarp(() => navigateTo(raw, { ...options, animate: false }));
      return;
    }
    const normalized = normalizeInput(raw);
    if (!normalized) return;
    const tab = activeTab();
    const url = normalized.type === "search" ? `${SEARCH_PREFIX}${encodeURIComponent(normalized.value)}` : normalized.value;
    if (options.push !== false) pushHistory(tab, url);
    tab.url = url;
    tab.title = isTikTok ? "Spectre web" : normalized.type === "search" ? `${normalized.value} — Поиск` : displayHost(url);
    tab.favicon = "";
    save();
    showCurrentPage();
  };

  const goHome = () => {
    const tab = activeTab();
    if (!isHome(tab.url)) pushHistory(tab, HOME);
    tab.url = HOME;
    tab.title = tab.private ? "Приватная вкладка" : "Новая вкладка";
    tab.favicon = "";
    save();
    showCurrentPage();
    setTimeout(() => $("#hero-input").focus(), 20);
  };

  const openNewTab = (url = HOME, privateTab = false) => {
    const tab = makeTab(privateTab);
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    save();
    if (url !== HOME) navigateTo(url);
    else showCurrentPage();
  };

  const closeTab = (id) => {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    views.get(id)?.remove();
    views.delete(id);
    state.tabs.splice(index, 1);
    if (!state.tabs.length) state.tabs.push(makeTab());
    if (!state.tabs.some((tab) => tab.id === state.activeTabId)) {
      state.activeTabId = state.tabs[Math.max(0, index - 1)].id;
    }
    save();
    showCurrentPage();
  };

  const moveHistory = (delta) => {
    const tab = activeTab();
    const next = tab.historyIndex + delta;
    if (next < 0 || next >= tab.history.length) return;
    tab.historyIndex = next;
    tab.url = tab.history[next];
    tab.title = isHome(tab.url) ? "Новая вкладка" : isSearch(tab.url) ? `${queryFromURL(tab.url)} — Поиск` : displayHost(tab.url);
    save();
    showCurrentPage();
  };

  const renderResults = () => {
    const filtered = activeFilter === "all"
      ? currentResults
      : currentResults.filter((item) => (item.sources || [item.source]).includes(activeFilter));
    elements.resultCount.textContent = `${filtered.length} результатов`;
    if (!filtered.length) {
      elements.resultList.innerHTML = '<div class="empty-results"><b>Ничего не найдено</b><span>Попробуйте изменить запрос или проверить подключение.</span></div>';
      return;
    }
    elements.resultList.innerHTML = filtered.map((item) => {
      const icon = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(displayHost(item.url))}.ico`;
      const domain = displayHost(item.url).replace(/^www\./i, "");
      const networkDomain = `${domain}.spec`;
      return `<button class="result-card" data-result-url="${escapeHTML(item.url)}" data-proxy-path="/proxy/${encodeURIComponent(networkDomain)}"><span class="result-top"><img class="result-icon" src="${icon}" alt="" loading="lazy" referrerpolicy="no-referrer" /><span class="result-host">${escapeHTML(networkDomain)}</span></span><h3>${escapeHTML(item.title || domain)}</h3><p>${escapeHTML(item.snippet || "Открыть страницу")}</p></button>`;
    }).join("");
  };

  const renderImages = () => {
    elements.imageBlock.hidden = !state.settings.searchImages || currentImages.length === 0;
    elements.imageStrip.classList.toggle("collapsed", !imagesExpanded);
    elements.imageToggle.textContent = imagesExpanded ? "Скрыть" : "Показать";
    elements.imageToggle.setAttribute("aria-expanded", String(imagesExpanded));
    elements.imageStrip.innerHTML = currentImages.slice(0, 10).map((item) => {
      const target = safeURL(item.url) || safeURL(item.image) || "";
      const image = safeURL(item.image) || safeURL(item.thumbnail) || "";
      return `<button class="image-card" data-image-src="${escapeHTML(image)}" data-image-url="${escapeHTML(target)}" data-image-title="${escapeHTML(item.title || displayHost(target))}" title="Раскрыть изображение"><img src="${escapeHTML(item.thumbnail || item.image)}" alt="${escapeHTML(item.title || "Результат поиска")}" loading="lazy" referrerpolicy="no-referrer" /><span>${escapeHTML(item.title || displayHost(target))}</span></button>`;
    }).join("");
  };

  const closeImageViewer = () => {
    elements.imageViewer.hidden = true;
    elements.imageViewerPicture.removeAttribute("src");
    viewerTargetURL = "";
    viewerReturnFocus?.focus();
    viewerReturnFocus = null;
  };

  const openImageViewer = (card) => {
    const image = safeURL(card.dataset.imageSrc);
    if (!image) return;
    viewerReturnFocus = card;
    viewerTargetURL = safeURL(card.dataset.imageUrl) || "";
    elements.imageViewerPicture.src = image;
    elements.imageViewerPicture.alt = card.dataset.imageTitle || "Изображение из результатов поиска";
    elements.imageViewerTitle.textContent = card.dataset.imageTitle || "Изображение";
    elements.imageViewerOpen.hidden = !viewerTargetURL;
    elements.imageViewer.hidden = false;
    $("#image-viewer-close").focus();
  };

  async function runSearch(query) {
    const request = ++searchRequest;
    activeFilter = "all";
    $("#filter-tabs").querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.filter === "all"));
    elements.resultCount.textContent = "Объединяем результаты…";
    currentImages = [];
    renderImages();
    elements.resultList.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    if (!desktop) {
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
        const payload = await response.json();
        currentResults = payload?.data || [];
        renderResults();
      } catch {
        currentResults = [];
        elements.resultList.innerHTML = '<div class="empty-results"><b>Не удалось выполнить поиск</b><span>Проверьте подключение и попробуйте ещё раз.</span></div>';
      }
      return;
    }
    try {
      const response = await desktop.search(query);
      if (request !== searchRequest) return;
      currentResults = Array.isArray(response) ? response : (response?.results || []);
      currentImages = Array.isArray(response?.images) ? response.images : [];
      renderImages();
      renderResults();
    } catch {
      if (request !== searchRequest) return;
      currentResults = [];
      elements.resultList.innerHTML = '<div class="empty-results"><b>Поисковые источники не ответили</b><span>Проверьте интернет и повторите запрос.</span></div>';
      elements.resultCount.textContent = "Ошибка поиска";
    }
  }

  const toggleBookmark = () => {
    const tab = activeTab();
    if (!isWeb(tab.url)) return showToast("Откройте сайт, чтобы добавить его в закладки");
    const index = state.bookmarks.findIndex((item) => item.url === tab.url);
    if (index >= 0) {
      state.bookmarks.splice(index, 1);
      showToast("Закладка удалена");
    } else {
      state.bookmarks.unshift({ title: tab.title || displayHost(tab.url), url: tab.url });
      showToast("Добавлено в закладки");
    }
    save();
    renderBookmarks();
    updateControls();
  };

  const closePanel = () => {
    elements.panel.hidden = true;
    elements.panelBackdrop.hidden = true;
  };

  const showPanel = (type) => {
    elements.panel.hidden = false;
    elements.panelBackdrop.hidden = false;
    if (type === "privacy" || type === "settings") {
      elements.panelKicker.textContent = "ЦЕНТР УПРАВЛЕНИЯ";
      elements.panelTitle.textContent = "Расширенные настройки";
      elements.panelBody.innerHTML = `
        <p class="panel-section-title">Конфиденциальность</p>
        <div class="panel-row"><span class="row-copy"><b>Блокировка трекеров</b><small>Известные рекламные и аналитические домены</small></span><button class="toggle ${state.settings.trackers ? "on" : ""}" data-setting="trackers"></button></div>
        <div class="panel-row"><span class="row-copy"><b>Скрытие Referrer</b><small>Не передавать предыдущий адрес сайту</small></span><button class="toggle ${state.settings.stripReferrer ? "on" : ""}" data-setting="stripReferrer"></button></div>
        <div class="panel-row"><span class="row-copy"><b>Do Not Track</b><small>Отправлять сайтам заголовок DNT: 1</small></span><button class="toggle ${state.settings.doNotTrack ? "on" : ""}" data-setting="doNotTrack"></button></div>
        <div class="panel-row"><span class="row-copy"><b>Защита WebRTC</b><small>Локальный IP не отправляется напрямую</small></span><span>✓</span></div>
        <div class="panel-row"><span class="row-copy"><b>Камера, микрофон и геолокация</b><small>Опасные разрешения запрещены на уровне Chromium</small></span><span>✓</span></div>
        <p class="panel-section-title">Поиск и интерфейс</p>
        <div class="panel-row"><span class="row-copy"><b>Картинки в выдаче</b><small>Показывать изображения в результатах</small></span><button class="toggle ${state.settings.searchImages ? "on" : ""}" data-setting="searchImages"></button></div>
        <div class="panel-row"><span class="row-copy"><b>Панель закладок</b><small>Показывать под адресной строкой</small></span><button class="toggle ${state.settings.showBookmarks ? "on" : ""}" data-setting="showBookmarks"></button></div>
        <div class="panel-row"><span class="row-copy"><b>Компактный режим</b><small>Уменьшить панели браузера</small></span><button class="toggle ${state.settings.compactMode ? "on" : ""}" data-setting="compactMode"></button></div>
        <div class="panel-row"><span class="row-copy"><b>Анимации</b><small>Включить или полностью остановить эффекты</small></span><span class="setting-choice"><button data-choice="motion" data-value="on" class="${state.settings.motion !== "off" ? "on" : ""}">Включены</button><button data-choice="motion" data-value="off" class="${state.settings.motion === "off" ? "on" : ""}">Выключены</button></span></div>
        <div class="panel-row"><span class="row-copy"><b>Масштаб сайтов</b><small>Применяется ко всем вкладкам</small></span><span class="setting-choice"><button data-choice="zoom" data-value="80" class="${state.settings.zoom === 80 ? "on" : ""}">80%</button><button data-choice="zoom" data-value="100" class="${state.settings.zoom === 100 ? "on" : ""}">100%</button><button data-choice="zoom" data-value="120" class="${state.settings.zoom === 120 ? "on" : ""}">120%</button></span></div>
        <p class="panel-section-title">Данные</p>
        <button class="danger-action" id="clear-all-data">Очистить историю, cookie и кэш</button>
        <p class="settings-note">Spectre web уменьшает слежение, но не гарантирует полную анонимность. Для этого дополнительно нужен доверенный VPN или Tor.</p>`;
    } else if (type === "history") {
      elements.panelKicker.textContent = "ЛОКАЛЬНЫЕ ДАННЫЕ";
      elements.panelTitle.textContent = "История";
      const rows = state.globalHistory.slice(0, 80).map((item) => `<button class="panel-action history-link" data-history-url="${escapeHTML(item.url)}"><span>◷</span><span><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.url)}</small></span></button>`).join("");
      elements.panelBody.innerHTML = `${rows || '<p style="color:var(--muted);font-size:12px">История пока пустая.</p>'}<button class="danger-action" id="clear-history">Очистить историю и данные сайтов</button>`;
    } else if (type === "bookmarks") {
      elements.panelKicker.textContent = "БЫСТРЫЙ ДОСТУП";
      elements.panelTitle.textContent = "Закладки";
      const rows = state.bookmarks.map((item) => `<button class="panel-action history-link" data-history-url="${escapeHTML(item.url)}"><span>◆</span><span><b>${escapeHTML(item.title)}</b><small>${escapeHTML(item.url)}</small></span></button>`).join("");
      elements.panelBody.innerHTML = `${rows || '<p style="color:var(--muted);font-size:12px">Закладок пока нет.</p>'}<button class="danger-action" id="panel-import">Импортировать из Chrome</button>`;
    } else {
      elements.panelKicker.textContent = "SPECTRE WEB";
      elements.panelTitle.textContent = "Меню";
      elements.panelBody.innerHTML = `
        <button class="panel-action" data-panel-action="new"><span>＋</span><span>Новая вкладка</span></button>
        <button class="panel-action" data-panel-action="private"><span>◐</span><span>Приватная вкладка</span></button>
        <button class="panel-action" data-panel-action="bookmarks"><span>◆</span><span>Закладки</span></button>
        <button class="panel-action" data-panel-action="history"><span>◷</span><span>История</span></button>
        <button class="panel-action" data-panel-action="import"><span>↳</span><span>Импорт из Chrome</span></button>
        <button class="panel-action" data-panel-action="privacy"><span>◈</span><span>Расширенные настройки</span></button>`;
    }
  };

  const importChrome = async () => {
    closePanel();
    if (!desktop) return showToast("Импорт доступен в Desktop-версии");
    showToast("Читаем локальный профиль Chrome…");
    try {
      const imported = await desktop.importChrome();
      if (!imported.found) return showToast("Профиль Chrome не найден");
      const knownBookmarks = new Set(state.bookmarks.map((item) => item.url));
      const knownHistory = new Set(state.globalHistory.map((item) => item.url));
      for (const item of imported.bookmarks || []) if (!knownBookmarks.has(item.url)) state.bookmarks.push(item);
      for (const item of imported.history || []) if (!knownHistory.has(item.url)) state.globalHistory.push({ ...item, time: Date.now() });
      state.globalHistory = state.globalHistory.slice(0, 300);
      save();
      renderBookmarks();
      showToast(`Импортировано: ${imported.bookmarks.length} закладок, ${imported.history.length} страниц`);
    } catch {
      showToast("Не удалось прочитать данные Chrome");
    }
  };

  let suggestionItems = [];
  let suggestionIndex = -1;
  let suggestionInput = null;
  const hideSuggestions = () => { elements.suggestions.hidden = true; suggestionItems = []; suggestionIndex = -1; };
  const renderSuggestions = (input, items) => {
    suggestionInput = input;
    suggestionItems = items;
    suggestionIndex = -1;
    if (!items.length) return hideSuggestions();
    const rect = input.getBoundingClientRect();
    elements.suggestions.style.left = `${rect.left}px`;
    elements.suggestions.style.top = `${rect.bottom + 6}px`;
    elements.suggestions.style.width = `${rect.width}px`;
    elements.suggestions.innerHTML = items.map((item, index) => `<button class="suggestion" data-suggestion="${index}"><span>${item.type === "url" ? "◇" : "⌕"}</span><span>${escapeHTML(item.text)}</span><small>${item.label || ""}</small></button>`).join("");
    elements.suggestions.hidden = false;
  };
  const attachSuggestions = (input) => {
    let request = 0;
    input.addEventListener("input", async () => {
      const value = input.value.trim();
      const current = ++request;
      if (value.length < 2) return hideSuggestions();
      const local = [];
      const seen = new Set();
      const add = (text, type, label) => {
        if (!text || seen.has(text.toLowerCase()) || local.length >= 8) return;
        seen.add(text.toLowerCase()); local.push({ text, type, label });
      };
      for (const item of [...state.bookmarks, ...state.globalHistory]) {
        if (`${item.title} ${item.url}`.toLowerCase().includes(value.toLowerCase())) add(item.url, "url", item.title.slice(0, 28));
      }
      if (desktop) {
        try {
          const remote = await desktop.suggest(value);
          if (current !== request) return;
          for (const item of remote || []) add(item, "search", "Veil");
        } catch { /* local suggestions still work */ }
      }
      if (current === request) renderSuggestions(input, local);
    });
    input.addEventListener("keydown", (event) => {
      if (elements.suggestions.hidden) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        suggestionIndex = event.key === "ArrowDown" ? Math.min(suggestionIndex + 1, suggestionItems.length - 1) : Math.max(suggestionIndex - 1, 0);
        elements.suggestions.querySelectorAll(".suggestion").forEach((node, index) => node.classList.toggle("active", index === suggestionIndex));
      } else if (event.key === "Enter" && suggestionIndex >= 0) {
        event.preventDefault();
        input.value = suggestionItems[suggestionIndex].text;
        hideSuggestions();
        input.form.requestSubmit();
      } else if (event.key === "Escape") hideSuggestions();
    });
    input.addEventListener("blur", () => setTimeout(hideSuggestions, 120));
  };

  elements.tabs.addEventListener("click", (event) => {
    const close = event.target.closest("[data-close]");
    if (close) { event.stopPropagation(); closeTab(close.dataset.close); return; }
    const tab = event.target.closest("[data-tab]");
    if (tab) { state.activeTabId = tab.dataset.tab; save(); showCurrentPage(); }
  });
  $("#new-tab").onclick = () => openNewTab();
  $("#home-button").onclick = goHome;
  $("#results-home").onclick = goHome;
  $("#back").onclick = () => moveHistory(-1);
  $("#forward").onclick = () => moveHistory(1);
  $("#reload").onclick = () => {
    const tab = activeTab();
    if (isSearch(tab.url)) runSearch(queryFromURL(tab.url));
    else if (isWeb(tab.url)) views.get(tab.id)?.reload();
  };
  $("#retry-page").onclick = () => {
    const tab = activeTab();
    if (!desktop && isWeb(tab.url)) return;
    views.get(tab.id)?.reload();
  };
  elements.bookmarkCurrent.onclick = toggleBookmark;
  $("#privacy").onclick = () => showPanel("privacy");
  $("#menu").onclick = () => showPanel("menu");
  $("#panel-close").onclick = closePanel;
  elements.panelBackdrop.onclick = closePanel;
  $("#quick-private").onclick = () => openNewTab(HOME, true);
  document.querySelectorAll("[data-open]").forEach((button) => { button.onclick = () => navigateTo(button.dataset.open); });
  elements.shortcuts.onclick = (event) => { const item = event.target.closest("[data-bookmark-url]"); if (item) navigateTo(item.dataset.bookmarkUrl); };
  elements.resultList.onclick = (event) => {
    const result = event.target.closest("[data-result-url]");
    if (!result) return;
    if (!desktop && result.dataset.proxyPath) window.location.assign(result.dataset.proxyPath);
    else openNewTab(result.dataset.resultUrl);
  };
  elements.imageToggle.onclick = () => { imagesExpanded = !imagesExpanded; renderImages(); };
  elements.imageStrip.onclick = (event) => { const card = event.target.closest("[data-image-src]"); if (card) openImageViewer(card); };
  $("#image-viewer-close").onclick = closeImageViewer;
  elements.imageViewer.onclick = (event) => { if (event.target === elements.imageViewer) closeImageViewer(); };
  elements.imageViewerOpen.onclick = () => { const target = viewerTargetURL; closeImageViewer(); if (target) navigateTo(target); };
  $("#filter-tabs").onclick = (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    activeFilter = button.dataset.filter;
    $("#filter-tabs").querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    renderResults();
  };
  elements.panelBody.onclick = async (event) => {
    const history = event.target.closest("[data-history-url]");
    if (history) { closePanel(); navigateTo(history.dataset.historyUrl); return; }
    const setting = event.target.closest("[data-setting]");
    if (setting) {
      const key = setting.dataset.setting;
      state.settings[key] = !state.settings[key];
      save();
      await desktop?.updatePrivacy({ [key]: state.settings[key] });
      applyAppearance();
      showPanel("privacy");
      return;
    }
    const choice = event.target.closest("[data-choice]");
    if (choice) {
      const key = choice.dataset.choice;
      state.settings[key] = key === "zoom" ? Number(choice.dataset.value) : choice.dataset.value;
      save();
      applyAppearance();
      if (key === "motion") showToast(state.settings.motion === "off" ? "Анимации выключены" : "Анимации включены");
      showPanel("settings");
      return;
    }
    if (event.target.closest("#clear-history")) {
      state.globalHistory = [];
      save();
      await desktop?.clearData();
      showPanel("history");
      showToast("История и данные сайтов очищены");
      return;
    }
    if (event.target.closest("#clear-all-data")) {
      state.globalHistory = [];
      save();
      await desktop?.clearData();
      showPanel("settings");
      showToast("История, cookie и кэш очищены");
      return;
    }
    if (event.target.closest("#panel-import")) { importChrome(); return; }
    const action = event.target.closest("[data-panel-action]")?.dataset.panelAction;
    if (action === "new") { closePanel(); openNewTab(); }
    if (action === "private") { closePanel(); openNewTab(HOME, true); }
    if (action === "bookmarks") showPanel("bookmarks");
    if (action === "history") showPanel("history");
    if (action === "privacy") showPanel("privacy");
    if (action === "import") importChrome();
  };
  $("#address-form").onsubmit = (event) => { event.preventDefault(); hideSuggestions(); navigateTo(elements.address.value); };
  $("#hero-search").onsubmit = (event) => { event.preventDefault(); hideSuggestions(); navigateTo($("#hero-input").value); };
  $("#results-search").onsubmit = (event) => { event.preventDefault(); hideSuggestions(); navigateTo(elements.resultInput.value); };
  $("#scene-switcher").onclick = (event) => { const button = event.target.closest("[data-scene]"); if (button) applyScene(button.dataset.scene); };
  elements.suggestions.onmousedown = (event) => {
    const item = event.target.closest("[data-suggestion]");
    if (!item || !suggestionInput) return;
    event.preventDefault();
    suggestionInput.value = suggestionItems[Number(item.dataset.suggestion)].text;
    hideSuggestions();
    suggestionInput.form.requestSubmit();
  };
  $("#window-controls").onclick = (event) => {
    const action = event.target.closest("[data-window]")?.dataset.window;
    if (action) desktop?.windowAction(action);
  };
  if (desktop?.platform === "darwin") $("#window-controls").hidden = true;

  attachSuggestions(elements.address);
  attachSuggestions($("#hero-input"));
  attachSuggestions(elements.resultInput);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.imageViewer.hidden) { event.preventDefault(); closeImageViewer(); return; }
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "t" || key === "е") { event.preventDefault(); openNewTab(); }
    if (key === "w" || key === "ц") { event.preventDefault(); closeTab(activeTab().id); }
    if (key === "l" || key === "д") { event.preventDefault(); elements.address.focus(); elements.address.select(); }
    if (key === "r" || key === "к") { event.preventDefault(); $("#reload").click(); }
    if ((event.shiftKey && key === "n") || (event.shiftKey && key === "т")) { event.preventDefault(); openNewTab(HOME, true); }
  });
  desktop?.onNewTab(() => openNewTab());
  desktop?.onPrivateTab(() => openNewTab(HOME, true));
  desktop?.onOpenURL((url) => openNewTab(url));
  desktop?.updatePrivacy(state.settings).catch(() => {});

  applyAppearance();
  applyScene(activeScene);
  renderBookmarks();
  showCurrentPage();
})();
