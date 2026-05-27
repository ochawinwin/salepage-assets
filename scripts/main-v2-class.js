/**
 * main-v2-class.js — FutureSkill Sale Page Library (CLASS / Executive edition)
 * Version: 1.0.0
 *
 * Why this file exists:
 *   The online-course library (main-v2.js) ALWAYS creates a payment cart and
 *   redirects to Linkpay after the webhook. Class / Executive landing pages work
 *   differently — they register a LEAD only ("cod" landing_type): the form posts
 *   to the lead webhook, then redirects to the thank-you page. The team contacts
 *   the lead back. NO payment cart, NO Linkpay redirect.
 *
 *   This file keeps the same public API — FS.bootstrap(FS_CONFIG) — but uses the
 *   class-style parameter handling found in LikeMeX/landing-scripts (main-class):
 *     • product config (set1 → sku / price / discountCode) drives the hidden sku/price
 *     • course  is derived from sku
 *     • mkter   is derived from ads_opt (unless affiliate)
 *     • a single "hidden" JSON blob mirrors the full hidden config (+ runtime values)
 *     • deal_id / px / landing_url generated at runtime
 *     • channel_name can be overridden from the URL
 *   On submit (landing_type === 'cod') → POST lead webhook → redirect to redirect_url.
 *
 * Usage (unchanged):
 *   <script>const FS_CONFIG = { ... };</script>
 *   <script src="main-v2-class.js"></script>
 *   <script>FS.bootstrap(FS_CONFIG);</script>
 */

