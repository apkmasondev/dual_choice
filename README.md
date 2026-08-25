# APK — DUAL / CHOICE

A short, cinematic product experience. A film runs to the moment a figure holds
out two objects; the visitor picks one **directly on the image**, watches that
object become a product, and lands on APK's call to action. A pointer that can
scrub drives the film by scrolling; a coarse pointer has it played instead —
see [Two ways to drive the intro](#two-ways-to-drive-the-intro).

Built from `APK_DUAL_CHOICE_PLAN.md`. Where the plan and the delivered assets
disagreed, the assets won — the differences are listed under
[Deviations from the plan](#deviations-from-the-plan).

- **No runtime dependencies.** Vite + TypeScript (strict) + semantic HTML +
  modern CSS. No GSAP, Lenis, Three, React, XState or Tailwind.
- **29 kB of JavaScript** (10 kB gzipped) and **23 kB of CSS** (5.5 kB gzipped).

---

## Getting started

```bash
npm ci
npm run dev
```

| Script                   | What it does                                  |
| ------------------------ | --------------------------------------------- |
| `npm run dev`            | Vite dev server on `127.0.0.1:5173`           |
| `npm run build`          | Production build into `dist/`                 |
| `npm run preview`        | Serve the built site on `127.0.0.1:4173`      |
| `npm run lint`           | ESLint, type-aware                            |
| `npm run typecheck`      | `tsc --noEmit`                                |
| `npm run test`           | Vitest unit tests                             |
| `npm run test:e2e`       | Playwright, desktop + mobile + reduced motion |
| `npm run test:e2e:smoke` | The `@smoke` subset                           |
| `npm run media`          | Re-encode every derived asset from `assets/`  |
| `npm run media:verify`   | Media quality gate                            |
| `npm run check:config`   | Report which outbound destinations are set    |
| `npm run verify`         | lint, typecheck, unit, build, media gate      |

Node: current LTS, pinned in `.nvmrc` (24) and `engines`.

---

## The one input this project still needs

Nothing in the repository states where APK's calls to action should point, and
none has been invented. Set them and both buttons appear:

```bash
# .env  (see .env.example)
VITE_CONTACT_URL=https://example.com/contact
VITE_PORTFOLIO_URL=https://example.com/work
```

When a value is missing the matching button is **not rendered at all**, rather
than shipping a link that goes nowhere. `CHOOSE AGAIN` and the whole sales
message are always present. In a dev build the reveal panel names the missing
variables. `npm run check:config` prints the current state.

For GitHub Pages, set them as repository variables `CONTACT_URL` and
`PORTFOLIO_URL` (Settings, then Secrets and variables, then Actions,
then Variables); the deploy workflow passes them through. `VITE_SITE_ORIGIN` is
filled in automatically from the Pages configuration and drives
`<link rel="canonical">`, `og:image`, `robots.txt` and `sitemap.xml`.

---

## Asset map

Masters live in `assets/` and are never modified or published. They are also
**not committed** — roughly 50 MB of raw film and audio that the published site
never loads. Everything under `public/` is generated from them by
`npm run media` and _is_ committed, so `npm ci && npm run build` produces a
deployable site with neither the masters nor FFmpeg present.

To re-encode, drop the masters back into `assets/` (filenames are resolved by
fragment, not exact match — see `SOURCE_PATTERNS` in
`scripts/media/lib/media.mjs`) and run `npm run media`.

| Master                                                | Role                   |
| ----------------------------------------------------- | ---------------------- |
| `Person_kneeling_displaying_float…_202608171905.mp4`  | Intro / CHOICE film    |
| `Character_throws_crystal_transfo…_202608171911.mp4`  | BLUE / CONTROL branch  |
| `Character_throwing_red_sphere_202608171910.mp4`      | RED / DESIRE branch    |
| `Glass Thread.mp3`                                    | Soundtrack master      |
| `Zapisana_klatka_z_projektu_Person_202608171911.jpeg` | Reference CHOICE frame |

All three films are 1280x720, 24 fps, 240 frames, 10.005 s.

### Published media

| File                                | Size         | Notes                         |
| ----------------------------------- | ------------ | ----------------------------- |
| `media/video/intro-choice-1280.mp4` | 2.49 MB      | GOP 4, CRF 21, VMAF 95.8      |
| `media/video/intro-choice-960.mp4`  | 1.26 MB      | GOP 4, CRF 22, phone variant  |
| `media/video/blue-control-1280.mp4` | 1.59 MB      | GOP 48, CRF 21                |
| `media/video/blue-control-960.mp4`  | 667 KB       | GOP 48, CRF 23                |
| `media/video/red-desire-1280.mp4`   | 1.39 MB      | GOP 48, CRF 21                |
| `media/video/red-desire-960.mp4`    | 578 KB       | GOP 48, CRF 23                |
| `media/audio/glass-thread.opus`     | 3.05 MB      | 96 kbps, 48 kHz stereo        |
| `media/audio/glass-thread.m4a`      | 3.81 MB      | AAC 128 kbps, Safari fallback |
| `posters/*.{avif,webp,jpg}`         | 153 KB total | 4 stills, 3 formats each      |
| `og/dual-choice-og.jpg`             | 44 KB        | 1200x630                      |

Total shipped media: **15.0 MB**, of which a first visit downloads the intro
(2.5 MB desktop, 1.3 MB phone) plus one branch. The soundtrack is fetched only
after the visitor chooses `ENTER WITH SOUND`.

### Regenerating media

```bash
npm run media
npm run media:verify
```

Individual stages, if you only changed one thing:

```bash
node scripts/media/encode-video.mjs intro
node scripts/media/encode-audio.mjs
```

Requires FFmpeg on `PATH`. Scripts read only from `assets/` and write only into
`public/`. Encodes are byte-deterministic (`-flags +bitexact`), so re-running
the pipeline produces no diff unless a setting changed.

Media filenames are stable and unhashed. GitHub Pages serves them with a short
`max-age`, so a re-encode propagates within minutes; if you ever need an
immediate cache break, rename the file in `scripts/media/profiles.mjs` and
`src/config/media.ts` together.

---

## Why the intro has a short GOP and the branches do not

The intro is **scrubbed**: scroll position maps to a timestamp, so the decoder
is asked for arbitrary frames thousands of times. What that costs is the walk
from the previous keyframe to the frame asked for — so the number that matters
is the distance between keyframes, not whether it is 1.

It was `keyint=1` at first, which is the safe reading of that sentence rather
than the measured one. Timing `currentTime` to `seeked` in a browser, on the
real encodes, fully buffered, over 220 backward seeks — the worst case, since
scrolling up can never reuse the decoder's forward progress:

| keyint | p50     | p95     | 1280 size | VMAF  |
| ------ | ------- | ------- | --------- | ----- |
| 1      | 4.3 ms  | 5.3 ms  | 4.86 MB   | 95.96 |
| 4      | 4.6 ms  | 6.5 ms  | 2.49 MB   | 95.76 |
| 8      | 5.4 ms  | 8.7 ms  | 2.03 MB   | 95.75 |
| 48     | 16.7 ms | 32.5 ms | 1.61 MB   | 95.62 |

The scrub asks for at most one seek per frame, so the budget is 41.7 ms.
`keyint=4` spends 16% of it and halves the file for 0.2 VMAF, which is an order
of magnitude below the point where anyone sees a difference; `keyint=48` spends
78% and would stutter on a slower machine. So the intro ships at 4, and the
original instinct turns out to have been right about the direction and wrong by
a factor of four about the distance.

The intro also encodes without B-frames, so a seek lands on the frame it was
aimed at. The branches keep theirs: they only ever play forward, a normal
2-second GOP makes them about three times smaller, and two thirds of their
frames are B-frames.

`npm run media:verify` measures the real distance between keyframes and fails
if any file exceeds what its profile is encoded for, fails on a B-frame in a
scrubbed file, and warns if a branch ever becomes All-I.

Every web encode is stripped of audio (`-an`): the soundtrack is a separate,
globally controlled system, so branch transitions cannot double up on sound.

---

## Hotspot projection

This is the part the plan calls non-negotiable, and it is worth reading before
touching `src/choice/`.

Hotspots are **never** positioned as a percentage of the viewport. They are
defined in **source-frame pixels** and projected through exactly the same maths
that positions the film:

```
crystal  centre (338.5, 346.5)  radius 69   <- measured, not guessed
sphere   centre (923.0, 352.0)  radius 68
```

`src/choice/mediaProjection.ts` is the single geometry authority. `StageLayout`
calls it once per resize and writes the result to CSS custom properties; the
`<video>` element is sized from those properties and the hotspots are
transformed by them **in the same animation frame**. There is deliberately no
CSS `object-fit` doing its own version of the same calculation — the element box
is built at the exact source aspect ratio, so `object-fit` has nothing left to
decide.

### The fit mode

`cover` and `contain` both exist, but the default is `focus`: the largest scale
that keeps a nominated region of the frame on screen, capped at `cover`.

```
FOCUS_RECT = x 236 to 1044, full height
```

That band holds both objects with a margin. The effect:

- **16:9 and 16:10** — identical to `cover`, full bleed.
- **21:9 and wider** — scale is capped so the figure is never cropped; the
  remaining space becomes ambient band.
- **9:19.5 portrait** — the film is 41% of the screen height instead of the 26%
  plain `contain` would give, and both objects stay in frame. A full-screen
  `cover` here would have cropped them off the sides entirely.

### Verifying it

`tests/unit/mediaProjection.test.ts` checks eleven viewports mathematically. The
end-to-end tests go further and **sample the film's own pixels underneath each
button**: the studio backdrop has a mean saturation around 10, the crystal reads
B-R +34 and the sphere R-B +79, so a drifted hotspot cannot pass. That check
runs after every resize and orientation change in the suite.

### Calibration mode

```bash
npm run dev
```

Then open `http://127.0.0.1:5173/?calibrate=1`.

It draws the source grid, the focus rect and each hotspot over the live frame.
Arrow keys nudge by one source pixel (shift for ten), `+` and `-` change the
radius, `1` and `2` switch object, clicking drops the active point, and a button
copies the values straight into `hotspot-config.ts`. Add `?hud=1` for a
performance HUD with state, rAF rate, target vs actual playhead and dropped
frames. Both are guarded by `import.meta.env.DEV` and are dropped from
production builds.

---

## How the experience is wired

One explicit state machine (`src/app/ExperienceState.ts`), one
`requestAnimationFrame` loop, one geometry authority. The scroll listener only
records `scrollY`; measuring, seeking and style writes all happen in the
animation frame.

```
boot -> ready -> intro -> choice -> branch-loading -> {red,blue}-playing
                   |         ^            |                    |
                choice <- returning <- {red,blue}-reveal <------+
```

Selection latches on the first activation, so a double tap or "BLUE then RED"
cannot start two films. An `ended` event from the film that is _not_ on screen
is ignored.

**Scrubbing.** Scroll maps to a target time; the playhead follows it with
frame-rate-independent exponential smoothing (`alpha = 1 - e^(-dt/tau)`,
tau = 130 ms) plus two limits — at most about 2.25 source frames per step and at
most six times real time — so a flick gesture is caught up over a few frames
instead of teleporting. Seeks that land on the frame already displayed are
skipped.

**Choice hand-over** waits for both the scroll (at least 98.5%) and the decoder
(within two frames of the end), with hysteresis so jitter cannot flicker the
hotspots. A played intro hands over on the film's own `ended` instead.

**Resizing mid-scrub** used to re-anchor the scroll position to the progress
already reached. It no longer does: pulling the page back under a pointer that
is mid-gesture is louder than the thing it fixes, so the film absorbs the
change and its own smoothing spreads it over about 200 ms. At CHOICE the
re-anchor stands, because there nothing is being scrubbed and the frame has to
stay exactly where the hotspots were measured against.

### Two ways to drive the intro

`(pointer: coarse)` decides, and it is the pointer rather than the width that
decides: a small desktop window still has a wheel.

|                     | scroll                    | playback                  |
| ------------------- | ------------------------- | ------------------------- |
| Who moves the film  | the visitor, by scrolling | the film, at its own rate |
| Scroll map          | 280–340 vh                | collapsed to one screen   |
| Hand-over to CHOICE | scroll ≥ 98.5% + decoder  | the film's `ended`        |
| Way past it         | keep scrolling            | `SKIP`, armed throughout  |

A finger is a poor jog wheel, and the browser it comes with hides its address
bar during the first swipe — which changes the scroll range mid-gesture, with
no answer that is not a compromise. Playing the film removes the question. It
is the same ten seconds and the same last frame.

**Branch transition.** The branch fades in _over_ the intro rather than
crossfading both, so the backdrop can never show through the join. It lasts
140 ms because the frames genuinely match — measured PSNR **36.8 dB** between
each branch's first frame and the intro's last. `npm run media:verify` fails
below 31 dB; the fix for a mismatch is the source, never a longer crossfade.

**Ambient backdrop.** A 96x54 canvas is repainted from whichever film is on
screen and stretched over the stage. Bands are built from the frame's own edge
rows, and sideways from a reflection of the frame about its own edge, so the
colour on both sides of the join is identical — measured discontinuity across
the seam is 0.26%. There is no CSS `filter` on it: Chromium rasterises a filter
at composited scale, and blurring this element after it was stretched over the
stage measured **3.8 fps** at 2560x1080, versus 55 fps once the softening moved
inside the canvas.

**Reveal.** On a landscape stage the film draws back into a rounded card with
the sales copy below it. On portrait it slides up instead of shrinking, because
scaling there would make the product tiny for no gain. What has to clear the
copy is the product, not the film box (`PRODUCT_SAFE_RECT`).

---

## Accessibility

- Hotspots are real `<button>`s with names that never rely on colour:
  "Choose CONTROL — the blue crystal in the left hand." Shape, name, position
  and colour all carry the distinction.
- Tab order at the choice is BLUE, RED, the wordmark, then sound: the objects
  come before the chrome that frames them. Hotspots
  are not tab stops before the choice exists.
- The entry overlay is a native `<dialog>` opened with `showModal()`, so focus
  is contained and the page behind it is inert without a hand-rolled trap.
- `:focus-visible` is stronger than hover and legible without colour.
- Touch targets are at least 44 px even when the visible mark is smaller — and
  the mark is light, not an outline: the objects carry a bloom that widens
  under the pointer, while `:focus-visible` is the one state that draws an edge.
- `env(safe-area-inset-*)` on every edge-anchored control.
- A polite live region announces the choice and the selected branch — not the
  playhead.
- After a film ends, focus moves to the heading that just appeared.
- The wordmark is a real link to `#top`, so without JavaScript it still returns
  the document to the top; with it, the whole experience winds back to the
  first frame.

### Reduced motion

`prefers-reduced-motion: reduce` is a **complete variant**, not a stripped page.
Scroll scrubbing is skipped and the CHOICE frame dissolves in directly; both
objects, the choice, the product copy and the CTA all still work. The film is
then offered explicitly via `PLAY PRODUCT FILM` rather than forced.

Reduced motion is modelled as a _mode_, not a state — see the deviations below.

---

## Performance

Budgets from the plan, and what the build actually does:

| Target               | Budget  | Actual             |
| -------------------- | ------- | ------------------ |
| Initial JS (gzip)    | 100 kB  | **10.2 kB**        |
| CSS (gzip)           | 30 kB   | **5.5 kB**         |
| Intro, desktop       | 3 MB    | **2.49 MB**        |
| Intro, mobile        | 1.75 MB | **1.26 MB**        |
| Each branch, desktop | 4 MB    | **1.39 / 1.59 MB** |
| Each branch, mobile  | 2.5 MB  | **578 / 667 KB**   |
| Poster               | 220 KB  | **2.7-32 KB**      |

- **LCP** is the intro poster: an AVIF with explicit dimensions,
  `fetchpriority="high"`, preloaded in the head, painted before the decoder is
  ready.
- **CLS** is structurally zero: the stage is fixed and every layer inside it is
  absolutely positioned, so no copy can reflow the film.
- **INP** — the scroll handler performs no layout reads; all measurement happens
  on resize and all style writes happen in the animation frame.
- Only `transform` and `opacity` are animated. `will-change` is not set
  globally.
- Fonts: one self-hosted variable face (Archivo, latin subset, 34 KB woff2,
  weights 100–900 from a single file). It is preloaded next to the poster and
  served from the same origin — no third-party request, no CDN in the critical
  path. `font-display: swap` covers the gap, and the gate it first typesets
  fades in over 900 ms, so the swap lands inside the fade.
- The stylesheet is a render-blocking `<link>`, not a JS import, so the first
  paint is already styled — an undecoded `<video>` paints black, and that was
  visible as a flash while the CSS was arriving through the module graph.
- Branch films start at `preload="metadata"` and are promoted to full preload
  one at a time once the intro passes 55%, and not at all on a Save-Data or slow
  connection.

---

## Testing

```bash
npm run test
npm run test:e2e
```

**Unit** — 52 tests: projection maths against eleven viewports, the state
machine's transition table and selection locking, and the scrub smoother's
refresh-rate independence and catch-up limits.

**End-to-end** — 21 tests across three Playwright projects (desktop 1440x900,
Pixel 7, and a reduced-motion project). Covers the full journey to the CTA, that
BLUE only ever starts BLUE, double-click protection, hotspot pixel-accuracy
across six desktop viewports and five phone orientations, 44 px targets,
horizontal overflow, the keyboard-only path including focus containment in the
entry dialog, the sound gesture requirement, and that muted entry never
downloads the soundtrack.

**Visual references** are written to `test-results/visual/` for review rather
than pixel-diffed: a frame grabbed mid-playback is decoder-dependent and would
fail for reasons unrelated to this project.

**Media gate** (`npm run media:verify`) fails on wrong dimensions or frame rate,
a stray audio track, keyframes further apart than the profile allows, a
B-frame in a scrubbed file, a broken faststart
layout, a shipped audio master, or branch-to-intro continuity below 31 dB.

---

## Deployment

`.github/workflows/deploy-pages.yml` uses the official Pages actions
(`configure-pages@v6`, `upload-pages-artifact@v5`, `deploy-pages@v5`) with
`contents: read`, `pages: write`, `id-token: write` and a `pages` concurrency
group. No `dist` branch.

Vite's `base` is never guessed: `configure-pages` reports the path the
repository actually publishes under — `/` for a user, organisation or
custom-domain site and `/<repo>/` for a project site — and the build consumes it
as `BASE_PATH`. Verified by serving a `BASE_PATH=/apk_dual_choice/` build from a
subdirectory with no 404s and no console output.

To publish:

1. Push to `main` (the repository needs to be a git repo with a GitHub remote).
2. Settings, then Pages, then set **Source: GitHub Actions**.
3. Optionally add repository variables `CONTACT_URL` and `PORTFOLIO_URL`.

`ci.yml` runs lint, typecheck, unit tests, build and the config report; a media
job installs FFmpeg and runs the quality gate; an end-to-end job runs the smoke
subset on pull requests and the full suite on pushes.

---

## Deviations from the plan

Each of these is a place where the plan's sketch met the delivered assets or
current browser behaviour and lost.

1. **Both branch films already existed.** The plan treats RED and BLUE as
   pending. They were delivered and are fully wired.
2. **The studio backdrop is not near-white.** The plan proposes `--bg: #f4f6f7`.
   The frames measure about `#aeb4ba` at the edges — a cool mid-grey. The whole
   palette is sampled from the film instead, because on `#f4f6f7` the video
   would have sat on the page as a visible rectangle.
3. **`focus` fit instead of a `cover`/`contain` switch.** See
   [Hotspot projection](#hotspot-projection). `cover` and `contain` remain
   implemented and unit-tested.
4. **Geometry is driven from JS, not CSS `object-fit`.** The plan warns against
   having two implementations of the fit maths; this removes the second one
   entirely rather than keeping them in sync.
5. **`reduced-motion` is a mode, not a state.** The plan lists it in the state
   union, which would make it a dead end — a reduced-motion visitor still has to
   reach choice, pick a branch and get to the CTA. It is modelled orthogonally,
   and `reveal -> playing` was added to the transition table for the explicit
   `PLAY PRODUCT FILM` opt-in.
6. **Media scripts are `.mjs`, not `.sh`.** Same commands, cross-platform, and
   they run in CI on Windows or Linux without a shell dependency.
7. **The ambient backdrop is a canvas, not a second `<video>`.** Same result at
   a fraction of the cost, and it cannot drift out of sync with the foreground.
8. **The scrollbar is hidden.** Where the film is scrubbed this is a film, not
   a document; the affordance is carried by the `SCROLL TO ENTER` cue, and
   keyboard scrolling is unaffected. Where it is played there is nothing to
   scroll and the cue is not shown.
9. **No JSON-LD.** The plan permits it only with real data, and there is none to
   state.

## Known limitations

- On a landscape phone (about 844x390) the sales panel cannot be given its own
  space: the stage is too short. The film steps back behind a veil so the copy
  stays legible, and all of it remains present, but that viewport is the one
  place the composition is a compromise rather than a choice.
- The soundtrack master is a 195 kbps MP3, so the published Opus and AAC are
  lossy-to-lossy. A lossless master would encode slightly cleaner at the same
  bitrate.
- The performance figures above were measured in headless Chromium, which
  renders in software. Hardware-accelerated browsers do better; the numbers are
  a floor, not a typical result.
