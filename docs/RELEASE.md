# ریلیز خودکار

با زدن یک تگ `vX.Y.Z` و پوش‌کردن آن، گیت‌هاب ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) خودش هر سه پلتفرم را می‌سازد و یک ریلیز با فایل‌های نصبی منتشر می‌کند.

## چک‌لیست تگ

1. نسخه را در `package.json` بالا ببر (تنها منبع شمارهٔ نسخه است).
2. `npm test` و `npm run typecheck` را محلی سبز کن.
3. کامیت کن و تگ بزن:

```bash
git tag v0.25.0
git push origin v0.25.0
```

اگر نسخهٔ `package.json` با تگ یکی نباشد، جاب `check` با پیام روشن fail می‌شود و هیچ ریلیزی ساخته نمی‌شود.

## چه چیزی ساخته می‌شود

| سیستم | فایل‌ها | مرحله |
|---|---|---|
| لینوکس (ubuntu-latest) | `.AppImage` و `.deb` | `electron-builder --linux AppImage deb` |
| ویندوز (windows-latest) | نصب‌کنندهٔ NSIS (`.exe`) | `electron-builder --win nsis` |
| مک (macos-latest) | `.dmg` و `.zip` برای `x64` و `arm64` | `electron-builder --mac dmg zip --x64 --arm64` |

نام فایل‌ها از قالب `max-file-manager-<version>-<os>-<arch>.<ext>` می‌آید (در `electron-builder.yml`). برای لینوکس arch بسته به هدف `x86_64` (AppImage) یا `amd64` (deb) است؛ نمونه: `max-file-manager-0.25.0-linux-x86_64.AppImage`.

## امضا

فعلاً هیچ بیلد امضا نمی‌شود:

- **مک**: بیلدها **ad-hoc** امضا می‌شوند (`identity: '-'` و `hardenedRuntime: false`) تا نسخهٔ arm64 بدون خطای «damaged» بالا بیاید، ولی Gatekeeper هنوز هشدار می‌دهد: بار اول فایل dmg را باز کن، برنامه را به Applications بکش و **راست‌کلیک → Open** بزن. برای امضای واقعی و notarize بعداً `identity` را به نام گواهی عوض کن و `CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/`APPLE_TEAM_ID` را secret کن.
- **ویندوز**: SmartScreen ممکن است هشدار «Unknown publisher» بدهد تا وقتی گواهی کد امضا اضافه شود.

## تست بدون تگ

از تب Actions، workflow را با **Run workflow** اجرا کن: هر سه پلتفرم ساخته می‌شوند و فایل‌ها به‌صورت artifact در همان اجرا می‌مانند، ولی ریلیزی منتشر نمی‌شود (شرط `startsWith(github.ref, 'refs/tags/v')`).

## درون برنامه

برنامهٔ به‌روزرسانی (`src/main/updates.ts`) فهرست ریلیزهای همین مخزن را از GitHub می‌خواند و لینک صفحهٔ ریلیز را باز می‌کند؛ پس تگ باید دقیقاً `vX.Y.Z` باشد تا مقایسهٔ نسخه درست کار کند.
