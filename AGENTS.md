# AGENTS.md — max-file-manager

راهنمای همهٔ عامل‌های هوش مصنوعی که روی این مخزن کار می‌کنند. **قبل از هر تغییری این را بخوان.**
(برگرفته از `/data/Codes/AGENTS/AGENTS-TEMPLATE.md` و پر‌شده برای همین پروژه؛ هر بخشی که دربارهٔ این پروژه درست نیست حذف شده است.)

## نقش و استک

یک فایل‌منیجر دو‌پنجره‌ای رومیزی برای KDE و ویندوز، با سطح امکانات Directory Opus.
- **استک (با نسخه):** Electron 45 · Node 26 (زمان اجرا: Node داخلی Electron) · TypeScript 5.9 strict · React 19 · Vite 7 از راه `electron-vite` 4 · CSS دستی (بدون Tailwind، بدون کتابخانهٔ UI)
- **بیلد بسته:** `electron-builder` 26 — لینوکس AppImage/deb، ویندوز NSIS
- **دیتابیس:** ندارد و نباید داشته باشد (تنظیمات فایل JSON در `app.getPath('userData')` — هنوز پیاده نشده)
- **زبان محصول:** برچسب‌های UI فعلاً انگلیسی؛ فارسی/RTL جزو نقشهٔ راه است، نه امروز · **زبان گفتگو با من:** فارسی

## مدل دسترسی

تک‌کاربره و محلی است؛ سرور، حساب، شبکه و همگام‌سازی نداریم.
- **مرز اعتماد:** هرچه در فرایند اصلی (main) اجرا می‌شود اجازهٔ کامل فایل‌سیستمِ کاربر را دارد؛ رندرر هیچ دسترسی مستقیمی به `fs` ندارد و فقط از پل `preload` استفاده می‌کند.
- **دسترسی فایل‌ها:** همان مجوزهای سیستم‌عامل. برنامه هیچ مجوزی را دور نمی‌زند و `sudo`/`pkexec` صدا نمی‌زند.
- **دادهٔ حساس:** هیچ داده‌ای جمع‌آوری یا ارسال نمی‌شود. هیچ تلمتری، آنالیتیکس یا درخواست شبکه‌ای در برنامه نیست. اگر روزی لازم شد، اول از من بپرس.
- **کاربر بدون لاگین:** مفهوم ندارد؛ هرچه کاربرِ سیستم می‌بیند، برنامه هم می‌بیند.

## دستورها

```bash
npm install
npm run dev                # اجرای محیط توسعه (hot reload رندرر)
npm run build              # بیلد به out/  ← پیش از هر تحویل
npm run typecheck          # tsc روی main/preload و renderer
npm test                   # تست‌های واحد (node --test): انتقال/Undo، جست‌وجو/تکراری، تغییر نام، توابع خالص
# دیدن خروجی واقعی بدون باز کردن پنجره روی میزکار:
SMOKE_SHOT=/tmp/mfm.png xvfb-run -a npx electron .   # یک اسکرین‌شات می‌گیرد و خارج می‌شود
SMOKE_JS="<js>" SMOKE_SHOT=/tmp/mfm.png xvfb-run -a npx electron .   # همان، ولی اول UI را با JS کلیک کن
npm run dist:linux         # AppImage + deb
npm run dist:win           # NSIS (روی لینوکس با wine؛ روی ویندوز مستقیم)
```

**چطور تغییر را ببینم (بدون بیلد بی‌مورد):** `npm run dev` hot reload دارد؛ برای تأیید یک تغییر UI هرگز `dist` نزن.
**چطور بفهمم خروجی سالم است:** `typecheck` سبز + `SMOKE_SHOT` یک PNG واقعی بدهد + تست‌های `format.test.ts` سبز. اسکرین‌شات را خودت با vision ببین، نه اینکه فقط وجود فایل را چک کنی.

## نقشهٔ مخزن

```
src/main/index.ts      فرایند اصلی: پنجره، IPC فایل‌سیستم، محاسبهٔ اندازه، state، پروتکل mfm://
src/main/jobs.ts       صف انتقال (پیشرفت/مکث/لغو)، Undo، تغییر نام گروهی، پوشهٔ نو — + تست
src/main/search.ts     walk بازگشتی، تطبیق نام (wildcard/regex)، جست‌وجوی محتوا، یابندهٔ تکراری — + تست
src/main/ops.ts        حذف/سطل بازیافت + freeName — تنها جای حذف، + تست
src/main/archives.ts   خواندن zip/tar و استخراج (fflate + پارسر tar داخلی، بدون ابزار سیستم) — + تست
src/main/meta.ts       ظاهر پوشه در فایل مخفی `.mfm.json` داخل همان پوشه — + تست
src/main/icons.ts      کشف پک‌های آیکون (KDE/سیستمی/دلخواه) و فهرست آیکون‌های هر پک — + تست
src/main/preview.ts    پیش‌نمایش متن/تصویر/صدا/ویدیو با سقف حجم — + تست
src/main/hash.ts       sha256 جریانی برای فایل‌ها (checksum و یابندهٔ تکراری از همین استفاده می‌کنند) — + تست
src/main/types.ts      تایپ‌های مشترک فرایند اصلی (Entry/DirRef/Listing/Result)
src/preload/index.ts   تنها پل به رندرر؛ هرچه اینجا نباشد از رندرر در دسترس نیست
src/renderer/src/App.tsx      حالت دو پنجره، کلیدهای میان‌بر، عملیات، ذخیرهٔ نشست، دیالوگ‌ها
src/renderer/src/Pane.tsx     یک پنجره: تب، مسیر، صافی، جست‌وجو، نوار عملیات، لیست/شبکه مجازی
src/renderer/src/Sidebar.tsx  درخت پوشه‌ها (باز شدن تنبل) + نشان‌شده‌ها
src/renderer/src/JobsBar.tsx  نوار عملیات‌ها: پیشرفت، سرعت، مکث/ادامه، لغو، خطا
src/renderer/src/RenameDialog.tsx  تغییر نام گروهی با پیش‌نمایش زنده
src/renderer/src/TitleBar.tsx      تایتل‌بار خود برنامه (drag، کوچک/بزرگ/بستن)
src/renderer/src/Preferences.tsx پنجرهٔ تنظیمات: دسته‌ها، صفحه‌ها، اعمال فوری
src/main/image.ts      ذخیرهٔ تصویر ویرایش‌شده (data URL → فایل، اتمیک) — + تست
src/renderer/src/prefs.ts    تنها منبع تنظیمات (نوع Prefs + DEFAULTS + mergePrefs + مهاجرت) — + تست
src/renderer/src/Gallery.tsx گالری تصاویر تمام‌پنجره (پیمایش، بزرگ‌نمایی، چرخش، پخش خودکار)
src/renderer/src/FolderDialog.tsx  رنگ و آیکون پوشه + انتخاب پک آیکون
src/renderer/src/ContextMenu.tsx   منوی راست‌کلیک داده‌محور (موارد در App ساخته می‌شوند)
src/renderer/src/PreviewPanel.tsx  پنل پیش‌نمایش کنار
src/renderer/src/Icons.tsx    همهٔ آیکون‌های SVG خطی (currentColor) + نگاشت نوع→آیکون
src/renderer/src/format.ts    توابع خالص (اندازه، تاریخ، مسیر، مرتب‌سازی، صافی، نوع، planRename) + تست
src/renderer/src/style.css    تمام ظاهر؛ متغیرهای تم بالا، رنگ هر نوع فایل
docs/FEATURES.md       ماتریس امکانات Directory Opus و فازبندی
```

