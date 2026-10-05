(() => {
  // Delegierte Listener am document: greifen auch für Blöcke, die Theme-Editor oder Variantenwechsel neu rendern,
  // ohne die ganze Seite per MutationObserver zu beobachten.
  let active = null; // geöffnetes Modal: { dialog, body, media, trigger, w, h, inlineW, zoomed }

  const elementOf = (e) => (e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement);

  // Modal: zuerst ganz sichtbar, solange das deutlich größer ist als im Shop (sonst auf Breite eingepasst, vertikal scrollbar).
  // Lupe oder Tipp auf die Grafik schaltet auf Originalgröße zum Verschieben.
  const MIN_ENLARGE = 1.5;
  const layout = () => {
    const { dialog, body, media, w, h, inlineW } = active;
    media.style.width = '0px'; // Platz ohne Scrollbalken messen
    const cs = getComputedStyle(body);
    const availW = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const contain = (availH * w) / h;
    const fitted = Math.max(1, Math.floor(Math.min(w, availW, Math.max(contain, inlineW * MIN_ENLARGE))));
    const zoomable = fitted < w - 1;
    if (!zoomable) active.zoomed = false;
    media.style.width = `${active.zoomed ? w : fitted}px`;
    dialog.classList.toggle('is-zoomable', zoomable);
    dialog.classList.toggle('is-zoomed', active.zoomed);
    const toggle = dialog.querySelector('[data-euw-zoom-toggle]');
    toggle.hidden = !zoomable;
    toggle.setAttribute('aria-pressed', String(active.zoomed));
    toggle.setAttribute('aria-label', active.zoomed ? toggle.dataset.labelOut : toggle.dataset.labelIn);
  };

  // Zoomen um einen Ankerpunkt (Tipp-Position oder Mitte), damit die angetippte Stelle unter dem Finger bleibt.
  const setZoom = (zoomed, x, y) => {
    const { body, media } = active;
    const b = body.getBoundingClientRect();
    const ax = x ?? b.left + body.clientWidth / 2;
    const ay = y ?? b.top + body.clientHeight / 2;
    const r = media.getBoundingClientRect();
    const fx = (ax - r.left) / r.width;
    const fy = (ay - r.top) / r.height;
    active.zoomed = zoomed;
    layout();
    const n = media.getBoundingClientRect();
    body.scrollLeft += n.left + fx * n.width - ax;
    body.scrollTop += n.top + fy * n.height - ay;
  };

  const setup = (dialog) => {
    if (dialog.dataset.euwReady) return;
    dialog.dataset.euwReady = '1';
    dialog.addEventListener('click', (e) => {
      const el = elementOf(e);
      if (!active || !el) return;
      // Hintergrund, leere Fläche um die Grafik oder Schließen-Knopf
      if (el === dialog || el === active.body || el.closest('[data-euw-close]')) return dialog.close();
      if (!dialog.classList.contains('is-zoomable')) return;
      if (el.closest('[data-euw-zoom-toggle]')) return setZoom(!active.zoomed);
      if (el.closest('[data-euw-modal-media]')) setZoom(!active.zoomed, e.clientX, e.clientY);
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return; // "close" kommt verzögert; inzwischen schon wieder geöffnet
      document.documentElement.classList.remove('euw-modal-open');
      dialog.classList.remove('is-zoomable', 'is-zoomed');
      dialog.querySelector('[data-euw-modal-media]').replaceChildren();
      dialog.querySelector('[data-euw-modal-foot]')?.replaceChildren();
      const trigger = active?.trigger;
      active = null;
      if (trigger?.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'false');
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  };

  // Eine "Einheit" ist eine amtliche Grafik samt Link (Mitteilung oder GARAN). Geöffnet wird sie über die Grafik
  // selbst (data-euw-zoom) oder über den Satz zu den Gewährleistungsrechten (data-euw-open, Praxisleitlinien 2.3).
  const openModal = (trigger) => {
    const unitId = trigger.dataset.euwOpen || trigger.dataset.euwOpenNarrow;
    const unit = unitId ? document.getElementById(unitId) : trigger.closest('[data-euw-unit]');
    const dialog = trigger.closest('.euw')?.querySelector('[data-euw-modal]');
    const source = unit?.querySelector('[data-euw-zoom-media]');
    // Ohne <dialog>-Unterstützung bleibt es bei der normalen Darstellung im Shop
    if (!dialog || !source || typeof dialog.showModal !== 'function' || dialog.open) return false;
    setup(dialog);
    const clone = source.cloneNode(true);
    if (clone.tagName.toLowerCase() === 'img') {
      clone.removeAttribute('loading');
    } else {
      clone.removeAttribute('aria-hidden');
      clone.setAttribute('role', 'img');
      clone.setAttribute('aria-label', unit.dataset.euwZoomLabel || '');
    }
    const media = dialog.querySelector('[data-euw-modal-media]');
    media.replaceChildren(clone);
    // Link zum Ziel des QR-Codes muss auch hier verfügbar sein
    const link = unit.querySelector('[data-euw-link]');
    dialog.querySelector('[data-euw-modal-foot]')?.replaceChildren(...(link ? [link.cloneNode(true)] : []));
    // Inhalt eines geschlossenen <details> hat in Chrome trotzdem Maße -> echte Sichtbarkeit prüfen
    const visible = source.checkVisibility ? source.checkVisibility() : !!source.offsetParent;
    const inlineW = visible ? source.getBoundingClientRect().width : 0;
    active = {
      dialog, media, trigger,
      body: dialog.querySelector('[data-euw-modal-body]'),
      w: Number(unit.dataset.euwZoomW) || 1000,
      h: Number(unit.dataset.euwZoomH) || 1000,
      // Im Shop nicht sichtbar (eingeklappte Mitteilung, geschachteltes GARAN): Mitteilung auf Fensterbreite einpassen,
      // damit der Text lesbar ist; GARAN-Label ganz zeigen (data-euw-fit="contain")
      inlineW: inlineW || (unit.dataset.euwFit === 'contain' ? 0 : Infinity),
      zoomed: false,
    };
    if (trigger.hasAttribute('aria-expanded')) trigger.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('euw-modal-open');
    dialog.showModal();
    layout();
    active.body.scrollTo(0, 0);
    return true;
  };

  // Grafik, Satz zu den Gewährleistungsrechten oder geschachteltes GARAN-Label (<summary>): der erste Klick, Tipp oder
  // Enter öffnet die vollständige Grafik. Klappt das Modal nicht, bleibt das native Aufklappen von <details>.
  // Aufklappen per Klick (<summary data-euw-open-narrow>): ab dieser Breite klappt die Mitteilung inline auf, schmaler wäre
  // sie bei Standardgröße nicht lesbar (Fließtext < 12 px) -> große Ansicht. Wert wie die Container-Abfrage im CSS.
  const INLINE_MIN_WIDTH = 500;
  document.addEventListener('click', (e) => {
    const trigger = elementOf(e)?.closest('[data-euw-zoom], [data-euw-open], [data-euw-open-narrow]');
    if (!trigger) return;
    if (trigger.dataset.euwOpenNarrow) {
      const unit = document.getElementById(trigger.dataset.euwOpenNarrow);
      if (!unit || unit.open || unit.getBoundingClientRect().width >= INLINE_MIN_WIDTH) return; // natives Auf-/Zuklappen
    }
    if (openModal(trigger)) e.preventDefault();
  });

  window.addEventListener('resize', () => { if (active) layout(); }, { passive: true });

  // GARAN je Variante (snippets/euw-garan.liquid): beim Variantenwechsel das passende Label zeigen. Die gewählte Variante
  // steht im Feld name="id" des Produktformulars (alle Themes), ersatzweise in ?variant=.
  const syncVariants = () => {
    document.querySelectorAll('[data-euw-garan-set]').forEach((set) => {
      const scope = set.closest('.shopify-section') || document;
      const field = scope.querySelector('form[action*="/cart/add"] [name="id"]') || document.querySelector('form[action*="/cart/add"] [name="id"]');
      const id = field?.value || new URL(location.href).searchParams.get('variant');
      const units = [...set.children].filter((el) => el.hasAttribute('data-euw-variant'));
      const match = units.find((u) => u.dataset.euwVariant === String(id)) || units.find((u) => u.dataset.euwVariant === 'default');
      units.forEach((u) => { u.hidden = u !== match; });
    });
  };
  // Themes setzen die Variante teils erst nach eigenem Abruf: sofort und kurz danach noch einmal prüfen
  const queueSync = () => { requestAnimationFrame(syncVariants); setTimeout(syncVariants, 400); };
  ['change', 'variant:change', 'shopify:section:load'].forEach((type) => document.addEventListener(type, queueSync));
  window.addEventListener('popstate', queueSync);
})();
