# یکپارچگی با میزکار

## نصب و پیش‌نیاز

```bash
./scripts/install-integration.sh            # .desktop + هندلر پیش‌فرض پوشه‌ها
./scripts/install-integration.sh --with-kde-shortcut
```

اسکریپت این کارها را می‌کند:

1. `~/.local/share/applications/max-file-manager.desktop` را می‌سازد (با آیکون `build/icon.png`).
   اگر بیلد بسته‌بندی‌شده باشد همان باینری اجرا می‌شود، وگرنه Electron داخل مخزن.
2. `update-desktop-database` را اجرا می‌کند.
3. اپ را **هندلر پیش‌فرض `inode/directory` و `x-scheme-handler/file`** می‌کند:
   ```bash
   xdg-mime default max-file-manager.desktop inode/directory
   ```
4. راهنمای کلید میان‌بر KDE و محدودیت ویندوز را چاپ می‌کند.

## تک‌نمونه (single instance)

اپ با `app.requestSingleInstanceLock()` بالا می‌آید: اگر نسخهٔ دیگری باز باشد، نسخهٔ دوم بلافاصله
خارج می‌شود و **همان پنجرهٔ باز** را جلو می‌آورد و اگر مسیری به‌عنوان آرگومان داده شده باشد، آن را
در پنل فعال باز می‌کند (`app:open-path`).

اندازه‌گیری واقعی: نسخهٔ دوم با آرگومان مسیر در **۱۵۰۹ میلی‌ثانیه** با کد خروج ۰ تمام شد و نسخهٔ
اول باز ماند.

## «Open Containing Folder» فایرفاکس و `xdg-open`

فایرفاکس روی لینوکس برای «پوشهٔ شامل فایل را باز کن» هندلر پیش‌فرض سیستم برای `inode/directory`
را صدا می‌زند (و اگر آن نبود، `org.freedesktop.FileManager1` روی D-Bus). با اجرای اسکریپت نصب،
هندلر پیش‌فرض همین اپ می‌شود و مسیر پوشه به‌عنوان آرگومان به اپ می‌رسد:

```
xdg-mime query default inode/directory   # → max-file-manager.desktop
```

بررسی دستی: `xdg-open /tmp` باید همین اپ را باز کند.

**باقی‌مانده (در نقشهٔ راه):** پیاده‌سازی سرویس D-Bus `org.freedesktop.FileManager1`
(`ShowItems`/`ShowFolders`) تا برنامه‌هایی که مستقیم D-Bus را صدا می‌زنند (برخی فایل‌دیالوگ‌های
GTK، تلگرام دسکتاپ) هم همین اپ را باز کنند و فایلِ مشخص را انتخاب کند.

## کلید Win+E

### KDE Plasma 6

Plasma 6 `khotkeys` را حذف کرده و میان‌بر دلخواه از مسیر تنظیمات ساخته می‌شود:

1. System Settings → Keyboard → Shortcuts
2. **Add** → **Command or Script**
3. فرمان اسکریپت را کپی کن (همان که پرینت می‌شود) و بعد کلید **Meta+E** را بگیر.

### کلید سراسری داخل خود اپ

در تنظیمات → «راه‌اندازی» یک کلید سراسری هست (پیش‌فرض `Super+E`، قابل خاموش/روشن). این مسیر
`globalShortcut` الکترون را استفاده می‌کند:

- روی **X11** کار می‌کند — تأیید شده: `registerHotkey('Super+E')` → `{ok: true}` و
  `Ctrl+Alt+M` هم ثبت شد.
- روی **Wayland** فقط اگر پورتال `GlobalShortcuts` در دسترس باشد؛ وگرنه ثبت نمی‌شود و اپ خودش
  پیام می‌دهد «کلید ثبت نشد — در تنظیمات KDE به Add Command بده».

### ویندوز

`Win+E` مال Explorer است و یک اپ معمولی نمی‌تواند آن را بگیرد. دو مسیر واقعی:

1. کلید سراسری داخل اپ با ترکیبی آزاد (مثلاً `Ctrl+Alt+E`).
2. اگر دقیقاً `Win+E` لازم است: یا بایند Explorer را با یک remapper عوض کن، یا حالت
   Explorer-replacement را فعال کن (در نقشهٔ راه، فاز انتشار).

## بررسی سلامت

```bash
xdg-mime query default inode/directory        # باید max-file-manager.desktop باشد
grep -E '^(Exec|MimeType|Icon)=' ~/.local/share/applications/max-file-manager.desktop
```