## قواعد کد

- **هیچ منطق فایل‌سیستمی در رندرر ننویس.** هر `fs` در `src/main` است و از IPC رد می‌شود؛ پل `preload` را فقط با نیاز واقعی بزرگ کن.
- **لیست‌ها همیشه مجازی‌شده بمانند** (windowed). هر تغییر در `Pane.tsx` که همهٔ ردیف‌ها را رندر کند، پس‌زنی است: پوشهٔ ۱۰۰هزار فایلی باید روان بماند.
- **الگوهای موجود را تکرار کن:** استایل با متغیرهای CSS، منطق خالص در `format.ts` با تست، حالت در `App.tsx` با `useState` — هیچ state manager، router یا کتابخانهٔ کامپوننت اضافه نکن مگر لازم شود.
- **بدون `any` جدید**؛ مسیرهای ورودی از رندرر در main اعتبارسنجی می‌شوند (`path.isAbsolute`) و هرگز به `exec`/`shell` خام نمی‌روند.
- **زبان UI فارسی و یکدست است.** هر خطی که حرف فارسی دارد راست‌چین و RTL، و مسیرها و نام فایل‌ها چپ‌چین (`dir="auto"` روی نام/کرامب، `direction: ltr` برای نوار مسیر). ارقام با `fa()` فارسی می‌شوند — عدد لاتین در UI جا نگذار.
- **آیکون تازه فقط در `Icons.tsx`**: SVG خطی با `currentColor` و ضخامت ۱.۷، هم‌اندازه با بقیه. ایموجی، فونت‌آیکون و کتابخانهٔ آیکون اضافه نکن.
- **فونت از npm می‌آید، نه CDN** (Vazirmatn) — برنامه باید کاملاً آفلاین کار کند.
- **بازخورد عملیات:** هر عملیات طولانی باید وضعیت را در نوار پایین نشان دهد، نه اینکه بی‌صدا بماند.
- **هر تنظیم تازه فقط در `prefs.ts`** (نوع + DEFAULTS + mergePrefs). هیچ تنظیمی را پراکنده در state یا کامپوننت نگذار؛ مقدار نامعتبر روی دیسک نباید بوت را بشکند.
- **تک‌نمونه**: قفل با `app.requestSingleInstanceLock()` پیش از `ready` گرفته می‌شود و تنظیمش از `state.json` سنکرون خوانده می‌شود (فریم و شفافیت پنجره هم همان‌جا).
- **ظاهر پوشه فقط از راه `meta.ts`** (`.mfm.json` داخل خود پوشه). هیچ تنظیم ظاهری را در `state.json` یا سیستم‌عامل نگه ندار: باید با پوشه سفر کند.
- **آیکون‌ها یا از `Icons.tsx` می‌آیند یا از پک روی دیسک با پروتکل `mfm://`** — مسیر مطلق؛ هیچ آیکون دانلودی/CDN.
- **فریم و شفافیت پنجره فقط در ساخت پنجره قابل تغییر است**؛ `window:setChrome` پنجره را بازسازی می‌کند، پس هیچ state رندرری را قبل از بازسازی روی دیسک فرض نکن.
- **رها کردن فایل از بیرون**: مسیر فایل را فقط با `api.pathForFile(file)` بگیر (در preload با `webUtils`) — هر راه دیگری شکست می‌خورد.
- **پیش‌نمایش سقف دارد** (۲۰۰KB متن، تصویر بزرگ inline نمی‌شود)؛ سقف را بی‌دلیل بالا نبر و همیشه «بریده شد» را نشان بده.
- **کپی/انتقال فقط از راه `jobs.ts`** (صف + پیشرفت + لغو). هیچ‌جا `fs.cp` مستقیم برای انتقال ننویس و برای حذف فقط از `ops.remove` استفاده کن.
- **یکپارچگی سیستم دستی انجام نمی‌شود**: نصب `.desktop`، هندلر پیش‌فرض و کلید سراسری همه از `scripts/install-integration.sh` و `hotkey:register` می‌گذرند؛ مسیرها را در سند `docs/INTEGRATION.md` نگه دار. کلید سراسری روی X11 جواب می‌دهد و روی Wayland ممکن است ثبت نشود — شکست باید به کاربر گزارش شود، نه بی‌صدا.
- **همگام‌سازی «جدیدتر برنده» است**: در `sync.ts` اگر mtime بیش از ۲ ثانیه تفاوت داشته باشد جهت از همان تعیین می‌شود؛ تفاوت اندازه با زمان یکسان `sizeDiff` (مشکوک) است و در هر دو جهت پیشنهاد می‌شود. حذف همیشه از طریق callback تزریق‌شده (`shell.trashItem`) انجام می‌شود — این ماژول هیچ‌وقت hard-delete نمی‌کند و باید همین‌طور بماند.
- **پیش‌نمایش HTML هرگز اجرا نمی‌شود**: `iframe` با `sandbox=""` (بدون allow-scripts) و `cleanHtml` که script/iframe/object/on*/`javascript:` را حذف می‌کند. هر دو لایه لازم‌اند؛ هیچ‌وقت sandbox را بازتر نکن.
- **پنل کنار = جای پنل روبرو**: پیش‌نمایش/ادیتور در `.side-slot` رندر می‌شوند؛ در دو‌پنلی جای پنل `1-active` و در تک‌پنلی کنار پنل فعال. اسکرول افقی در ادیتور ممنوع است (wrap پیش‌فرض).
- **ترمینال/میان‌افزار میزکار در `src/main/desktop.ts`**: پرتاب باید `spawn(detached, stdio:'ignore')` باشد و منتظر خروج فرآیند نماند، وگرنه ترمینال باز می‌ماند و call هرگز برنمی‌گردد.
- **MCP قرارداد دارد**: `docs/MCP.md` مرجع ابزارها و قواعد امنیتی است؛ سرور MCP نباید عملیات فایل را از نو پیاده کند، فقط همان IPC اپ را روی loopback لو بدهد (پیش‌فرض خاموش، read-only، توکن، لاگ دسترسی).
- **ادیتور بصری از گنجینه آمده**: `visual.ts` همان تنظیمات Milkdown/Crepe نسخهٔ وب گنجینه است (AI و TopBar و LaTeX خاموش، پلاگین جهت با node decoration، listener **قبل** از `create()`). هر تغییر در آن باید با `tools/milkdown-editor/src/entry.js` گنجینه هم‌خوان بماند و فونت/رنگ از متغیرهای `--crepe-*` تم بگیرد.
- **markdown یک مسیر دارد**: `md.ts → renderMarkdown` (marked + highlight.js + DOMPurify + `direction.ts`). ویرایشگر، پنل پیش‌نمایش و خروجی PDF هر سه از همین می‌خوانند؛ هر جای دیگری markdown رندر نکن.
- **جهت متن از `direction.ts` می‌آید** (پورت `auto-direction` پورتال): هر بلوک `dir` خودش را از اولین حرف قوی می‌گیرد و `<pre>/<code>` همیشه `dir="ltr"`. این کار روی خود مارک‌آپ انجام می‌شود، نه فقط CSS.
- **ویرایشگر لایه‌ای است**: یک `<pre>` رنگ‌آمیزی‌شده زیر یک `<textarea>` شفاف؛ هر تغییر در فونت/پدینگ/line-height باید روی هر دو کلاس `.ed-hl` و `.ed-ta` هم‌زمان اعمال شود وگرنه کرسر با متن ناهم‌تراز می‌شود. اسکرول دو لایه در `syncScroll` قفل شده است.
- **ذخیرهٔ متن اتمیک است**: `writeTextFile` اول فایل موقت بعد `rename`، با نگه‌داشتن mode و سقف ۸MB؛ هیچ نوشتن مستقیمی روی فایل باز نکن.
- **آرشیو ساختن استریم است**: `createZip` با `AsyncZipDeflate` + `Zip` مستقیم روی `createWriteStream` می‌نویسد و فقط بعد از `final` callback صبر می‌کند؛ اگر منتظر `zip.end()` بدون آن بمانی فایل zip ناقص می‌شود («invalid zip data»).
- **قالب تصویر**: `commit` همیشه در قالب خود فایل انکود می‌کند تا «جایگزینی» دروغ نباشد؛ قالب/کیفیت انتخابی کاربر فقط در «ذخیره به‌عنوان کپی» با یک انکود مجدد اعمال می‌شود.
- **منطق خالص را از `electron` جدا کن**: تست‌های `node --test` نمی‌توانند `electron` را import کنند، پس مقایسهٔ نسخه و انتخاب ریلیز در `updates-core.ts` است و `updates.ts` فقط شبکه/شل. همین الگو برای هر ماژول تازه‌ای که هم منطق دارد هم IPC.
- **جست‌وجو با `node:sqlite` است، نه پکیج بومی**: Electron 45 نود ۲۴ دارد و FTS5 کار می‌کند (تست‌شده با متن فارسی). جدول `files` منبع حقیقت است و `fts` با rowid همان ردیف‌ها هم‌گام می‌شود؛ هر upsert اول ردیف fts قدیمی را پاک می‌کند.
- **ایندکس افزایشی است**: `dirs.mtime` مبنای رد کردن زیردرخت است؛ اگر روزی محتوای فایل هم مهم شد باید mtime فایل هم بررسی شود.
- **بندانگشتی‌ها از `thumb://` می‌آیند نه `mfm://`**: کلید کش sha1(مسیر+mtime+اندازه+اندازهٔ تصویر) است، پس تغییر فایل خودش کش را باطل می‌کند؛ `img-src` باید `thumb:` را مجاز بداند. هرس LRU هر ۵۰ نوشتن اجرا می‌شود.
- **اسکریپت‌های کاربر متن خود کاربرند**: `app:runScript` با `sh -c` و `{path}`/`{dir}` که single-quote می‌شوند اجرا می‌کند، `timeout` ۶۰ ثانیه و خروجی بریده. هیچ دستور پیش‌فرضی در کد نیست.
- **PDF همیشه روشن ساخته می‌شود**: تم تیره PDF را در پیش‌نمایش و چاپ ناخوانا می‌کند (یک بار همین اتفاق افتاد)؛ `htmlToPdf` با `'light'` صدا زده می‌شود.
- **قالب هر پوشه در `.mfm.json` است** (`format: {view, columns, sortKey, sortAsc}`). `load()` آن را در state همان پنل (`fmt`) می‌گذارد و `viewOf/sortOf/columnsOf` آن را روی پنل اعمال می‌کنند؛ **هرگز `prefs` سراسری را بازنویسی نکن**، وگرنه با برگشتن به پوشهٔ بدون قالب، نمای پوشهٔ قبلی همه‌جا می‌ماند (یک بار همین شد: Downloads روی details، بعد home هم details). «ذخیرهٔ قالب این پوشه» همان مقادیر مؤثر پنل را می‌نویسد.
- **پوشه می‌تواند خودش را از فهرست پنهان کند**: `hidden: true` در `.mfm.json` همان پوشه (نه لیست در پوشهٔ والد، نه xattr). `list()` و `dirs()` آن را فقط وقتی نشان می‌دهند که `showHidden` روشن باشد و ردیف `entry.hidden`/`.meta-hidden` می‌گیرد؛ دکمهٔ «پنهان از فهرست» در منوی پوشه و در دیالوگ ظاهر پوشه است. کلید مخفی‌ها (Ctrl+H) همین را هم برمی‌گرداند.
- **فیلتر نام شناور است، نه ثابت**: دکمهٔ قیف در نوار آدرس آن را باز می‌کند و ورودی در `.filter-float` (پایین-راست پنل) می‌آید؛ فقط وقتی `filterOpen` یا `pane.filter` هست رندر می‌شود و با Esc (لیسنر پنجره، نه فقط input) بسته می‌شود. فرمان Ctrl+F با تیک پنل (`filterTick`) آن را باز و فوکوس می‌کند، چون ورودی وقتی بسته است در DOM نیست.
- **انتخاب مستطیلی روی `.rows`**: شروع فقط وقتی هدف داخل `.row/.tile` نیست؛ مختصات باند با `scrollLeft/scrollTop` جمع می‌شود و برخورد با `getBoundingClientRect` هر ردیف سنجیده می‌شود؛ `data-path` روی ردیف/کاشی منبع مسیرها است.
- **کلیپ‌بورد = فایل**: `paste` روی window فقط وقتی هدف input/textarea/contenteditable نیست؛ بایت‌ها به `clipboard:saveImage` می‌رود (main با `freeName` و نوشتن اتمیک) و پنل بعد از ذخیره رفرش و فایل را انتخاب می‌کند.
- **ویژگی‌ها یک IPC است، نه چند تا**: `fs:properties` با یک `lstat`/`stat` (و `readlink` برای پیوند) همهٔ فیلدها را می‌دهد؛ نام مالک/گروه با `getent` (کش، ۱ ثانیه timeout، fallback عددی) و ابعاد تصویر با `nativeImage` فقط برای تصاویر محاسبه می‌شود. محاسبهٔ چکیده‌ها از `api.hash` می‌آید، نه در همان پاسخ.
- **هر تغییر در برگهٔ ویژگی‌ها باید فهرست را تازه کند**: `onUpdate` در `PropertiesDialog` بعد از chmod/برچسب/ستاره/توضیح صدا زده می‌شود و `App` همان پنل فعال را `load` می‌کند؛ بدون آن مقدار در `.mfm.json` ذخیره می‌شد ولی نقطهٔ رنگ/ستون امتیاز تا نوسازی دستی دیده نمی‌شد. برچسب رنگی روی کاشی شبکه هم `.tile-lbl` دارد، نه فقط ردیف فهرست.
- **ویژگی‌ها تب دارد و هر تب یک منبع دارد**: عمومی/دسترسی‌ها/چکیده/جزئیات. تغییر مجوز فقط از `fs:chmod` (اعتبارسنجی مسیر مطلق و `0..0o7777`)؛ تغییر نام از همان `fs:renameMany` (اول با `fs:properties` مطمئن شو مقصد وجود ندارد، وگرنه `fs.rename` بازنویسی می‌کند)؛ برچسب/امتیاز/توضیح از `api.setLabel/setRating/setNote` در `.mfm.json`. ریاضی مجوز در `permLevel`/`permMode` (`format.ts`) تست دارد. تاریخ‌ها در RTL باید `dir="ltr"` بگیرند، وگرنه `dir="auto"` با ارقام فارسی آن‌ها را جابه‌جا نشان می‌دهد.
- **کلیدهای سخت‌کدشده نباید Enter/فلش را با مودیفایر بخورند**: شاخهٔ `if (ev.key === 'Enter')` بدون بررسی `altKey/ctrlKey/metaKey` بود و `Alt+Enter` (ویژگی‌ها) هیچ‌وقت به جدول فرمان‌ها نمی‌رسید. هر کلید سخت قبل از `return` مودیفایرهای خودش را چک کند.
- **effectAllowed باید dropEffect مقصد را مجاز بداند**: درگ پنل `copyMove` بود ولی سایدبار برای نشان‌کردن `link` می‌خواهد؛ نتیجه این بود که `dragover` اجرا می‌شد (کلاس `drop`) ولی رویداد `drop` هرگز نمی‌آمد. مقدار منبع `all` است. هر تغییر در این دو مقدار را با یک درگ واقعی (نه رویداد ساختگی) تست کن.
- **منوی راست‌کلیک گروه‌بندی دارد**: `MenuItem.children` یک زیرمنوی تودرتو است؛ پنل تودرتو با `position: fixed` **داخل** پنل ریشه رندر می‌شود تا از کلیپ `overflow-y` ریشه بیرون بزند و همچنان `ref.contains` برای بستن با کلیک بیرون معتبر بماند. باز شدن با هاور است و بسته‌شدن ۱۶۰ms تأخیر دارد تا عبور ماوس به پنل فرزند آن را نبندد؛ کلیک هم بازش می‌کند (لمسی/کیبورد). آیتم گروه `onPick` نمی‌گیرد، فقط `children`. پنل تودرتو با همان `rows` رندر می‌شود؛ بدون پرچم `inSub`، هاور روی هر آیتم فرزند `sub` را null می‌کند و منو همان لحظه که موس به آن می‌رسد بسته می‌شود (تست با موس واقعی، نه رویداد ساختگی).
- **نشان (bookmark) هدف انتخاب را می‌گیرد**: ستاره/منو پوشهٔ انتخاب‌شده را نشان می‌کند و فقط وقتی انتخاب folder نیست پوشهٔ باز؛ `marked` هم برای همان هدف حساب می‌شود (قبلاً پوشهٔ جاری را نشان می‌کرد و «کار نمی‌کند» به نظر می‌رسید). منوی پوشه آیتم مستقیم «نشان‌کردن/برداشتن نشان» دارد.
- **Ctrl+چرخ در نمای شبکه = اندازهٔ کاشی**: `onZoom` روی `.rows` فقط در `view==='grid'` و با `ctrlKey`، `preventDefault` و ۸px کم/زیاد در بازهٔ ۸۰–۲۴۰ (`prefs.tileSize`).
- **جداکنندهٔ پیش‌نمایش**: کلاس `.vsplit` بین پنل و `.side-slot` در هر دو چیدمان؛ نسبت در `prefs.sideWidth` (۰٫۲۵–۰٫۸) ذخیره می‌شود و در RTL جهت درگ برعکس است.
- **نوار هر پنل یک ردیف آدرس است**: ناوبری (بازگشت/جلو/بالا/نوسازی) کنار کرامب، و فیلتر + جست‌وجو + نشان در همان ردیف روبروی آدرس؛ ردیف `.actions` جدا حذف شد. هر دکمهٔ تازهٔ پنل را در همان ردیف بگذار، نه یک ردیف تازه (هر ردیف ~۳۵px از فهرست می‌گیرد).
- **حالت ظاهری یک نوار اقدام است، نه سه تا**: دکمه‌های عملیات فقط در `CommandBar` (از `prefs.toolbar` و `COMMANDS`) هستند؛ نوار هر پنل فقط ناوبری/جست‌وجو/نشان دارد و نوار وضعیت فقط اطلاعات. اکشن تازه = یک خط در `commands.ts` + آیکون در `commandIcons.tsx`؛ دکمهٔ تکراری در جای دیگر نساز.
- **تم سه حالت دارد**: `dark | light | system`. `system` با `matchMedia('(prefers-color-scheme: dark)')` زنده دنبال می‌شود و `dataset.theme` همان مقدار مؤثر را می‌گیرد؛ مقدار خام در `prefs.theme` می‌ماند و به ادیتور/پنل‌ها مقدار مؤثر می‌رود.
- **اندازه/جای پنجره در `window.json` است، نه `state.json`**: رندرر کل state را می‌نویسد و اگر bounds همان‌جا بود با هر ذخیرهٔ نشست پاک می‌شد. تصمیم «این مستطیل هنوز روی کدام نمایشگر است» در `window-bounds.ts` خالص و تست‌شده است؛ نمایشگرِ جدا‌شده ⇒ وسط نمایشگر اصلی. `hasShadow: false` و قاب فقط یک `border` ساده است.
- **کلاس `editor` مال Crepe است، نه پوستهٔ ما**: ProseMirror داخل Milkdown خودش `editor` می‌گیرد؛ وقتی پوستهٔ ادیتور هم `editor` بود، `.editor { position:absolute; z-index:70 }` روی محتوای ادیتور می‌نشست و آن را روی گالری/منوی راست‌کلیک/دیالوگ‌ها می‌کشید. پوسته `.ed-shell` است؛ هیچ کلاس عمومی مثل `editor`/`preview` را با کتابخانه شریک نشو.
- **گالری یک حالت تمام‌پنجره است**: با باز شدنش کلیدهای فرمان معلق می‌شوند (`if (editor || gallery) return`) و باز کردن ادیتور گالری را می‌بندد (`openEditor`). HTML با دوبار کلیک در **پیش‌نمایش ایزوله** باز می‌شود، نه با `api.open` (که فایل را به میزکار می‌داد).
- **ستون‌ها داده‌اند، نه کد ثابت**: عرض در `prefs.colWidths` و زیرنویس بندانگشتی در `prefs.gridMeta`؛ منوی سرستون (`onHeaderMenu`) با `ContextMenu` نوع `head`/`checked` همان‌ها را روشن/خاموش می‌کند. لبهٔ هر سرستون یک `.col-resize` دارد و در RTL جهت درگ برعکس می‌شود. ستون‌های غیرفعال را با `prefs.columns.includes(x)` فیلتر کن، نه با کل `COLUMNS` (یک بار همان اشتباه همهٔ ستون‌ها را روشن کرد).
- **آفیس فقط متن سند را نشان بده**: `docxText` بدنهٔ `word/document.xml` را با توکنایزر می‌خواند (پاراگراف/جدول/تب/`deleted`/field code)، xlsx با sharedStrings و pptx/odf هم جدا؛ خروجی خالی ⇒ `binary` («بدون پیش‌نمایش»)، نه XML خام. تست: `docxText`/`xlsxSheetText` در `preview.test.ts`.
- **`shell.openPath` دروغ می‌گوید**: روی لینوکس حتی وقتی `xdg-open` شکست می‌خورد رشتهٔ خالی برمی‌گرداند. پس «باز کردن» مسیر خودش را دارد: `openWithDefault` با `xdg-mime query default` همان `.desktop` پیش‌فرض را پیدا می‌کند و با `spawn(detached)` اجرا می‌کند (همان مسیری که «باز کردن با…» ثابت کرده کار می‌کند)؛ فقط اگر پیش‌فرضی نبود، زنجیرهٔ gio → xdg-open → kioclient5 → kde-open5. خطای واقعی به UI برمی‌گردد، نه رشتهٔ خالی.
- **منوی راست‌کلیک زیر هدر نمی‌رود و اسکرول می‌شود**: `useLayoutEffect` ارتفاع واقعی را می‌خواند، `top` را از بالای `.body` (نه از لبهٔ پنجره) می‌گیرد، `max-height` را از فضای باقی‌مانده می‌گذارد و منو را فوکوس می‌کند تا با کیبورد/چرخ اسکرول شود؛ تا وقتی منو باز است، کلیدهای میان‌بر اجرا نمی‌شوند (`if (editor || gallery || menu || columnMenu) return`).
- **پیوند نمادین از `dirent` می‌آید**: `stat` هدف را دنبال می‌کند، پس `d.isSymbolicLink()` در همان map لیستینگ `entry.link` را می‌گذارد؛ نشانش زنجیر نازک است (`LinkIcon`)، نه بج.
- **نوار بندانگشتی گالری با تصویر حرکت می‌کند**: اثر روی `at`، `activeThumb.scrollIntoView({inline:'center'})`؛ `scrollIntoView` در RTL درست کار می‌کند، `scrollLeft` منفی را دستی حساب نکن.
- **`Object.keys` روی آرایه** (`GROUP_ORDER`) کلیدهای `"0"…"4"` می‌دهد و صفحهٔ کلیدهای میان‌بر خالی می‌ماند؛ آرایه را مستقیم `map` کن. تست: `Preferences` → Shortcuts باید ردیف‌های `keycap` بدهد.
- **نمونه‌های نام‌دار (Layouts/Filters/FileTypes) در `prefs` هستند** و اعتبارسنجی‌شان در `prefs.ts` است: ستون ناشناس، رنگ غیرhex و نام خالی دور ریخته می‌شوند.
- **متادیتا فقط خوانده می‌شود**: `metadata.ts` ID3v2 و EXIF را بدون کتابخانه پارس می‌کند (تست با فایل ساخته‌شده). فیلدهای Rational (fnumber/focal) هنوز در نمی‌آیند — اگر لازم شد همان IFD را کامل کن.
- **کلیدهای متادیتا با نام فایل‌اند نه مسیر**: `fs:tags` با مسیر مطلق برمی‌گردد ولی `planRename` با نام؛ تبدیل در `RenameDialog` انجام می‌شود. این تله یک بار نام فایل‌ها را خراب کرد.
- **پیش‌نمایش PDF به پلاگین کرومیوم وابسته است**: پنجرهٔ اصلی `plugins: true` دارد و CSP باید `frame-src 'self' mfm:` را مجاز بداند؛ بدون این دو، قاب خالی می‌ماند.
- **`.mfm.json` یک نویسنده در هر لحظه دارد**: همهٔ نوشتن‌ها از `setMeta` و صف `serial(dir, …)` می‌گذرند. بدون آن، دو تنظیم هم‌زمان (مثلاً امتیاز + توضیح که با هم می‌آیند) همدیگر را پاک می‌کنند — تست `mfm-race` همین را قفل کرده است.
- **`.mfm.json` تنها جای حالتِ هر پوشه است**: `color`/`icon`/`pins`/`labels`. شناسهٔ برچسب‌ها فقط از پالت `LABELS` در `meta.ts` می‌آید (پالت در main اعتبارسنجی می‌شود و رندرر آن را با `labelPalette()` می‌گیرد — رنگ‌ها را در دو جا تکرار نکن). سنجاق فقط یک نام سادهٔ داخل همان پوشه است — هر نامی که جداکننده مسیر داشته باشد یا `..`/`.mfm.json` باشد رد می‌شود؛ فایل وقتی خالی شد پاک می‌شود.
- **آیکون پوشه سه منبع دارد و ترتیبش مهم است**: اول `icon` در `.mfm.json` (انتخاب خود کاربر در همین برنامه)، بعد `Icon=` در `.directory` (دلفین) و `IconResource=` در `desktop.ini` (ویندوز) با `folderlook.ts`، و در آخر گلیف خطی خودمان. آن دو فایل سیستم فقط **خوانده** می‌شوند؛ نام آیکون KDE (`folder-red`) با `resolveIconName` در `icons.ts` به فایل واقعی تم تبدیل می‌شود (ترتیب پوشه‌ها در تم‌ها متفاوت است: breeze اول context بعد size، hicolor برعکس).
- **آیکون تایپ باید `size` را بپذیرد**: هر گلیف در `GLYPHS` (`Icons.tsx`) باید prop اندازه را به `<S>` پاس بدهد، وگرنه در نمای شبکه با کاشی بزرگ، آیکون ۱۵px می‌ماند (همین یک بار اتفاق افتاد).
- **آیکون فایل از تم می‌آید مگر کاربر نخواهد**: `PREFERRED_THEME = 'Pure'` در `icons.ts`؛ `iconSetPaths()` یک‌بار نگاشت kind→فایل را می‌سازد و رندرر با `EntryIcon` نشانش می‌دهد. تم نبود؟ گلیف خطی. رنگِ `.mfm.json` رنگ‌آمیزی گلیف خطی است، پس رنگ‌دارها عمداً از تم استفاده نمی‌کنند. تم مورد علاقه در ترتیب `themeDirs` هم اول است تا «پک آیکون» دیالوگ پوشه از همان شروع شود.
- **پشت آیکون در نمای شبکه کادر نگذار**: `.thumb.flat` برای آیکون‌ها پس‌زمینه ندارد؛ فقط تصویر واقعی (`.thumb.pic`) جعبهٔ نرم را نگه می‌دارد.
- **رنگ پوشه بر آیکون سیستم مقدم است**: اگر `.mfm.json` رنگ داشته باشد، `list()` عمداً آیکون `.directory`/`desktop.ini` را نمی‌گذارد؛ وگرنه انتخاب کاربر دیده نمی‌شد (یک بار همین اتفاق افتاد). در `EntryIcon` هم رنگ‌دارها آیکون تم را کنار می‌گذارند.
- **هر اقدام منو باید مسیر همان کلیک راست را بگیرد**: `pickMenu` مسیر `menu.path` را دارد؛ `openFolderLook` و مانند آن نباید به `sel` یا تب فعلی تکیه کنند (رنگ روی پوشهٔ اشتباه ذخیره می‌شد).
- **نوار فرمان اندازه‌گیری‌شده است**: `CommandBar` یک کپی آفلاین از همهٔ دکمه‌ها را در `.cmdbar-probe` می‌سازد، عرض‌ها را می‌خواند و بقیه را در منوی «…» می‌گذارد. هیچ‌جا عرض دکمه را حدس نزن؛ با تغییر حالت (آیکون/متن) یا زبان، عرض‌ها عوض می‌شوند.
- **جست‌وجوی پنل بودجه دارد**: `walk` سطح‌به‌سطح (BFS) می‌گردد، اول نام را می‌سنجد و فقط برای تطبیق `stat` می‌زند، پوشه‌های رد‌شده (`searchExclude` و در حالت عادی `.*`) را پایین نمی‌رود و با `budgetMs` (۲.۵ ثانیه از UI) می‌ایستد. بدون این‌ها جست‌وجوی خانه دقیقه‌ها طول می‌کشید و کاربر فکر می‌کرد «هیچ کاری نمی‌کند».
- **استخراج هرگز بازنویسی نمی‌کند**: `extract` برای هر فایل `freeName` می‌گیرد؛ تست `archives.test.ts` همین را قفل کرده است.
- **سایهٔ پنجره از داخل می‌آید**: پنجره frameless و transparent است و compositor سایه نمی‌دهد، پس `body` به‌اندازهٔ ۷px پدینگ دارد و `.app` با `box-shadow` بیرونی کشیده می‌شود؛ بدون آن پدینگ سایه دیده نمی‌شود.
- **فیلترهای انتقال در موتور کار می‌کنند نه در UI**: `JobOpts` (`skipExisting`/`newerOnly`/`limitBps`) به `engine.start` می‌رود و همهٔ مسیرها (دکمه، کلید، درگ) یکی می‌شوند. با `newerOnly` اگر مقصد قدیمی‌تر بود، فایل مقصد *جایگزین* می‌شود؛ بدون فیلتر هرگز بازنویسی نمی‌شود.
- **فرمان تازه = یک خط در `commands.ts`**: نوار ابزار، نوار وضعیت و ویرایشگر کلید همه از `COMMANDS` می‌خوانند؛ کلیدها هرگز مستقیم در `keydown` نوشته نمی‌شوند (`keys.ts` فقط الگوی متن → تطبیق را می‌داند و تست دارد).
- **مدل تب ساده بماند**: `tabs: string[]` + `pinCount`؛ سنجاق‌شده‌ها همیشه `[0, pinCount)` هستند و هیچ عملیاتی (جابه‌جایی/بستن) از این مرز عبور نمی‌کند. ساختمان دادهٔ جدا برای تب لازم نیست.
- **انتخاب چندتایی با حالت `toggle`**: کامپوننت فقط intent می‌فرستد و `App` آن را روی state تازه حل می‌کند؛ محاسبه روی `pane.sel` قدیمی، کلیک‌های سریع را از دست می‌دهد (یک بار همین اشتباه رخ داد).
- **پیمایش کیبورد سخت‌افزاری است**: ↑/↓/PgUp/PgDn/Home/End و ←/→ پیش از جدول `COMMANDS` در `App` مدیریت می‌شوند؛ ریاضی‌اش در `navIndex` (`format.ts`) تست دارد. تعداد ستون/ردیف نمای فعلی از `onMetrics` پنل می‌آید و اسکرول با prop `reveal` انجام می‌شود نه `scrollIntoView` — ردیف‌ها مجازی‌اند و المنت خارج از ویوپورت وجود ندارد.
- **اندازه‌گیری با `useEffect([])` یخ می‌زند**: پنل هنگام پیش‌نمایش، `.rows` را unmount می‌کند؛ اندازه‌گیری باید ref callback باشد تا با برگشتن المنت `ResizeObserver` تازه بگیرد، وگرنه `box` روی مقدار اولیهٔ ۶۰۰ می‌ماند و نمای شبکه ۵ ستون (نیمهٔ عرض) می‌شود.
- کامنت فقط برای «چرا»یی که کد نشان نمی‌دهد؛ میان‌بر آگاهانه با قالب `shortcut: <محدودیت>, <کِی ارتقا>`.