(function (window, document) {
  'use strict';

  const FS = {};
  window.FS = FS;
  FS.version = '1.0.0-class';
  FS._cfg = null;

  // ── storage helpers ──────────────────────────────────────────
  function safeJSON(s, fb) { try { return JSON.parse(s) || fb; } catch (e) { return fb; } }
  const store = {
    get: (a, k, fb) => { try { const v = window[a + 'Storage'].getItem(k); return v !== null ? v : fb; } catch (e) { return fb; } },
    set: (a, k, v) => { try { window[a + 'Storage'].setItem(k, String(v)); } catch (e) {} },
    getJSON: (a, k, fb) => safeJSON(store.get(a, k, null), fb),
    setJSON: (a, k, o) => store.set(a, k, JSON.stringify(o))
  };

  function genDealId() {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return d + Math.floor(Math.random() * 1000000);
  }
  function buildPx(PXID) {
    const l = window.location;
    return JSON.stringify({ px: (PXID || '').trim(), agent: navigator.userAgent, landing: l.protocol + '//' + l.host + l.pathname });
  }
  function getCookie(name) {
    for (const part of document.cookie.split(';')) {
      const [k, v] = part.split('=').map(s => s.trim());
      if (k === name) return decodeURIComponent(v || '');
    }
    return null;
  }
  function waitFor(check, timeout, interval) {
    timeout = timeout || 8000; interval = interval || 100;
    return new Promise(resolve => {
      const start = Date.now();
      (function tick() {
        if (check()) return resolve(true);
        if (Date.now() - start >= timeout) return resolve(false);
        setTimeout(tick, interval);
      })();
    });
  }

  // ── tracking params (utm etc.) — sessionStorage persistent ───
  const TRACKING_STORAGE_KEY = 'fs_tracking_params';
  const TRACKING_KEYS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid','msclkid','ttclid','ref','aff','channel_name','discountCode'];

  FS.captureTrackingParams = function () {
    try {
      const url = new URLSearchParams(window.location.search);
      const incoming = {};
      TRACKING_KEYS.forEach(k => { const v = url.get(k); if (v) incoming[k] = v; });
      if (Object.keys(incoming).length) {
        store.setJSON('session', TRACKING_STORAGE_KEY, incoming);
      } else {
        const existing = store.getJSON('session', TRACKING_STORAGE_KEY, {});
        if (Object.keys(existing).length) return;
        const entries = performance.getEntriesByType('navigation');
        const navType = entries.length ? entries[0].type : 'navigate';
        if (navType === 'navigate') store.setJSON('session', TRACKING_STORAGE_KEY, {});
      }
    } catch (e) {}
  };
  FS.getStoredTrackingParams = function () { return store.getJSON('session', TRACKING_STORAGE_KEY, {}); };
  FS.captureTrackingParams();

  // ── third-party loaders (idempotent) ─────────────────────────
  FS.loadGTM = function (gtmId) {
    if (!gtmId || document.querySelector('[data-gtm-id="' + gtmId + '"]')) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtm.js?id=' + gtmId;
    s.setAttribute('data-gtm-id', gtmId);
    const first = document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(s, first);
  };
  FS.loadRecaptcha = function (siteKey) {
    if (!siteKey || document.querySelector('script[data-recaptcha]')) return;
    const s = document.createElement('script');
    s.src = 'https://www.google.com/recaptcha/enterprise.js?render=' + siteKey;
    s.async = true; s.defer = true; s.setAttribute('data-recaptcha', '1');
    document.head.appendChild(s);
  };
  FS.getRecaptchaToken = async function (siteKey, action) {
    const ready = await waitFor(() => typeof window.grecaptcha !== 'undefined' && window.grecaptcha.enterprise);
    if (!ready) return null;
    try {
      await new Promise(r => window.grecaptcha.enterprise.ready(r));
      return await window.grecaptcha.enterprise.execute(siteKey, { action: action });
    } catch (e) { return null; }
  };

  // ── affiliate ────────────────────────────────────────────────
  const AFFILIATE_KEY = 'aff', AFFILIATE_CHANNEL = 'affiliate';
  FS.initAffiliate = function () {
    store.set('local', AFFILIATE_KEY, '');
    const aff = new URLSearchParams(window.location.search).get(AFFILIATE_KEY);
    if (aff) {
      store.set('local', AFFILIATE_KEY, aff);
      document.querySelectorAll('input[name="mkter"]').forEach(el => { el.value = AFFILIATE_CHANNEL; });
    }
    return aff || '';
  };
  FS.getAffiliateId = function () { return store.get('local', AFFILIATE_KEY, ''); };

  // ── spam block ───────────────────────────────────────────────
  const SPAM = {
    email: ['Boss3870952199727@gmail.com','zz656633@gmail.com','gupgift22@hotmail.com','rut.6868@gmail.com','rattana@e-merchant.co.th','rinlapatpee@gmail.com','peunghooto@gmail.com','artgo589898@gmail.com','payungpong.1986@gmail.com'].join('|'),
    name: 'ชรัญเพ็ง|ชัณเพ็ง|ชรัณ เพ็งนวม|ชรัณ|เพ็งนวม|อนุพงษ์ พุงพงษ์',
    phone: ['964034620','814092001','624652674','873022602','844309467','994951423','994638932','625412781'].join('|')
  };
  FS.isSpam = function (p) {
    return RegExp(SPAM.email).test(p.email || '') || RegExp(SPAM.name).test(p.fullname || '') || RegExp(SPAM.phone).test(p.phone || '');
  };

  // ── validation ───────────────────────────────────────────────
  const EMAIL_RE = /^([a-zA-Z0-9]+)([\w.+-]*)([a-zA-Z0-9])@\w+([.-]?\w+)([.]\w{2,3})+$/;
  FS.validateEmail = e => EMAIL_RE.test(e);
  FS.validatePhone = function (raw) {
    const cleaned = (raw || '').replace(/[\s\-()]/g, '').replace(/^\+66/, '0').replace(/^66/, '0');
    const digits = cleaned.replace(/^0/, '');
    if (digits.length !== 9) return null;
    return '0' + digits;
  };
  FS.correctName = n => (n || '').replace(/^(นาย|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.|นาง|คุณ|เด็กชาย|เด็กหญิง)/, '').replace(/\s{2,}/g, ' ').trim();

  // ── form element resolution ──────────────────────────────────
  FS.findForm = function (cfg) {
    if (cfg && cfg.formSelector) return document.querySelector(cfg.formSelector);
    return document.querySelector('#leadForm, #lead-form, [data-fs-form]');
  };
  FS.findField = function (form, name) {
    return document.getElementById(name) || document.getElementById('field-' + name) || (form ? form.querySelector('[name="' + name + '"]') : null);
  };
  FS.findSubmitButton = function (form, cfg) {
    if (cfg && cfg.submitButtonSelector) return document.querySelector(cfg.submitButtonSelector);
    return form ? form.querySelector('button[type="submit"]') : null;
  };
  function setValue(form, name, value) { const el = FS.findField(form, name); if (el) el.value = value == null ? '' : value; }
  function setIfEmpty(form, name, value) { const el = FS.findField(form, name); if (el && !el.value) el.value = value == null ? '' : value; }

  // ── CLASS-style: resolve default product (sku/price/discount) ─
  FS.resolveDefaultProduct = function (cfg) {
    const products = cfg && cfg.hiddenFieldConfig && cfg.hiddenFieldConfig.product;
    if (!products) return null;
    const entries = Object.entries(products);
    if (!entries.length) return null;
    let idx = entries.findIndex(([, v]) => v && v.default);
    if (idx < 0) idx = 0;
    return entries[idx][1]; // { sku, price, discountCode }
  };

  // ── form hydration (CLASS conventions) ───────────────────────
  FS.hydrateHiddenFields = function (cfg) {
    const form = FS.findForm(cfg);
    if (!form) return;
    const hc = cfg.hiddenFieldConfig || {};
    const urlParams = new URLSearchParams(window.location.search);
    const tracking = FS.getStoredTrackingParams();
    const aff = FS.getAffiliateId();

    // 1. static config values (skip nested objects like product)
    Object.entries(hc).forEach(([k, v]) => { if (typeof v !== 'object') setIfEmpty(form, k, v); });

    // 2. CLASS: product default → sku / price / discountCode, course = sku
    const product = FS.resolveDefaultProduct(cfg);
    if (product) {
      setValue(form, 'sku', product.sku || '');
      setValue(form, 'price', product.price || '');
      if (product.discountCode) setIfEmpty(form, 'discountCode', product.discountCode);
      setValue(form, 'course', product.sku || '');
    }

    // 3. CLASS: mkter ← ads_opt (unless affiliate already set it)
    if (!aff && hc.ads_opt) setIfEmpty(form, 'mkter', hc.ads_opt);

    // 4. URL overrides
    const urlChannel = urlParams.get('channel_name'); if (urlChannel) setValue(form, 'channel_name', urlChannel);
    const urlDiscount = urlParams.get('discountCode'); if (urlDiscount) setValue(form, 'discountCode', urlDiscount);

    // 5. tracking params
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(k => setIfEmpty(form, k, tracking[k] || urlParams.get(k) || ''));

    // 6. runtime values (always fresh)
    const dealId = genDealId();
    const px = buildPx(cfg.PXID);
    setValue(form, 'px', px);
    setValue(form, 'deal_id', dealId);
    setValue(form, 'landing_url', window.location.href);

    // 7. cookie user prefill
    try {
      const c = getCookie('user');
      if (c) {
        const u = JSON.parse(decodeURIComponent(c));
        setIfEmpty(form, 'email', u.email || '');
        setIfEmpty(form, 'fullname', ((u.firstName || '') + ' ' + (u.lastName || '')).trim());
      }
    } catch (e) {}

    // 8. CLASS: single "hidden" JSON blob mirroring full config + runtime
    const hiddenBlob = Object.assign({}, hc, {
      deal_id: dealId,
      course_type: cfg.landingPageType,
      px: px,
      landing_url: window.location.href,
      aff: aff || ''
    });
    setValue(form, 'hidden', JSON.stringify(hiddenBlob));
    store.setJSON('local', 'hidden', hiddenBlob);
  };

  // ── build lead payload ───────────────────────────────────────
  FS.buildLeadPayload = function (form, cfg) {
    const payload = {};
    new FormData(form).forEach((v, k) => { payload[k] = v; });

    // fallback from config (flat values only)
    Object.entries(cfg.hiddenFieldConfig || {}).forEach(([k, v]) => { if (typeof v !== 'object' && !payload[k]) payload[k] = v; });

    // product fallback (sku/price/course)
    const product = FS.resolveDefaultProduct(cfg);
    if (product) {
      if (!payload.sku) payload.sku = product.sku || '';
      if (!payload.price) payload.price = product.price || '';
      if (!payload.course) payload.course = product.sku || '';
    }
    if (!payload.mkter && cfg.hiddenFieldConfig && cfg.hiddenFieldConfig.ads_opt) payload.mkter = cfg.hiddenFieldConfig.ads_opt;

    // tracking
    Object.entries(FS.getStoredTrackingParams()).forEach(([k, v]) => { if (!payload[k]) payload[k] = v; });

    // runtime guarantees
    if (!payload.px) payload.px = buildPx(cfg.PXID);
    if (!payload.deal_id) payload.deal_id = genDealId();
    if (!payload.landing_url) payload.landing_url = window.location.href;

    // remove UI-only fields
    delete payload.defaultPackage; delete payload.package;

    const required = cfg.requiredHiddenFields || ['price','campaign','px','deal_id','landing_url'];
    required.forEach(k => { if (!payload[k]) console.warn('[FS-class] required hidden field empty: "' + k + '"'); });

    if (cfg.debug) { console.group('[FS-class] payload (' + Object.keys(payload).length + ')'); console.table(payload); console.groupEnd(); }
    return payload;
  };

  // ── analytics ────────────────────────────────────────────────
  FS.trackCompleteRegistration = function (payload) {
    window.conversion = {
      email: payload.email, phone: payload.phone, fullname: payload.fullname,
      price: payload.price, course: payload.course, campaign: payload.campaign, mkter: payload.mkter,
      utm_source: payload.utm_source, utm_medium: payload.utm_medium, utm_campaign: payload.utm_campaign, utm_content: payload.utm_content
    };
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'FSCompleteRegistration', conversion: window.conversion });
  };

  // ── submit handler (CLASS: lead only → redirect, NO payment) ──
  FS.handleSubmit = function (cfg) {
    const form = FS.findForm(cfg);
    if (!form) return;
    const submitBtn = FS.findSubmitButton(form, cfg);
    const errorBox = cfg.errorBoxSelector ? document.querySelector(cfg.errorBoxSelector) : null;
    const defaultTxt = cfg.submitButtonDefaultText || 'ยืนยัน';
    const loadingTxt = cfg.submitButtonLoadingText || 'กำลังดำเนินการ..';

    function resetBtn() { if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = defaultTxt; } }
    function showError(msg) {
      if (errorBox) { errorBox.textContent = msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'; errorBox.style.display = 'block'; errorBox.classList.add('show'); }
      else { alert(msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'); }
      resetBtn();
    }
    function hideError() { if (errorBox) { errorBox.style.display = 'none'; errorBox.classList.remove('show'); errorBox.textContent = ''; } }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      hideError();

      const fullname = (FS.findField(form, 'fullname') || {}).value || '';
      const email = (FS.findField(form, 'email') || {}).value || '';
      const phone = (FS.findField(form, 'phone') || {}).value || '';

      if (!fullname.trim()) return showError('กรุณากรอกชื่อ-นามสกุล');
      if (!FS.validateEmail(email.trim())) return showError('กรุณากรอกอีเมลที่ถูกต้อง');
      if (!/^[0-9+\-\s()]{7,}$/.test(phone.trim())) return showError('กรุณากรอกเบอร์โทรที่ถูกต้อง');

      if (cfg.enableSpamBlock !== false && FS.isSpam({ email, fullname, phone })) {
        console.warn('[FS-class] blocked by spam filter');
        return showError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
      }

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = loadingTxt; }

      try {
        // reCAPTCHA
        const token = await FS.getRecaptchaToken(cfg.SITE_KEY, cfg.recaptchaAction || 'formSubmit');
        if (!token) return showError('ไม่สามารถโหลดระบบความปลอดภัยได้ กรุณา refresh และลองใหม่');
        const tf = FS.findField(form, 'g-recaptcha-token'); if (tf) tf.value = token;

        // payload
        const payload = FS.buildLeadPayload(form, cfg);
        payload.fullname = FS.correctName(payload.fullname);
        const np = FS.validatePhone(payload.phone); if (np) payload.phone = np;

        const finalPayload = (cfg.onBeforeSubmit && cfg.onBeforeSubmit(payload)) || payload;

        // POST lead webhook
        const res = await fetch(cfg.WEBHOOK_FORM_ACTION, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalPayload)
        });
        if (!res.ok) throw new Error('Webhook returned ' + res.status);

        // analytics
        FS.trackCompleteRegistration(finalPayload);
        if (cfg.onSubmitSuccess) cfg.onSubmitSuccess(finalPayload);

        // persist (optional, for thank-you page)
        ['email','phone','fullname','price','course','mkter','campaign','deal_id','px','redirect_url','landing_url'].forEach(k => store.set('local', k, finalPayload[k] || ''));

        // ── CLASS / cod: NO payment. Redirect to thank-you. ──
        const redirectUrl = finalPayload.redirect_url || (cfg.hiddenFieldConfig && cfg.hiddenFieldConfig.redirect_url) || '';
        if (redirectUrl) {
          setTimeout(function () { window.location.assign(redirectUrl); }, 1200);
        } else {
          resetBtn();
          console.warn('[FS-class] no redirect_url configured — lead submitted, staying on page');
        }
      } catch (err) {
        console.error('[FS-class] submit error:', err);
        const custom = cfg.onSubmitError && cfg.onSubmitError(err);
        showError(custom || ('เกิดข้อผิดพลาดในการส่งข้อมูล กรุณาลองใหม่อีกครั้ง (' + (err.message || 'Network error') + ')'));
      }
    });
  };

  // ── bootstrap (same public API as main-v2.js) ────────────────
  FS.bootstrap = function (cfg) {
    if (!cfg) { console.error('[FS-class] FS.bootstrap(config) requires a config object'); return; }
    FS._cfg = cfg;

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'FSInit', PXID: cfg.PXID });

    FS.loadGTM(cfg.GTM_ID);
    FS.loadRecaptcha(cfg.SITE_KEY);
    FS.initAffiliate();

    function run() {
      FS.hydrateHiddenFields(cfg);
      FS.handleSubmit(cfg);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  };

})(window, document);
