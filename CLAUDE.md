# salepage-assets

Shared FutureSkill sale page library. CDN-served via jsDelivr.

## After git push to master

Always purge jsDelivr cache after pushing changes to `scripts/`:

```bash
curl "https://purge.jsdelivr.net/gh/ochawinwin/salepage-assets@master/scripts/main-v2.js"
```

This is also automated via GitHub Actions (`.github/workflows/purge-cdn.yml`) but run manually if the action hasn't triggered yet.

## CDN URL

```
https://cdn.jsdelivr.net/gh/ochawinwin/salepage-assets@master/scripts/main-v2.js
```

## Files

- `scripts/main-v2.js` — shared sale page library (FS namespace)
- `assets/` — shared images and static assets