## تست و تحویل

- منطق خالص (فرمت، مرتب‌سازی، مسیر) تست واحد دارد؛ UI را با `SMOKE_SHOT` و چشم خودت ببین.
- اجرای کامل سوییت کار من (مالک) است؛ تو تست را بنویس و همان تست مربوطه را اجرا کن.
- قبل از تحویل: `npm run typecheck` + `node --test` + یک اسکرین‌شات تازه.

## امنیت و داده

- `contextIsolation: true`، `nodeIntegration: false`، CSP در `index.html`. این سه را کم نکن.
- تصاویر و بندانگشتی‌ها از پروتکل `mfm://` می‌آیند که فقط مسیر مطلق را سرو می‌کند؛ هیچ `file://` و هیچ دسترسی `fs` در رندرر باز نکن.
- تنها چیزی که روی دیسک می‌نویسیم `state.json` در `app.getPath('userData')` است (چیدمان پنجره، تم، نشان‌ها). هیچ داده‌ای از فایل‌های کاربر جایی کپی یا ارسال نمی‌شود.
- حذف فایل به سطل بازیافت (`shell.trashItem`) پیش‌فرض است؛ حذف قطعی فقط با Shift.
- هیچ عملیات فایلی روی مسیرهای نسبی یا خالی اجرا نشود؛ مقصد باید پوشه باشد.
- هیچ کلید، توکن یا رمزی در مخزن نیست — مخزن عمومی است.

