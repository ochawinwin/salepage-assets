/**
 * main-v2.js — FutureSkill Sale Page Shared Library
 * Version: 2.0.0
 *
 * Supports two sale page types via FS.bootstrap(config):
 *   • Linkpay  — landingPageType: 'SGC', email_cf_channel: ''
 *   • LINE LIFF — landingPageType: 'YR',  email_cf_channel: 'line'
 *
 * Usage (in sale page):
 *   <script src="https://cdn.jsdelivr.net/gh/ochawinwin/salepage-assets@master/scripts/main-v2.js"></script>
 *   <script>FS.bootstrap(FS_CONFIG);</script>
 *
 * FS_CONFIG shape: see FS.bootstrap JSDoc below.
 */

(function (window, document) {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // § Namespace
    // ─────────────────────────────────────────────────────────────
    const FS = {};
    window.FS = FS;
    FS.version = '2.0.0';

    // Stored by bootstrap so the dataLayer affiliate listener can access it
    FS._cfg = null;


    // ─────────────────────────────────────────────────────────────
    // § Utilities (private)
    // ─────────────────────────────────────────────────────────────

    function safeJSON(str, fallback) {
        try { return JSON.parse(str) || fallback; }
        catch (e) { return fallback; }
    }

    const store = {
        get: (area, key, fallback) => {
            try { const v = window[area + 'Storage'].getItem(key); return v !== null ? v : fallback; }
            catch (e) { return fallback; }
        },
        set: (area, key, value) => {
            try { window[area + 'Storage'].setItem(key, String(value)); }
            catch (e) {}
        },
        getJSON: (area, key, fallback) => safeJSON(store.get(area, key, null), fallback),
        setJSON: (area, key, obj) => store.set(area, key, JSON.stringify(obj))
    };

    async function fetchPost(url, data, headers) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(headers || {}) },
            body: JSON.stringify(data)
        });
        return res.json();
    }

    async function getIp() {
        try {
            const res = await fetch('https://cloudflare.com/cdn-cgi/trace');
            const text = await res.text();
            return text.trim().split('\n').reduce((obj, line) => {
                const sep = line.indexOf('=');
                if (sep > -1) obj[line.slice(0, sep)] = line.slice(sep + 1);
                return obj;
            }, {});
        } catch (e) { return {}; }
    }

    function genDealId() {
        const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        return d + Math.floor(Math.random() * 1000000);
    }

    function buildPx(PXID) {
        const l = window.location;
        return JSON.stringify({
            px: (PXID || '').trim(),
            agent: navigator.userAgent,
            landing: l.protocol + '//' + l.host + l.pathname
        });
    }

    function getCookie(name) {
        for (const part of document.cookie.split(';')) {
            const [k, v] = part.split('=').map(s => s.trim());
            if (k === name) return decodeURIComponent(v || '');
        }
        return null;
    }

    function waitFor(check, timeout, interval) {
        timeout = timeout || 8000;
        interval = interval || 100;
        return new Promise(resolve => {
            const start = Date.now();
            (function tick() {
                if (check()) return resolve(true);
                if (Date.now() - start >= timeout) return resolve(false);
                setTimeout(tick, interval);
            })();
        });
    }


    // ─────────────────────────────────────────────────────────────
    // § Tracking Params — sessionStorage-persistent, current-URL wins
    // ─────────────────────────────────────────────────────────────

    const TRACKING_STORAGE_KEY = 'fs_tracking_params';

    const TRACKING_KEYS = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
        'fbclid', 'gclid', 'msclkid', 'ttclid',
        'ref', 'aff', 'channel_name', 'discountCode'
    ];

    /**
     * Capture URL tracking params → sessionStorage.
     *
     * Logic:
     *  - URL has params  → always replace sessionStorage (current URL wins)
     *  - URL has no params + navigation type is 'reload' or 'back_forward'
     *                    → keep existing sessionStorage (handles in-app browser hash-click reload)
     *  - URL has no params + navigation type is 'navigate' (fresh visit)
     *                    → clear sessionStorage (no stale UTM from a prior visit)
     *
     * Called immediately on script load, before any URL mutation can occur.
     */
    FS.captureTrackingParams = function () {
        try {
            const url = new URLSearchParams(window.location.search);
            const incoming = {};
            TRACKING_KEYS.forEach(k => { const v = url.get(k); if (v) incoming[k] = v; });

            if (Object.keys(incoming).length) {
                // URL has tracking params — always update
                store.setJSON('session', TRACKING_STORAGE_KEY, incoming);
            } else {
                // URL has no tracking params — use navigation type to decide
                const entries = performance.getEntriesByType('navigation');
                const navType = entries.length ? entries[0].type : 'navigate';
                if (navType === 'navigate') {
                    // Fresh visit from external source: clear stale sessionStorage
                    store.setJSON('session', TRACKING_STORAGE_KEY, {});
                }
                // 'reload' or 'back_forward': keep existing sessionStorage intact
            }
        } catch (e) {}
    };

    FS.getStoredTrackingParams = function () {
        return store.getJSON('session', TRACKING_STORAGE_KEY, {});
    };

    /**
     * Write tracking params into localStorage['params'] so legacy submitPayment code can read them.
     * Called both at hydration time and again just before submitPayment (in case anything overwrote it).
     */
    FS.syncTrackingToLocalStorage = function () {
        const params = FS.getStoredTrackingParams();
        if (!Object.keys(params).length) return;
        const existing = store.getJSON('local', 'params', {});
        store.setJSON('local', 'params', Object.assign({}, existing, params));
    };

    // Run immediately — must happen before any page script can strip the URL
    FS.captureTrackingParams();


    // ─────────────────────────────────────────────────────────────
    // § Third-party Loaders (idempotent)
    // ─────────────────────────────────────────────────────────────

    FS.loadGTM = function (gtmId) {
        if (!gtmId || document.querySelector('[data-gtm-id="' + gtmId + '"]')) return;
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
        const s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtm.js?id=' + gtmId;
        s.setAttribute('data-gtm-id', gtmId);
        const first = document.getElementsByTagName('script')[0];
        first.parentNode.insertBefore(s, first);
    };

    FS.loadTikTokPixel = function (pixelId) {
        if (!pixelId || (window.ttq && window.ttq._i && window.ttq._i[pixelId])) return;
        !function (w, d, t) {
            w.TiktokAnalyticsObject = t;
            const ttq = w[t] = w[t] || [];
            ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready",
                "alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];
            ttq.setAndDefer = function (obj, method) {
                obj[method] = function () { obj.push([method].concat(Array.prototype.slice.call(arguments, 0))); };
            };
            for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
            ttq.instance = function (id) {
                const inst = ttq._i[id] || [];
                for (let n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(inst, ttq.methods[n]);
                return inst;
            };
            ttq.load = function (e, n) {
                const base = 'https://analytics.tiktok.com/i18n/pixel/events.js';
                ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = base;
                ttq._t = ttq._t || {}; ttq._t[e] = +new Date();
                ttq._o = ttq._o || {}; ttq._o[e] = n || {};
                const s = document.createElement('script');
                s.type = 'text/javascript'; s.async = true;
                s.src = base + '?sdkid=' + e + '&lib=' + t;
                const f = document.getElementsByTagName('script')[0];
                f.parentNode.insertBefore(s, f);
            };
            ttq.load(pixelId);
            ttq.page();
        }(window, document, 'ttq');
    };

    FS.loadRecaptcha = function (siteKey) {
        if (!siteKey || document.querySelector('script[data-recaptcha]')) return;
        const s = document.createElement('script');
        s.src = 'https://www.google.com/recaptcha/enterprise.js?render=' + siteKey;
        s.async = true;
        s.defer = true;
        s.setAttribute('data-recaptcha', '1');
        document.head.appendChild(s);
    };

    FS.getRecaptchaToken = async function (siteKey, action) {
        const ready = await waitFor(function () {
            return typeof window.grecaptcha !== 'undefined' && window.grecaptcha.enterprise;
        });
        if (!ready) return null;
        try {
            await new Promise(function (resolve) { window.grecaptcha.enterprise.ready(resolve); });
            return await window.grecaptcha.enterprise.execute(siteKey, { action: action });
        } catch (e) { return null; }
    };


    // ─────────────────────────────────────────────────────────────
    // § Affiliate
    // ─────────────────────────────────────────────────────────────

    const AFFILIATE_KEY = 'aff';
    const AFFILIATE_CHANNEL = 'affiliate';

    FS.initAffiliate = function () {
        store.set('local', AFFILIATE_KEY, '');  // reset each page load
        const aff = new URLSearchParams(window.location.search).get(AFFILIATE_KEY);
        if (aff) {
            store.set('local', AFFILIATE_KEY, aff);
            document.querySelectorAll('input[name="mkter"]').forEach(function (el) {
                el.value = AFFILIATE_CHANNEL;
            });
        }
    };

    FS.getAffiliateId = function () {
        return store.get('local', AFFILIATE_KEY, '');
    };


    // ─────────────────────────────────────────────────────────────
    // § Spam Block
    // ─────────────────────────────────────────────────────────────

    const SPAM_BLOCKLIST = {
        email: [
            'charan.p','Zz656','Boss3870952199727@gmail.com','zz656633@gmail.com','gupgift22@hotmail.com',
            'wanvisa@gmail.com','lampong251731@gmail.com','sinmue89@gmail.com','rut.6868@gmail.com',
            'rattana@e-merchant.co.th','rinlapatpee@gmail.com','peunghooto@gmail.com','artgo589898@gmail.com',
            'tanawin.w@mcgroupnet.com','dissayanan_meesuk@hotmail.com','phathamma_@hotmail.com',
            '367nspolice.go.th@gmail.com','chuleeporn1014@gmail.com','rutjanee@adhawk-inter.com',
            'ekbumrung@gmail.com','kitthaboon@apexchemicals.co.th','aumpai.pom@apexchemicals.co.th',
            'whattime2626@gmail.com','nawarat.bl1105@gmail.com','hr@pfm4.com','marin@psh2002.com',
            'pakapol00@gmail.com','gesonpaluck@gmail.com','eervee55@gmail.com','hyagnya@gmail.com',
            'thaeymtang2@gmail.com','lukk05504@gmail.com','anoma88@yahoo.com',
            'payungpong.1986@gmail.com','ruth_4456@gmail.com','ruth_6872@gmail.com'
        ].join('|'),
        name: 'ชรัญเพ็ง|ชัณเพ็ง|ชรัณ เพ็งนวม|ชรัณ|เพ็งนวม|อนุพงษ์ พุงพงษ์',
        phone: [
            '964034620','814092001','624652674','873022602','844309467','994951423','994638932',
            '625412781','928486701','966399963','825478299','906999692','847728820','859581891',
            '615488022','651180830','933991555','988311163','632296154','819975804','825580649',
            '885834135','919352730','962767502','623631528','819126019','66986560424',
            '804176811','809664566'
        ].join('|')
    };

    FS.isSpam = function (props) {
        return RegExp(SPAM_BLOCKLIST.email).test(props.email || '') ||
               RegExp(SPAM_BLOCKLIST.name).test(props.fullname || '') ||
               RegExp(SPAM_BLOCKLIST.phone).test(props.phone || '');
    };


    // ─────────────────────────────────────────────────────────────
    // § Validation
    // ─────────────────────────────────────────────────────────────

    const EMAIL_RE = /^([a-zA-Z0-9]+)([\w.+-]*)([a-zA-Z0-9])@\w+([.-]?\w+)([.]\w{2,3})+$/;

    FS.validateEmail = function (email) {
        return EMAIL_RE.test(email);
    };

    /** Returns normalized phone string (e.g. "0812345678") or null if invalid. */
    FS.validatePhone = function (raw) {
        const cleaned = (raw || '').replace(/[\s\-()]/g, '').replace(/^\+66/, '0').replace(/^66/, '0');
        const digits = cleaned.replace(/^0/, '');
        if (digits.length !== 9) return null;
        return '0' + digits;
    };

    FS.correctName = function (name) {
        return (name || '').replace(/^(นาย|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.|นาง|คุณ|เด็กชาย|เด็กหญิง)/, '').replace(/\s{2,}/g, ' ').trim();
    };


    // ─────────────────────────────────────────────────────────────
    // § Form Element Resolution
    // Handles both field ID conventions:
    //   • OpenClaw:  id="utm_source"         (name === id)
    //   • Skillpass: id="field-utm_source"   ('field-' prefix)
    // ─────────────────────────────────────────────────────────────

    FS.findForm = function (cfg) {
        if (cfg && cfg.formSelector) return document.querySelector(cfg.formSelector);
        return document.querySelector('#leadForm, #lead-form, [data-fs-form]');
    };

    FS.findField = function (form, name) {
        let el = document.getElementById(name);
        if (el) return el;
        el = document.getElementById('field-' + name);
        if (el) return el;
        return form ? form.querySelector('[name="' + name + '"]') : null;
    };

    FS.findSubmitButton = function (form, cfg) {
        if (cfg && cfg.submitButtonSelector) return document.querySelector(cfg.submitButtonSelector);
        return form ? form.querySelector('button[type="submit"]') : null;
    };


    // ─────────────────────────────────────────────────────────────
    // § Form Hydration
    // ─────────────────────────────────────────────────────────────

    function setIfEmpty(form, name, value) {
        const el = FS.findField(form, name);
        if (el && !el.value) el.value = value || '';
    }

    function setValue(form, name, value) {
        const el = FS.findField(form, name);
        if (el) el.value = value || '';
    }

    /**
     * Populate all hidden fields from 5 sources:
     *  1. cfg.hiddenFieldConfig (page static values)
     *  2. URL param overrides (channel_name, discountCode)
     *  3. sessionStorage tracking params (utm_*, fbclid, gclid, ...)
     *  4. Runtime-generated values (px, deal_id, landing_url)
     *  5. Cookie user data (email, fullname pre-fill)
     */
    FS.hydrateHiddenFields = function (cfg) {
        const form = FS.findForm(cfg);
        if (!form) return;

        const urlParams = new URLSearchParams(window.location.search);
        const tracking = FS.getStoredTrackingParams();

        // 1. Page-configured static values
        Object.entries(cfg.hiddenFieldConfig || {}).forEach(function (entry) {
            setIfEmpty(form, entry[0], entry[1]);
        });

        // 2. URL-driven overrides (always take priority)
        const urlChannelName = urlParams.get('channel_name');
        if (urlChannelName) setValue(form, 'channel_name', urlChannelName);
        const urlDiscount = urlParams.get('discountCode');
        if (urlDiscount) setValue(form, 'discountCode', urlDiscount);

        // 3. Tracking params
        const utmFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
        utmFields.forEach(function (k) {
            setIfEmpty(form, k, tracking[k] || urlParams.get(k) || '');
        });

        // 4. Runtime-generated (force-write, always fresh)
        setValue(form, 'px', buildPx(cfg.PXID));
        setValue(form, 'deal_id', genDealId());
        setValue(form, 'landing_url', window.location.href);

        // 5. Cookie user (autofill visible fields — only if still empty)
        try {
            const userCookie = getCookie('user');
            if (userCookie) {
                const user = JSON.parse(decodeURIComponent(userCookie));
                setIfEmpty(form, 'email', user.email || '');
                const fullName = ((user.firstName || '') + ' ' + (user.lastName || '')).trim();
                setIfEmpty(form, 'fullname', fullName);
            }
        } catch (e) {}

        // Sync tracking params to localStorage for payment leg
        FS.syncTrackingToLocalStorage();
    };

    /**
     * Wire package select → course / price / discountCode hidden fields.
     * Only runs if a <select name="package"> element exists in the form.
     * Format: "COURSE_SKU/PRICE/DISCOUNT_CODE"
     */
    FS.attachPackageSelectSync = function (cfg) {
        const form = FS.findForm(cfg);
        if (!form) return;
        const sel = form.querySelector('select[name="package"]');
        if (!sel) return;

        function applyPackage(val) {
            const parts = (val || '').split('/');
            setValue(form, 'course', parts[0] || '');
            setValue(form, 'price', parts[1] || '');
            setValue(form, 'discountCode', parts[2] || '');
        }

        // Apply default from <input name="defaultPackage"> if present
        const defaultEl = form.querySelector('input[name="defaultPackage"]');
        if (defaultEl && defaultEl.value) {
            sel.value = defaultEl.value;
        }

        if (sel.value) applyPackage(sel.value);
        sel.addEventListener('change', function () { applyPackage(sel.value); });
    };


    // ─────────────────────────────────────────────────────────────
    // § Build Lead Payload (CRITICAL — data integrity)
    // ─────────────────────────────────────────────────────────────

    /**
     * Build the complete payload to POST to the webhook.
     * Merges from multiple sources so no field is silently dropped.
     *
     *  Layer 1: FormData (all form inputs including hidden fields)
     *  Layer 2: hiddenFieldConfig fallback (covers any empty field)
     *  Layer 3: sessionStorage tracking params (UTM safe even if URL was stripped)
     *  Layer 4: Runtime values (px, deal_id, landing_url — always present)
     *  Layer 5: Cleanup (remove internal UI fields)
     */
    FS.buildLeadPayload = function (form, cfg) {
        const payload = {};

        // Layer 1: All form inputs
        new FormData(form).forEach(function (v, k) { payload[k] = v; });

        // Layer 2: hiddenFieldConfig fallback
        Object.entries(cfg.hiddenFieldConfig || {}).forEach(function (entry) {
            if (!payload[entry[0]]) payload[entry[0]] = entry[1];
        });

        // Layer 3: sessionStorage tracking params
        const tracking = FS.getStoredTrackingParams();
        Object.entries(tracking).forEach(function (entry) {
            if (!payload[entry[0]]) payload[entry[0]] = entry[1];
        });

        // Layer 4: Runtime values (only add if genuinely missing)
        if (!payload.px)          payload.px = buildPx(cfg.PXID);
        if (!payload.deal_id)     payload.deal_id = genDealId();
        if (!payload.landing_url) payload.landing_url = window.location.href;

        // Layer 5: Remove internal UI-only fields
        delete payload.defaultPackage;
        delete payload.package;

        // Validation: log warning for any expected-but-empty required fields
        const required = cfg.requiredHiddenFields || ['price', 'course', 'campaign', 'px', 'deal_id', 'landing_url'];
        required.forEach(function (k) {
            if (!payload[k]) console.warn('[FS] Required hidden field is empty: "' + k + '"');
        });

        if (cfg.debug) {
            console.group('[FS] Lead Payload (' + Object.keys(payload).length + ' fields)');
            console.table(payload);
            console.groupEnd();
        }

        return payload;
    };


    // ─────────────────────────────────────────────────────────────
    // § Tracking / Analytics Events
    // ─────────────────────────────────────────────────────────────

    FS.trackCompleteRegistration = function (payload, cfg) {
        // TikTok Pixel
        if (typeof window.ttq !== 'undefined') {
            window.ttq.track('CompleteRegistration', {
                value: Number(payload.price) || 0,
                currency: 'THB',
                content_id: payload.course || '',
                content_name: payload.title || (cfg.hiddenFieldConfig && cfg.hiddenFieldConfig.title) || ''
            });
        }

        // window.conversion (used by GTM + affiliate listener)
        window.conversion = {
            email:        payload.email,
            phone:        payload.phone,
            fullname:     payload.fullname,
            price:        payload.price,
            course:       payload.course,
            campaign:     payload.campaign,
            mkter:        payload.mkter,
            utm_source:   payload.utm_source,
            utm_medium:   payload.utm_medium,
            utm_campaign: payload.utm_campaign,
            utm_content:  payload.utm_content
        };

        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'FSCompleteRegistration', conversion: window.conversion });
    };


    // ─────────────────────────────────────────────────────────────
    // § Payment Dispatcher (Linkpay vs LINE LIFF)
    // ─────────────────────────────────────────────────────────────

    FS.isLineLanding = function (cfg) {
        return !!(cfg && cfg.hiddenFieldConfig && cfg.hiddenFieldConfig.email_cf_channel === 'line');
    };

    FS.createCart = async function (cart) {
        return fetchPost(
            'https://pay-api.futureskill.co/api/cart/create',
            cart,
            { Authorization: 'Basic ODIzMjAyMzI4NzczNjEwNzA6cWdsTzA1YVZkdVl2RHF5eVdhQ2w=' }
        );
    };

    /**
     * Submit payment: builds cart → calls createCart → redirects.
     * Auto-routes to Linkpay or LINE LIFF based on cfg.hiddenFieldConfig.email_cf_channel.
     * @param {Object} payload  — complete lead payload (from buildLeadPayload)
     * @param {Object} cfg      — bootstrap config
     */
    FS.submitPayment = async function (payload, cfg) {
        // FIX: Ensure tracking params in localStorage are fresh before reading
        // (any legacy capture-phase listener may have overwritten them with an empty URL)
        FS.syncTrackingToLocalStorage();
        const params = store.getJSON('local', 'params', {});

        const { ip } = await getIp();
        const affId = FS.getAffiliateId();

        // Build course list (include orderbump if checked)
        const courses = (payload.course || '').split(',').filter(Boolean);
        if (payload.orderbump === 'on' && payload.orderbumpdetail) {
            payload.orderbumpdetail.split(',').forEach(function (c) {
                c = c.trim();
                if (c && !courses.includes(c)) courses.push(c);
            });
        }

        const cartItems = courses.map(function (sku) { return { product: sku, quantity: 1 }; });

        const cart = {
            cartItems,
            userdata: {
                email:    payload.email,
                tel:      payload.phone    || '',
                fullName: payload.fullname || ''
            },
            cartTracking: {
                convertionId: (window.conversion && window.conversion.hash) || '',
                campaign:     payload.campaign || '',
                seller:  affId ? AFFILIATE_CHANNEL : (payload.mkter || ''),
                channel: affId ? AFFILIATE_CHANNEL : 'SGC',
                ip,
                utm_source:   params.utm_source   || '',
                utm_medium:   params.utm_medium   || '',
                utm_campaign: params.utm_campaign || '',
                utm_term:     params.utm_term     || '',
                utm_content:  params.utm_content  || '',
                customField1: payload.deal_id,
                customField2: payload.px,
                customField3: (payload.course || '') + '|' + (payload.email || '')
            },
            paymentSuccessRedirectUrl: payload.redirect_url || ''
        };

        if (affId) cart.cartTracking.affiliateId = affId;
        if (payload.type) cart.userdata.payload = { userId: undefined, redeem: true, type: payload.type };
        if (payload.callback_url) cart.paymentSuccessCallbackUrl = payload.callback_url;

        const result = await FS.createCart(cart);
        if (!result.url) {
            throw new Error('createCart failed: ' + JSON.stringify(result));
        }
        let url = result.url;
        const cartNo = result.cartNo || '';

        if (payload.discountCode) url = url + '?discountCode=' + encodeURIComponent(payload.discountCode);

        if (FS.isLineLanding(cfg)) {
            // LINE LIFF flow: send webhook → redirect to LIFF
            const cartParams = {
                cartNo,
                deal_id:         payload.deal_id,
                email:           payload.email,
                fullname:        payload.fullname,
                phone:           payload.phone,
                course:          payload.course,
                price:           payload.price,
                title:           payload.campaign,
                orderbump:       payload.orderbump       || '',
                orderbumpdetail: payload.orderbumpdetail || '',
                bonusdetail:     payload.bonusdetail     || ''
            };
            if (payload.orderbump !== 'on') cartParams.discountCode = payload.discountCode || '';

            await fetchPost(
                'https://futureskill.app.n8n.cloud/webhook/line/email',
                Object.assign({}, cartParams, {
                    dealId:     cartParams.deal_id,
                    name:       cartParams.fullname,
                    landingUrl: payload.landing_url
                }),
                { 'content-type': 'application/json' }
            );

            const liffQuery = new URLSearchParams(cartParams).toString();
            setTimeout(function () {
                window.location.replace('https://liff.line.me/2001020437-ljNJ4095?' + liffQuery);
            }, 1500);
        } else {
            // Linkpay flow
            setTimeout(function () { window.location.replace(url); }, 1500);
        }
    };


    // ─────────────────────────────────────────────────────────────
    // § Submit Handler Orchestrator
    // ─────────────────────────────────────────────────────────────

    FS.handleSubmit = function (cfg) {
        const form = FS.findForm(cfg);
        if (!form) return;

        const submitBtn  = FS.findSubmitButton(form, cfg);
        const errorBox   = cfg.errorBoxSelector ? document.querySelector(cfg.errorBoxSelector) : null;
        const defaultTxt = cfg.submitButtonDefaultText || 'ยืนยัน';
        const loadingTxt = cfg.submitButtonLoadingText || 'กำลังดำเนินการ..';

        function resetBtn() {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = defaultTxt;
            }
        }

        function showError(msg) {
            if (errorBox) {
                errorBox.textContent = msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
                errorBox.classList.add('show');
            } else {
                alert(msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
            }
            resetBtn();
        }

        function hideError() {
            if (errorBox) { errorBox.classList.remove('show'); errorBox.textContent = ''; }
        }

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            if (errorBox) hideError();

            // ── Validate visible fields ──
            const fullname = (FS.findField(form, 'fullname') || {}).value || '';
            const email    = (FS.findField(form, 'email')    || {}).value || '';
            const phone    = (FS.findField(form, 'phone')    || {}).value || '';

            if (!fullname.trim()) return showError('กรุณากรอกชื่อ-นามสกุล');
            if (!FS.validateEmail(email.trim())) return showError('กรุณากรอกอีเมลที่ถูกต้อง');
            if (!/^[0-9+\-\s()]{7,}$/.test(phone.trim())) return showError('กรุณากรอกเบอร์โทรที่ถูกต้อง');

            // ── Spam check ──
            if (cfg.enableSpamBlock !== false && FS.isSpam({ email, fullname, phone })) {
                console.warn('[FS] Submission blocked by spam filter');
                return showError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
            }

            // ── Loading state ──
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = loadingTxt; }

            try {
                // ── reCAPTCHA ──
                const token = await FS.getRecaptchaToken(cfg.SITE_KEY, cfg.recaptchaAction || 'formSubmit');
                if (!token) return showError('ไม่สามารถโหลดระบบความปลอดภัยได้ กรุณา refresh และลองใหม่');
                const tokenField = FS.findField(form, 'g-recaptcha-token');
                if (tokenField) tokenField.value = token;

                // ── Build complete payload ──
                const payload = FS.buildLeadPayload(form, cfg);
                payload.fullname = FS.correctName(payload.fullname);
                const normPhone = FS.validatePhone(payload.phone);
                if (normPhone) payload.phone = normPhone;

                // ── User hook: onBeforeSubmit ──
                const finalPayload = (cfg.onBeforeSubmit && cfg.onBeforeSubmit(payload)) || payload;

                // ── POST to webhook (lead capture) ──
                const res = await fetch(cfg.WEBHOOK_FORM_ACTION, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(finalPayload)
                });
                if (!res.ok) throw new Error('Webhook returned ' + res.status);

                // ── Fire analytics ──
                FS.trackCompleteRegistration(finalPayload, cfg);

                // ── User hook: onSubmitSuccess ──
                if (cfg.onSubmitSuccess) cfg.onSubmitSuccess(finalPayload);

                // ── Persist to localStorage (payment leg reads from here) ──
                const localFields = [
                    'email','phone','fullname','price','course','mkter','campaign',
                    'deal_id','px','redirect_url','callback_url','discountCode',
                    'type','orderbump','orderbumpdetail','bonusdetail','landing_url'
                ];
                localFields.forEach(function (k) { store.set('local', k, finalPayload[k] || ''); });

                // ── Payment / redirect ──
                await FS.submitPayment(finalPayload, cfg);

            } catch (err) {
                console.error('[FS] Submit error:', err);
                const customMsg = cfg.onSubmitError && cfg.onSubmitError(err);
                showError(customMsg || ('เกิดข้อผิดพลาดในการส่งข้อมูล กรุณาลองใหม่อีกครั้ง (' + (err.message || 'Network error') + ')'));
            }
        });
    };


    // ─────────────────────────────────────────────────────────────
    // § Bootstrap — single entry point
    // ─────────────────────────────────────────────────────────────

    /**
     * FS.bootstrap(cfg)
     *
     * cfg = {
     *   // Required
     *   PXID:                  '730310827487374',
     *   TIKTOKPXID:            'CDOSLUJC77UEAU3QUFCG',
     *   GTM_ID:                'GTM-WGRX2GT',
     *   SITE_KEY:              '6LcF...',
     *   WEBHOOK_FORM_ACTION:   'https://futureskill.app.n8n.cloud/webhook/...',
     *   landingPageType:       'SGC',   // 'SGC' (Linkpay) | 'YR' (LIFF)
     *   hiddenFieldConfig:     { mkter, campaign, price, course, redirect_url, ... },
     *
     *   // Optional
     *   formSelector:              '#leadForm',    // default: '#leadForm, #lead-form, [data-fs-form]'
     *   submitButtonSelector:      '#submitBtn',   // default: first button[type=submit] in form
     *   errorBoxSelector:          '#formError',   // null → fall back to alert()
     *   submitButtonDefaultText:   'ยืนยันการสมัครและชำระเงิน',
     *   submitButtonLoadingText:   'กำลังเตรียมอัพสกิล..',
     *   recaptchaAction:           'formSubmit',
     *   requiredHiddenFields:      ['price','course','campaign','px','deal_id','landing_url'],
     *   enableSpamBlock:           true,
     *   debug:                     false,   // true → console.table(payload) on each submit
     *
     *   // Hooks
     *   onBeforeSubmit:  (payload) => payload,  // mutate/validate payload; return it
     *   onSubmitSuccess: (payload) => {},
     *   onSubmitError:   (err)     => 'custom error message or null',
     * }
     */
    FS.bootstrap = function (cfg) {
        if (!cfg) { console.error('[FS] FS.bootstrap(config) requires a config object'); return; }

        FS._cfg = cfg;  // store for affiliate listener

        // 1. FSInit dataLayer event
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'FSInit', PXID: cfg.PXID });

        // 2. Load third-party trackers
        FS.loadGTM(cfg.GTM_ID);
        FS.loadTikTokPixel(cfg.TIKTOKPXID);
        FS.loadRecaptcha(cfg.SITE_KEY);

        // 3. Affiliate script
        FS.initAffiliate();

        // 4. Form hydration + submit handler (needs DOM)
        function run() {
            FS.hydrateHiddenFields(cfg);
            FS.attachPackageSelectSync(cfg);
            FS.handleSubmit(cfg);
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    };


    // ─────────────────────────────────────────────────────────────
    // § Affiliate edge-case: dataLayer → auto-submitPayment
    // If FSCompleteRegistration fires before submitPayment was called
    // (can happen when affiliate code triggers submitPayment separately),
    // reconstruct from localStorage and submit.
    // ─────────────────────────────────────────────────────────────

    let _paymentDispatched = false;

    // Proxy dataLayer so we can listen for push events
    window.dataLayer = new Proxy(window.dataLayer || [], {
        set: function (target, prop, value) {
            if (prop !== 'length') {
                window.dispatchEvent(new CustomEvent('fs:datalayerpush', { detail: value }));
            }
            return Reflect.set(target, prop, value);
        }
    });

    window.addEventListener('fs:datalayerpush', async function (event) {
        if (
            event.detail &&
            event.detail.event === 'FSCompleteRegistration' &&
            FS.getAffiliateId() &&
            !_paymentDispatched &&
            FS._cfg
        ) {
            _paymentDispatched = true;
            const keys = [
                'email','phone','fullname','price','course','mkter','campaign',
                'deal_id','px','redirect_url','callback_url','discountCode',
                'type','orderbump','orderbumpdetail','bonusdetail','landing_url'
            ];
            const payload = {};
            keys.forEach(function (k) { payload[k] = store.get('local', k, ''); });
            await FS.submitPayment(payload, FS._cfg);
        }
    });

})(window, document);
