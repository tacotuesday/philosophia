# Philosophia

Philosophia is an MIT-licensed desktop app for incremental reading and spaced repetition on Windows, macOS, and Linux. It keeps articles, images, highlights, and review history on your computer.

## Start learning

1. Open **Web browser**, enter an HTTP or HTTPS address, and choose **Save article**. You can also select text and choose **Highlight selection**, or choose **Save image** and click an image on the page. Escape cancels image selection.
2. Open a saved article in **Reading library**. Select a passage and choose **Highlight selection**. Choose **Save image extract** beneath a figure to keep it as its own reading. Each text extract keeps its original quotation and a link to its position in the article. You can edit its working copy, make smaller extracts, or revisit the source offline.
3. Pick **Read later** when you want to pause. The suggested delays are 1, 3, 7, 14, and then 30 days. Choose a different date or adjust priority in the reader. **Finish** removes that reading from the queue. Its extracts and cards stay available.
4. Open an extract, select a phrase, and choose **Make cloze**. The editor previews each card. In `{{c1::Leaves}} absorb {{c2::light}}`, each number produces one card. Reuse a number to hide phrases together. An optional hint uses `{{c1::Leaves::plant organ}}`.
5. In **Card review**, press **Space** to reveal the answer. Rate recall with **1** Again, **2** Hard, **3** Good, or **4** Easy. Each rating shows its next interval. **Undo last rating** restores the card and calendar.

The reading queue orders available readings by priority, then by reading date. Card review serves overdue and ready cards before new cards. FSRS uses a desired retention of 90% and short-term learning and relearning steps. The calendar counts each introduced card once, on its next scheduled day. New cards appear in their own count. Study days begin at 4 am in the system’s local time zone.

## Run from source

Use Node.js 22.18 or newer and npm. From the project directory:

```sh
npm ci
npx --no-install install-electron
npm start
```

The first runtime download requires an internet connection. Each start rebuilds the TypeScript app. After capture, the reader, media cache, scheduler, and calendar work offline. A failed image download leaves the text intact and shows **Retry image** in the reader.

## Build a desktop package

Run the matching command on the target platform:

```sh
npm run dist -- --win nsis --x64 --publish never
npm run dist -- --mac dmg --arm64 --publish never
npm run dist -- --mac dmg --x64 --publish never
npm run dist -- --linux AppImage --x64 --publish never
```

Packages are written to `release/`. On macOS, open the matching disk image and drag Philosophia into Applications. On Windows, run the installer. On Linux, mark the AppImage executable and launch it on a desktop that supports the Chromium sandbox. Development builds use ad-hoc signing on macOS and unsigned installers on Windows. macOS builds are unnotarized.

## Verify the workflow

```sh
npm run typecheck
npm test
npm run build
npm run test:desktop
```

The desktop test opens a temporary app profile, serves a local article with a repeated passage and an image, and shuts down the server before reopening the app. It verifies the saved source location and cached image, creates sibling cloze cards, rates one, and checks the calendar and undo. To exercise a packaged build, set `PHILOSOPHIA_EXECUTABLE` to the packaged application executable. On headless Linux, run the desktop test under Xvfb. The GitHub Actions workflow builds and tests native packages for all four targets and attaches the installers as workflow artifacts.

## Storage and implementation

Electron’s main process owns the versioned SQLite database, media files, and scheduler. The trusted React interface uses typed commands through an isolated preload. A separate sandboxed Chromium view displays web pages. Capture runs Mozilla Readability on a DOM copy and stores plain text blocks and local images.

The library lives in the app’s user-data directory: `~/Library/Application Support/Philosophia` on macOS, `%APPDATA%/Philosophia` on Windows, and `$XDG_CONFIG_HOME/Philosophia` (usually `~/.config/Philosophia`) on Linux. To back up a closed app, copy this directory, including its `media` folder.

The learning workflow draws on [SuperMemo’s incremental reading guide](https://supermemo.guru/wiki/Incremental_reading), [a reader’s account of working with extracts](https://www.masterhowtolearn.com/2018-12-09-demonstration-my-workflow-of-incremental-reading/), and [Anki’s review interface](https://docs.ankiweb.net/manual/studying). Scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).

## License

The application uses the [MIT license](LICENSE). The packaged app includes third-party notices for its bundled libraries and fonts.