## گیت، نسخه و استقرار

- شاخهٔ اصلی `main`؛ پیام کامیت با پیشوندهای `feat:`/`fix:`/`docs:`/`chore:`/`refactor:`/`perf:`.
- **بدون دستور صریح من، تگ نزن و پوش نکن.** برای تگ: `vX.Y.Z`.
- **تگ = ریلیز خودکار سه‌سیستمه**: `.github/workflows/release.yml` روی تگ `v*` اول `typecheck`/`test`/`build` را می‌گیرد (و تطابق `package.json` با تگ را چک می‌کند)، بعد لینوکس AppImage/deb، ویندوز NSIS و مک dmg/zip (x64 + arm64) را می‌سازد و با `softprops/action-gh-release` منتشر می‌کند. نام فایل‌ها از `artifactName` در `electron-builder.yml` می‌آید؛ مراحل و امضا در `docs/RELEASE.md` است. `workflow_dispatch` همان بیلدها را بدون ریلیز می‌سازد.
- نسخه در `package.json` تنها منبع شمارهٔ نسخه است؛ هنگام تگ همان را بالا ببر.

## سندهای زنده (بدون درخواست جداگانه به‌روز می‌شوند)

- `docs/FEATURES.md` — هر امکان تازه که پیاده شد، تیک بخورد؛ هر تصمیم معوق در همان‌جا بماند.
- همین فایل — قاعده‌ای که یک بار عامل را به خطا انداخته، اینجا نوشته می‌شود (قاعده = واکنش به خطای واقعی).

