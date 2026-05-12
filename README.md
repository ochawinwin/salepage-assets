# salepage-assets

Shared static assets for FutureSkill sale pages — served via jsDelivr CDN.

## What's in here

| File | Description |
|---|---|
| `scripts/main-v2.js` | Shared sale page library (see below) |

---

## main-v2.js — Sale Page Library

A single-file JavaScript library that powers all FutureSkill sale pages. Drop 3 lines into any sale page HTML and it handles everything: form validation, UTM tracking, reCAPTCHA, spam blocking, lead submission to n8n, and payment redirect (Linkpay or LINE LIFF).

### CDN URL

```
https://cdn.jsdelivr.net/gh/ochawinwin/salepage-assets@master/scripts/main-v2.js
```

### Usage

Add these 3 lines to the top of `<head>`:

```html
<script>
const FS_CONFIG = {
    PXID:               '<facebook-pixel-id>',
    TIKTOKPXID:         '<tiktok-pixel-id>',
    GTM_ID:             '<gtm-id>',
    SITE_KEY:           '<recaptcha-v3-site-key>',
    WEBHOOK_FORM_ACTION:'<n8n-webhook-url>',
    landingPageType:    'SGC',   // 'SGC' = Linkpay | 'YR' = LINE LIFF
    hiddenFieldConfig: {
        mkter: '',
        campaign_id: '',
        campaign: '',
        price: '',
        course: '',
        discountCode: '',
        channel_name: 'Facebook',
        redirect_url: '',
        callback_url: '',
        email_cf_channel: '',
    },
    formSelector:            '#leadForm',
    submitButtonSelector:    '#submitBtn',
    errorBoxSelector:        '#formError',
    submitButtonDefaultText: 'ยืนยันการสมัครและชำระเงิน',
    submitButtonLoadingText: 'กำลังเตรียมอัพสกิล..',
};
</script>
<script src="https://cdn.jsdelivr.net/gh/ochawinwin/salepage-assets@master/scripts/main-v2.js"></script>
<script>FS.bootstrap(FS_CONFIG);</script>
```

### Sale page types

**Type A — Linkpay** (`landingPageType: 'SGC'`)
- Form id: `#leadForm`, submit button: `#submitBtn`
- After submit: redirect to `pay.futureskill.co/...`

**Type B — LINE LIFF** (`landingPageType: 'YR'`, `email_cf_channel: 'line'`)
- Form id: `#lead-form`, submit button: `#submit-btn`
- After submit: redirect to `liff.line.me/...`

### What it does

1. **Tracking** — captures UTM params, fbclid, gclid, ttclid on first touch (sessionStorage-persistent)
2. **Hydration** — fills all hidden form fields (static config + URL overrides + tracking params + runtime px/deal_id)
3. **Validation** — email regex, phone format (Thai), name cleanup, spam blocklist
4. **reCAPTCHA** — gets token before submit
5. **Webhook** — POSTs lead payload to n8n (Zoho CRM + conversion tracking)
6. **Analytics** — fires TikTok `CompleteRegistration`, GTM `FSCompleteRegistration`
7. **Payment** — creates cart via pay-api → redirects to Linkpay or LINE LIFF

### Config reference

| Key | Required | Description |
|---|---|---|
| `PXID` | ✅ | Facebook Pixel ID |
| `TIKTOKPXID` | ✅ | TikTok Pixel ID |
| `GTM_ID` | ✅ | Google Tag Manager ID |
| `SITE_KEY` | ✅ | reCAPTCHA v3 site key |
| `WEBHOOK_FORM_ACTION` | ✅ | n8n webhook URL |
| `landingPageType` | ✅ | `'SGC'` or `'YR'` |
| `hiddenFieldConfig` | ✅ | Static values for all hidden fields |
| `formSelector` | — | Default: `#leadForm` |
| `submitButtonSelector` | — | Default: `#submitBtn` |
| `errorBoxSelector` | — | DOM element to show errors. `null` → `alert()` |
| `submitButtonDefaultText` | — | Button label (HTML allowed) |
| `submitButtonLoadingText` | — | Loading label |
| `requiredHiddenFields` | — | Fields to warn if empty |
| `enableSpamBlock` | — | Default: `true` |
| `debug` | — | `true` → `console.table(payload)` on submit |
| `onBeforeSubmit` | — | Hook: `(payload) => payload` |
| `onSubmitSuccess` | — | Hook: `(payload) => void` |
| `onSubmitError` | — | Hook: `(err) => 'custom message or null'` |

---

## CDN & Caching

jsDelivr caches files for up to 12 hours. After pushing changes to `scripts/`, the cache is **purged automatically** via GitHub Actions.

To purge manually:

```
https://purge.jsdelivr.net/gh/ochawinwin/salepage-assets@master/scripts/main-v2.js
```

Then hard-refresh sale pages with `Ctrl+Shift+R`.