## مرزها

- این پروژه مال شخصی من است، نه شرکت نجم: هیچ CI/CD، دامنه، بکاپ یا سرور شرکتی اینجا وارد نمی‌شود.
- کد را فقط روی همین مخزن توسعه بده؛ فایل‌های پروژه‌های دیگر در `/data/Codes` را نه کپی کن نه تغییر بده.

## تله‌های ترجمه و تست

- **`t()` در سطح ماژول یخ می‌زند**: هر جدولی که در بالای فایل ساخته می‌شود (`COMMANDS`، `COLUMNS`، `LABEL`، `STATE_LABEL`) زبان را همان لحظهٔ import قفل می‌کند. رشتهٔ فارسی را در جدول نگه دار و **در زمان رندر** با `t(...)` ترجمه کن (`labelOf`، `groupLabelOf`، `labelOfState`). این دقیقاً همان چیزی بود که رابط را نیمه‌انگلیسی/نیمه‌فارسی کرد.
- **ارقام فارسی را از کاتالوگ نگیر**: `FA_DIGITS` باید ثابت بماند؛ اگر از `t('۰۱۲۳۴۵۶۷۸۹')` ساخته شود، در حالت انگلیسی هم یک‌بار ترجمه می‌شود و بعد ارقام فارسی را لاتین می‌کند.
- **تست‌هایی که خروجی فارسی را می‌سنجند** باید با `setLang('fa')` شروع شوند؛ پیش‌فرض برنامه انگلیسی است.
- **پیش از هر اجرای `SMOKE_SHOT`/`SMOKE_JS` پروسهٔ قبلی را ببند**: قفل تک‌نمونه اجرای تازه را بی‌صدا رد می‌کند و آدم خیال می‌کند بیلد خراب است. با `pgrep -f "dist/electron \." | xargs -r kill -9` (نه `pkill -f` که خودش را هم می‌کشد).
- **`pkill -f` در همان خطی که الگو را دارد، خودش را می‌کشد** (exit -15). با PID یا با `pgrep | xargs kill` بکش.

## Updating from upstream (this macOS fork)

`origin` is `aminghaseminia/max-file-manager`; `upstream` is `majidasgari/max-file-manager`.
**A pull is code execution.** Never build or install before the review below — the only reason this fork exists separately is so incoming code can be treated as untrusted until it has been read.

### 1. Fetch, then look before merging

```bash
git fetch upstream
git log --oneline HEAD..upstream/main      # what is coming
git diff --stat HEAD..upstream/main
```

If the log is empty there is nothing to audit and nothing to rebuild — stop and say so.

### 2. Review the incoming diff for backdoors and security regressions

Read the config and dependency surface first, then the source:

```bash
git diff HEAD..upstream/main -- package.json package-lock.json electron-builder.yml .github scripts bin
git diff HEAD..upstream/main -- src
```

**Blockers — stop, report, do not build:**

- a new or changed `preinstall`/`install`/`postinstall`/`prepare` script, in the repo or in any dependency
- a dependency resolved from git, ssh or plain http, or from a host other than `registry.npmjs.org`
- a lockfile package with no `integrity` hash
- `eval`, `new Function`, `vm.*`, or `Buffer.from(…, 'base64')` used as code; minified or obfuscated source under `src/`
- a new outbound network call (`fetch`, `net.request`, `WebSocket`, `sendBeacon`) anywhere; the only legitimate one is the GitHub release check in `src/main/updates.ts`
- new `child_process` use, especially `exec` or `sh -c` with anything that is not a literal; `app:runScript` is the one accepted exception and must stay user-authored with no shipped default
- `webPreferences` loosened (`contextIsolation: false`, `nodeIntegration: true`), CSP in `src/renderer/index.html` widened, or the `preload` bridge exposing new privileged surface
- new persistence: LaunchAgents, login items, `setLoginItemSettings`, launchd, cron, `setAsDefaultProtocolClient`
- an auto-update path that downloads and executes; opening a GitHub release page in the browser is fine
- `src/main/mcp.ts` gaining a privileged tool or defaulting to anything but `off`

Re-check the supply chain and the packaged bundle:

```bash
npm audit --omit=dev
python3 -c "import json,collections,urllib.parse;d=json.load(open('package-lock.json'));c=collections.Counter(urllib.parse.urlparse(v['resolved']).netloc for v in d['packages'].values() if v.get('resolved'));print(c)"
npx asar list "release/mac-arm64/Max File Manager.app/Contents/Resources/app.asar" \
  | grep -vE '\.(js|css|woff2?|ttf|png|svg|html|json|mjs|map)$'   # must print only /out dirs
```

### 3. Merge, then gate

```bash
git merge --ff-only upstream/main
npm ci
npm run typecheck
npm test
```

`src/main/jobs.test.ts` → "cancel stops the transfer" fails on fast SSDs: a 24 MB copy finishes before `cancel()` lands. That is test timing, not a defect; note it and do not block on it.

### 4. Build and install

```bash
npm run dist:mac
osascript -e 'quit app "Max File Manager"' 2>/dev/null
rm -rf "/Applications/Max File Manager.app"
ditto "release/mac-arm64/Max File Manager.app" "/Applications/Max File Manager.app"
codesign --verify --deep --strict "/Applications/Max File Manager.app"
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
  -f "/Applications/Max File Manager.app"
```

The build is ad-hoc signed and not notarized (`identity: '-'` in `electron-builder.yml`), which is fine locally and will not pass Gatekeeper on another machine.

### 5. Report

State the commits pulled, the audit outcome for every blocker above, the test result, and the version actually installed.

## macOS specifics that are local to this fork

- **`public.folder` cannot be reassigned.** Finder is protected by LaunchServices; `LSHandlers` in `com.apple.launchservices.secure.plist` and `LSHandlerRank: Owner` were both tried and both leave Finder as the handler. Do not retry it. The app is still registered as a folder handler, so right-click → Open With → Max File Manager works.
- **Folder opens arrive as Apple events, not argv.** `src/main/index.ts` handles `app.on('open-file')` and queues the path until the window exists; `mac.extendInfo` in `electron-builder.yml` declares `public.folder`.
- **Option+E is a local Carbon helper, not a Services workflow.** Services + `pbs.plist` (`NSServicesStatus` → `~e`) was tried first: it binds once and then stops applying after a `pbs` restart (`NSKeyEquivalent` comes back empty), and this macOS no longer honors it. The working setup is `~/Library/Application Support/MaxFileManagerHotkey/MaxFileManagerHotkey.app` (source `mfm-hotkey.swift` beside it), an **accessory (`LSUIElement`) app bundle** compiled with `swiftc -O` from Apple's `RegisterEventHotKey` and run by `~/Library/LaunchAgents/local.maxfilemanager.hotkey.plist`. It must stay a bundle with an `NSApplication` run loop: a bare CLI binary gets `register=0` and then never receives a single key, because it has no app context on the WindowServer. Logs to `~/Library/Logs/mfm-hotkey.log` (`opened` on each press); `lsappinfo info -app local.maxfilemanager.hotkey` must report `type="UIElement"`. Rebuild with `swiftc -O -o MaxFileManagerHotkey.app/Contents/MacOS/MaxFileManagerHotkey mfm-hotkey.swift`, then `codesign -s -` and `launchctl bootout`/`bootstrap gui/$(id -u)`.
- **Type-ahead owns bare characters and the name filter.** In `src/renderer/src/App.tsx` a plain printable key (no modifiers, not Space) fills `typedBuf` for 800 ms, writes it into `pane.filter` so the listing narrows like a Linux quick filter, and selects the first entry whose name *starts* with it (the filter itself matches anywhere, as `Ctrl+F` always has). Backspace edits the buffer only once it has text, so it still means "up" otherwise. Escape clears both; `go`/`jump` clear them because a filter belongs to the folder it was typed in. Keep it ahead of the `COMMANDS` loop and after the modal/`typing` guards, or it will steal shortcuts and text fields.
- **Local toolchain trap:** a Homebrew `simdjson` upgrade can leave `node` unrunnable (`Library not loaded: libsimdjson.*.dylib`). Fix with `brew upgrade node`; it is unrelated to this repo.
