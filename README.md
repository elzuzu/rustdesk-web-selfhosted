# RustDesk Web — self-hosted web client

*[Version française](README.fr.md)*

A working RustDesk web client, served by nginx, with automatic TLS and no
dependency on a tunnel or third-party service. Mouse, keyboard, clipboard, audio,
dynamic resolution, and **hardware** video decoding via WebCodecs.

> *Independent project, not affiliated with the RustDesk project or Purslane Ltd.*

## Why this repository exists

The self-hosted web client is officially a **RustDesk Server Pro** feature. The
open-source version (V1) was removed from the public repository between July 2025
and release 1.4.4: `flutter/web/` no longer exists on `master` or on any recent
tag — the Dart interface remains open, the JS/WASM connection layer does not.

A community image survives, [`pmietlicki/rustdesk-web-client`](https://hub.docker.com/r/pmietlicki/rustdesk-web-client),
containing the compiled files. It serves the Flutter application alongside a
JavaScript bridge that exposes ten functions where that application calls several
dozen: the connection fails before it completes. This repository therefore starts
from the **standalone V1 client** present in the same image — the part that is
self-consistent — fixes four defects in its bundle, and **reimplements everything
that was missing**: the original client wires up display and nothing else.

## What works

| | |
|---|---|
| Video | **hardware** H265 or H264 on both ends via WebCodecs, then AV1, VP9, and software as a last resort; exact colours, pixel-exact display when the sizes allow |
| Mouse | movement, left/right click, correctly scaled coordinates; a drag that ends outside the image still releases the button |
| Wheel, trackpad | pixels are accumulated into notches, so a trackpad no longer scrolls ten times too fast |
| Touch | one finger drives the mouse (tap, drag, long press = right click), two fingers scroll; a button brings up the device keyboard |
| Full screen | with keyboard capture on Chromium: Esc, Alt+Tab, Cmd+W go to the remote machine |
| Keyboard | text, accents, non-US layouts, dead keys, AltGr characters, control keys |
| PC ↔ Mac shortcuts | translated to the combination with the same effect (copy, word and line moves, Home/End, Alt+F4…), or sent raw for a remote terminal |
| Clipboard | text, **images and rich text** both ways; a remote copy lands in the local clipboard by itself, and the local one can follow automatically (opt-in, Chromium) |
| Files | remote panel: browse, upload, download, create, rename, delete |
| Resolution | menu of the modes the remote display actually supports, plus "fit to window" |
| Displays | a selector to switch between the remote machine's monitors, shown when it has more than one |
| Remote actions | Ctrl+Alt+Del, lock, restart, mute remote audio, suspend clipboard, privacy mode, block local input |
| 2FA | a peer that requires a verification code prompts for it instead of failing with "Login Error" |
| Cursor | the real remote cursor, with its hotspot |
| Audio | Opus, with the audio context resumed on first gesture |
| Zero-downtime deploys | the TLS layer waits for the web container instead of erroring out during a restart |
| Hidden tab | the session survives a tab switch: reading no longer depends on timers the browser slows down |
| Auto-reconnect | a dropped session retries on its own, with backoff — no fallback to the connect form |
| Settings | quality, frame-rate cap and codec are **remembered** and reapplied on every session, including after an auto-reconnect |
| Settings bar | collapses to a small handle: the top-right corner of the remote screen stays clickable |
| Recent connections | the last ten machines, by name and ID, under the login field |
| Language | French or English, following the browser or the choice made on the login screen |
| Installable | a web app manifest: the page installs as an application, in a window without tabs |
| Screen wake lock | the display never sleeps while a session is live, like YouTube during playback |
| Metrics | p50/p95/p99 percentiles for latency and decode time, as an overlay |
| Access | Basic authentication plus a 90-day session cookie |
| Hardening | content security policy, no third-party request, peer-supplied text never injected as HTML |

**Not supported**: pasting a file from the Mac into your local file manager. See
[File transfer](#file-transfer) — that is a limit of the web platform, not of
this repository.

## Requirements

- `docker`, the `docker compose` v2 plugin, `python3`, `curl`, `openssl`, `tar`
- **Linux, macOS, or Windows.** Exactly one value changes per platform:
  `RD_BACKEND_HOST`, the address the web container uses to reach hbbs/hbbr.
  `setup.sh` detects your platform and suggests the right value.

  | Platform | Value | Verified |
  |---|---|---|
  | Linux, hbbs/hbbr in `network_mode: host` | `172.17.0.1` | yes |
  | macOS (OrbStack, Docker Desktop) | `host.docker.internal` | yes, on OrbStack |
  | Windows (Docker Desktop) | `host.docker.internal` | by symmetry, untested |
  | RustDesk server on another machine | its hostname or IP | — |

  On macOS, `172.17.0.1` **does not reach the host** — it only works between
  containers. `network_mode: host` for Caddy does work: OrbStack and Docker
  Desktop forward port 443 to the machine.

- A reachable **RustDesk OSS** server (hbbs/hbbr), with WebSocket ports 21118 and
  21119 accessible from the web container
- A domain name with a **direct A record** to this machine, unproxied.
  Several names for the same site: `setup.sh` asks for the "other names"
  (`RD_DOMAIN_ALIASES`), and Caddy obtains a certificate for each
- Port **443** open in your local firewall **and** at your hosting provider
  (OCI security list, AWS security group, and so on). Port 80 may stay closed:
  the certificate is obtained through TLS-ALPN-01, which only uses 443.

## Installation

```bash
git clone https://github.com/elzuzu/rustdesk-web-selfhosted.git
cd rustdesk-web-selfhosted
./setup.sh
```

The wizard asks for your domain, access credentials, RustDesk server host and
public key, then generates the configuration, extracts and patches the assets,
builds the images, and verifies that everything responds. Re-running it is safe:
it reuses your previous answers.

### RustDesk server configuration

Two requirements on the hbbs side, without which the web client will not work:

```yaml
command: hbbs --mask 192.168.0.0/16 -k _   # NO -r / -R
command: hbbr -k _
```

- **No `-r`/`-R`**: if hbbs forces a relay, the browser will attempt a `wss://`
  connection to a host without TLS and the session will fail. Without that flag,
  hbbs returns an empty relay and the client falls back to same-origin `/ws/relay`.
- **`-k _` is essential**: with no key, `hbbr` is an **open relay** that anyone on
  the internet can use.

On the **controlled machine**, remove any explicit `relay-server` setting: it
would be propagated to the browser and cause the same failure.

## Architecture

```
browser ──HTTPS 443──► Caddy ──► nginx ─┬── /            page + assets
                       (TLS)             ├── /ws/id    ──► hbbs 21118
                                         └── /ws/relay ──► hbbr 21119
```

Two containers. Configuration and assets are baked into the images; only the
`caddy-data` volume persists outside them, to keep certificates across restarts.

| Service | Base | Role |
|---|---|---|
| `web` | `nginx:alpine` | assets, authentication, WebSocket proxy |
| `tls` | `caddy:2-alpine` | TLS termination on 443, automatic ACME |

## The six bundle patches

`scripts/patch-assets.sh` reapplies them idempotently from
`html/js/dist/index.js.orig`. Without them, nothing works:

1. **WebSocket routing** — the client targets `wss://<host>:21118` and `:21119`,
   ports no standard HTTP proxy relays. Rerouted by path on the same origin.
2. **`get_conn_status`** — a case missing from the bridge; it returned `""`, and
   `JSON.decode("")` threw on every poll, flooding the async loop and preventing
   any connection from completing.
3. **`getByName`** — no longer throws, and preserves the `null → ""` semantics.
4. **Version guard** — hbbs OSS does not populate `RelayResponse.version`, so the
   client refused the session. The field is used nowhere else.
5. **Exposed zstd decoder** — downstream file blocks arrive compressed. The bundle
   already ships a wasm decoder, but module-scoped; we expose it rather than
   shipping a second one, twice over: `window.__rdUnzstd` (the bundle's own
   function, sized for a 128 KiB file block) and `window.__rdZstdDecoder` (the
   decoder itself, so the page chooses the destination size — see
   [Rich clipboard](#rich-clipboard-what-works-and-where)).
6. **Peer text injected as HTML** — the waiting screen wrote the error message
   through `innerHTML`, and that message comes from the peer
   (`LoginResponse.error`). A hostile peer could run script in the page, which
   holds the remembered passwords. The text is now escaped.

## File transfer

The upstream client has **none**. The `FileAction`, `FileResponse` and `Cliprdr`
protobuf codecs are present in the bundle, but without a single caller — 13
occurrences each, exactly the boilerplate `ts-proto` generates. The message
dispatcher knows only ten branches, none file-related.

This repository adds a **Files** panel to the toolbar: browsing, upload (button,
drag-and-drop of a file or a folder, `Ctrl+V`), download, create folder, rename,
delete.

### How, and why this way

Transfers run over a **second connection**, opened on demand. This is not a
stylistic choice: on the peer, `file_action` is only handled when
`self.file_transfer.is_some()`, a field set solely by
`LoginRequest.file_transfer`. In an ordinary remote session every `FileAction` is
dropped **silently** — no error, no acknowledgement. That connection carries no
video and dies with the session.

Two protocol details to know before touching this code:

- **`all_files` before `send`.** Blocks carry only a `file_num`, never a name.
  Only a prior `FileAction.all_files` yields the list — in the exact order the
  blocks will arrive, since both go through `get_recursive_files`. A *file* path
  yields a single entry with an **empty name**: the name is derived from the path.
- **`remove_dir{recursive:true}` does not delete files.** On the peer it calls
  `remove_all_empty_dir`, which only removes empty directories. You must
  enumerate, delete each file, then remove the emptied tree.

### Rich clipboard: what works, and where

Plain text flows both ways on every browser. **Images** and **rich text** (the
HTML Word and Excel put on the clipboard) ask for more, and the reach differs by
direction.

**Browser → remote.** Paste an image into the session and it lands on the remote
clipboard instead of the file uploader. This direction needs no permission — the
`paste` event already carries the bytes — so it works everywhere. Conditions:

- The peer must run **RustDesk 1.3.0 or later**, the only version that understands
  `multi_clipboards`. A peer known to be older is told so and nothing is sent:
  otherwise the replayed paste would paste its *previous* clipboard. An unknown
  version is sent anyway, and logged.
- The image must fit **8 MiB as PNG**. The limit applies to what is *sent*, not to
  the source: a JPEG of a few MiB can grow several-fold once re-encoded (browsers
  do not always hand over PNG, and announcing the wrong format would give the peer
  bytes it cannot read). Too heavy, the dimensions are reduced — up to three
  times, never below 64 px — instead of refusing, and a notice says so. Above
  64 MiB the source is not even decoded.
- The remote paste (`Cmd+V`) is replayed after 150 ms plus 250 ms per whole MiB,
  capped at 2.5 s. This is a **heuristic**: the peer must have received and written
  the image before it is told to paste, and nothing confirms that it has.

The keys that trigger a paste are recognised by their letter, or — under a
non-Latin layout such as Cyrillic — by the physical key.

**Remote → browser.** Copying on the remote machine is enough: what arrives is
written to the local clipboard **at once, with no button and no notice**. That is
possible because a remote copy is almost always triggered by a gesture *in this
page* — `Ctrl+C`, a click on a menu — which opens the browser's permission to
write for a few seconds, and the content comes back in well under one.

When the browser refuses — the page does not have the focus, or the browser is
stricter — the green button of before ("Image reçue ⇩", "Texte reçu ⇩") appears
next to the settings handle, and the write is retried by itself at your next
click or key press in the page. It is **not** retried if the page lost the focus
in between: you may have copied something else elsewhere, and overwriting it with
older content would be a fault. Plain text from older peers takes the same path;
the bundle used to post it through `execCommand("copy")` outside any gesture,
which browsers silently refuse.

Decoding and conversion to PNG happen in a separate task, never on the message
loop (which also acknowledges every video frame). One slot per kind: a text
arriving after an image does not erase it. Automatic writing is **tested on
Chromium**; Firefox should accept it within its own activation window, Safari is
stricter and will mostly show the button.

**Automatic clipboard (browser → remote, opt-in).** `Ctrl+V` has always worked:
the `paste` event carries the content. But "Paste" from a menu of the remote
machine, or a middle click, produces no such event, so the remote clipboard did
not hold what you had just copied locally. **Actions → Automatic clipboard**
fixes that: once you accept the browser's permission prompt, the local clipboard
is read every time you come back to the page and sent if it changed — what the
native client does. `Ctrl+V` then pastes immediately, since the content is
already there. It is off by default because it sends whatever you copied,
passwords included, to the remote machine as soon as the page regains focus.
Chromium only: Firefox and Safari ask again at every read.

An image arriving over the legacy `clipboard` message is intercepted before the
bundle, whose branch decodes the payload as text unconditionally — without that,
it would paste garbage.

**Highly compressible images.** The bundle's own decoder sizes its output at 30×
the compressed size. Above that ratio — a screenshot of a mostly flat desktop —
it returns an *empty* result, without raising an error and without logging
anything, which used to become a blank image pasted silently. The page now reads
the size from the zstd frame header (or width × height × 4) and treats an empty
result as an error.

**When an image does not come through.** Every failure now shows a notice at the
bottom of the page, and the console (`[presse-papier]` lines) says why. A received
entry is logged as `format 21 (rgba), compress=oui, N o recus -> M o bruts, WxH`:
that line tells which form the peer actually sends. What cannot be settled from the
browser: whether the peer writes its clipboard synchronously (the replay delay above
is a guess), and what the peer does with `custom_image_quality` combined with a
quality preset.

### What will never be possible

**Copying a file on the Mac and pasting it into your local file manager.** A
browser may only write `text/plain`, `text/html` and `image/png` to the system
clipboard; there is no path to `CF_HDROP` (Windows) or `NSFilenamesPboardType`
(macOS). Chrome's web custom formats stay tab-to-tab. The other direction does
work: a file copied in Finder does reach `clipboardData.files`, and `Ctrl+V`
uploads it.

Teleport, Guacamole and Kasm reached the same conclusion: none of them uses the
clipboard for files; all open a side channel.

Console diagnostics: `rdFiles()`.

## What was reimplemented

The V1 client wires up **display only**. Everything else lives in `web/src/`,
assembled into one page by `scripts/build-page.py` (see
[Source layout](#source-layout)), through `window.curConn` and `setByName`, **without
ever patching the bundle**: the two functions the bridge expects from its host
(`onGlobalEvent`, `onRgba`), the full mouse and keyboard layer, outbound
clipboard, resolution control, remote cursor, and the WebCodecs decoder.

### Three traps, if you modify this code

- **`jsonfyForDart` serialises each value separately.** Any composite field
  received in `onGlobalEvent` is a JSON string to re-parse, not an object.
- **Login sends `video_ack_required: true`.** Any replacement of
  `handleVideoFrame` must call `sendVideoReceived()`, or the stream stalls after
  a few frames.
- **`curConn` is replaced on every connection**, and `reconnect()` reuses the
  instance with a fresh `_ws`. Your overrides must be reapplied.

## Settings, toolbar and login screen

**Remembered settings.** Quality, frame-rate cap and codec are kept in the
browser (`rd-prefs` in `localStorage`) and reapplied at every session start,
including after an auto-reconnect — the quality ratio used to be sent once per
page load. If you never chose a quality, nothing is pushed: the selector shows the
quality the bundle actually uses. A forced codec that stops working (H265 on a
machine that lost it) goes back to automatic, with a notice.

**Collapsible bar.** The settings bar is **collapsed by default** to a small ⚙
handle at the top right, so the remote screen's menu bar and window buttons stay
clickable. Click the handle to expand; the choice is remembered. A received
clipboard shows its button without expanding the bar. Limits: the remote canvas
swallows `Tab`, so the bar is mouse-only; and the handle still covers a few pixels
of that corner. To go back to the old always-open bar, expand it once.

**Recent connections.** The last ten IDs appear under the ID field, most recent
first. An entry is recorded when a session **succeeds**, not when you click
Connect, so typos do not pile up. Clicking one fills the field (digits only — the
bundle does not strip spaces) and moves focus to Connect; `Del` on a focused entry
removes it, the × does the same with the mouse, "Clear" empties the list. What is
stored (`rd-recent`) is the ID, a timestamp, and the machine name the peer
announced — never a server host, never a password (the bundle's own `peers` entry
holds the remembered passwords).

**Remembered passwords.** The bundle keeps a peer's password **in clear text** in
the browser's storage. The page used to force that on; it is now the "Remember
passwords on this device" box of the login screen, ticked by default. Unticking it
erases the stored passwords at once and stops the bundle from keeping new ones.
Untick it on any machine that is not yours.
The list is seeded once from the IDs the bundle already knew.

**Session console and machine list.** See the two sections below.

## The session console

A top bar, a **Session settings** drawer on the left, popovers for tools, and a status bar at the bottom — the layout of
the GL.iNet GLKVM console, carried over to RustDesk. Every control the client already had is still there, moved (not
rewritten) into this layout, with its remembered setting and behaviour unchanged. GLKVM is a *reference* for the layout and
the settings, not a dependency: nothing from GL.iNet runs here, and there is no WebRTC — this client speaks RustDesk's own
protocol to your hbbs/hbbr.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ⚙ Session  ▭ 123 456 789  ▭ Machines  🔧 Toolbox  ⏻ Machine  ? Help  ⌨ Keyboard │ 📁 Files  ▮ Stats  ⛶ Full screen  ⏏ Quit │
├───────────────┬──────────────────────────────────────────────────────────────────────────────┤
│ Session       │                                                                              │
│ settings      │                         the remote screen                                    │
│ ▾ Video       │                                                                              │
│ ▾ Audio       │              (HUD with p50/p95/p99 kept, click-through)                      │
│ ▾ Keyboard    │                                                                              │
│ ▾ Mouse       ├──────────────────────────────────────────────────────────────────────────────┤
│ ▾ Display     │  virtual keyboard (optional)                                                 │
├───────────────┴──────────────────────────────────────────────────────────────────────────────┤
│ ● 28 ms  H.265 1920×1080 │ 4664 kbit/s │ 60 i/s   [Relay] [Encrypted]                        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

The bar is collapsed by default to a small handle (as before); expand it to reach the buttons. The remote image is fitted
*between* the bars instead of under them. On a narrow screen the drawer becomes a bottom sheet and the bar keeps its icons.

| GLKVM | Here | Notes |
|---|---|---|
| Video › Quality, Latency, View | **Quality**, frame-rate cap, **codec**, **View** (fitted / 1:1 with scrolling), remote resolution, fit to window | Transfer (WebRTC/FEC/Native/Direct), Smart mode, EDID, Orientation: not applicable — see below |
| Audio › Speaker | **Machine sound** (`disable-audio`: the machine stops sending audio) | Microphone and camera: not ported |
| Keyboard | **PC ↔ Mac shortcut translation** (can be turned off; greyed out between two machines of the same family), **virtual keyboard** (AZERTY/QWERTY by language, sticky Ctrl/Alt/Shift/Cmd), Print Screen / Menu / Pause keys | *Bad link mode* is moot: this client sends discrete key events |
| Mouse | **Absolute / relative** mode with sensitivity, **primary button**, **scroll speed** and **direction** (4 modes), **anti-sleep jiggle**, Back/Forward buttons | Relative mode needs a peer ≥ 1.4.5 (greyed out with the reason otherwise) |
| Toolbox › Clipboard, Shortcut | Send text (copy to the machine, or **type it out** — useful at a login screen), shortcuts by remote OS plus your own (validated, persisted), **screenshot and video recording** | OCR, Wake-on-LAN, terminal: not ported |
| Accessories (power) | **Machine** menu: Ctrl+Alt+Del, lock, **restart (two clicks)**, screen picker, privacy mode, block input, lock at session end, shared clipboard, cursor in the image | Greyed out with the reason when the remote OS cannot do it |
| Toolbar › Switch Port, Fullscreen, Stats, Collapse | **Machines** switcher, **full screen with Keyboard Lock**, **connection statistics** (4 live curves), collapse | There is no packet loss to chart: the link is TCP, a loss shows up as latency |
| Help › export logs | **Help**: relay test, **log export without any secret**, version and source link | |
| Settings › Preferences | **Theme** (auto / light / dark), status bar, clean full screen | The **language** is chosen on the login screen (one setting for the page and the console) |

**What is deliberately not here**, because it is GLKVM *hardware* or a different transport: Virtual Media (ISO / USB disk),
Accessories (Fingerbot, ATX board), EDID and USB identity, Apps Center (Tailscale / ZeroTier / NetBird), firmware upgrade,
USB camera, WebRTC / FEC / Native / Direct transports. And, out of scope for a personal instance: multiple user accounts,
SSO (LDAP/OIDC), 2FA, audit log, e-mail alerts, invitations.

**Design and accessibility.** Light and dark themes built from `oklch()` tokens with `light-dark()`; text meets 4.5:1 and
component borders 3:1 in both themes (the test suite measures it in a real browser); `prefers-reduced-motion`,
`prefers-contrast`, forced colours, 44 px touch targets and safe areas are honoured; switches are native checkboxes
(`role="switch"`), the theme is an ARIA radio group driven by the arrow keys, every field is named and described; system
fonts and inline SVG icons only — no external request. A console that fails to start leaves the original bar exactly as it was.

**Where the code is.** `web/js/*.js` and `web/css/console.css`, assembled into `html/rd-console.js` / `rd-console.css` by
`scripts/build-web.sh` (every source is an IIFE, wrapped in a `try/catch`, and checked as a classic script). The template is
touched in three small places: seven `data-rd` markers, the `zoneImage()` measurement, and the 1:1 view in `fitCanvas`.
Console choices live in `rd-console` (separate from `rd-prefs`); your own shortcuts in `rd-raccourcis`.

**Not verified against a real peer** (the benches simulate a session): the relative mouse and the Back/Forward buttons rest
on the RustDesk peer source (a click acts where the cursor already is; type 5 is the relative move, ±10000, peer ≥ 1.4.5),
the restart and lock-screen requests, and the effect of privacy mode / block input on a macOS peer. Screenshots and recordings
come from the page's canvas: on the software decoding fallback (WebGL) a screenshot may be blank and the recording empty.

## Machine list (optional service)

A home page, **My machines**, before the connection form: your machines with a name, note, tags, a favourite star, the time of
the last connection and — when your hbbs allows it — a green **online** dot; a search box (from four machines); add, edit,
remove; JSON export and import. In a session, **Machines** switches to another one (it leaves the session, then opens the
other with its saved password). A machine you connect to is added by itself, named after its host.

It is a **small service of this repository** (`fleet/server.py`, Python standard library, SQLite), **optional**: without it
the client is exactly what it was — the form and the last ten connections. It never sees a machine password (the browser keeps
them), has no authentication of its own (it listens only inside Docker, behind nginx's Basic/cookie authentication), and its
container is read-only, unprivileged and has no published port.

```bash
./setup.sh                                  # asks "Activer la liste des postes ?" — answer 1
docker compose --profile fleet up -d        # or by hand
python3 scripts/online-probe.py 172.17.0.1  # can the service see who is online?
```

The **online** state comes from hbbs's raw TCP port **21115** (`OnlineRequest`, which hbbs OSS does not serve on the WebSocket
the browser can speak). If 21115 is filtered, the list still works and shows *unknown* — never "offline": the service does not
pretend to know. After an hbbs restart every machine looks offline until it re-registers (up to 30 s). Details, API and
troubleshooting: [docs/FLOTTE.md](docs/FLOTTE.md) (in French).

## Codec

The original client declares **no** decoding capability, so the server falls back
to software VP9 — even when the controlled machine has a hardware encoder. This
repository probes what the browser can decode through WebCodecs — H265, H264,
AV1, VP9 — declares all of it in `supported_decoding` after `peer_info`, and
prefers the best one, in the peer's own "auto" order: H265, H264, AV1, VP9.

The peer has the final say. H265 and H264 only exist on its side with a hardware
encoder, and the first frames of a session are always VP9, sent before it has read
the declaration. The decoder therefore **follows the stream that actually
arrives** rather than the one that was asked for. A codec that fails three times
is dropped for the lifetime of the page and the next one down is tried; software
decoding is the last rung, not the first fallback.

H264 and AV1 are covered by the test benches (negotiation, switching, fallback)
but have **not been measured against a real peer** the way H265 has.

To verify, on the controlled machine during a web session:

```
usable: h265=true → encoder: H265 → new encoder: HWRAM(hevc_videotoolbox, …)
```

> Negotiation is the **intersection of all active connections**: a native session
> open in parallel can drop both back to VP9. Open only one session when measuring.

A selector in the toolbar lets you force `h265`, `h264`, `av1`, `vp9`, or software
decoding. A forced codec is the only one declared; if the peer cannot encode it,
it answers in VP9 and the status overlay shows the codec really in use.

## Remote actions, displays, 2FA

The bundle already knows how to send Ctrl+Alt+Del, lock the remote session,
switch display and toggle session options; nothing in its interface called them.
The **Actions** menu of the toolbar does.

- **Privacy mode** and **block local input** depend on the peer (platform,
  permissions, installed service). The peer answers with a `BackNotification`,
  which the bundle decodes and ignores: the page reads it, says whether the
  request was accepted, and ticks the option only when it was. A refused privacy
  mode is also cleared from the bundle's per-peer options, which would otherwise
  request it again at every login.
- **Restart** asks for confirmation. The session drops; auto-reconnect gives up
  after about a minute, so reload the page once the machine is back.
- **Displays**: the selector appears when `peer_info` lists more than one
  display. The page only changes its state when the peer confirms the switch.
- **2FA**: on `2FA Required` the page prompts for the six-digit code and sends
  it as `auth_2fa`. Untested against a real 2FA peer; "trust this device" is not
  implemented, so the code is asked at every connection.

## Source layout

```
web/src/page.html          the skeleton: head, the bundle's script tags, include lines
web/src/style.css          all the styles
web/src/00-stockage.js     storage guards, the server host and key baked by the deployment
web/src/10-diagnostic.js   connection diagnostics, shared state, remote cursor
web/src/20-rdlib.js        RDLib: pure logic, no DOM — what the Node bench tests directly
web/src/30-session.js      input, video, clipboard, toolbar, login screen
web/src/40-fichiers.js     the file panel
```

`python3 scripts/build-page.py` assembles them into `web/index.html.template`,
which is **not versioned**: `setup.sh`, `verify.sh`, CI and both test benches
rebuild it before using it. The served page is still one file of inline blocks —
only the sources are split.

## Keyboard: a PC in front of a Mac

RustDesk sends modifiers one for one, so `Ctrl+C` reaches the Mac as `Control+C`,
where copy is `Cmd+C`. Swapping Ctrl and Cmd fixes the letters and breaks the rest:
`Ctrl+←` (previous word on a PC) became `Cmd+←` (start of line), `Ctrl+Tab` opened
the application switcher, and Home/End did not move the caret. Shortcuts are now
**translated** to the combination that has the same effect on the other side:

| On the PC keyboard | Sent to the Mac | Effect |
|---|---|---|
| `Ctrl` + letter | `Cmd` + letter | copy, paste, save, find, select all… |
| `Ctrl+←/→/↑/↓`, `Ctrl+Backspace`, `Ctrl+Del` | `Option` + same | move or erase word by word |
| `Home` / `End` | `Cmd+←` / `Cmd+→` | start / end of line |
| `Ctrl+Home` / `Ctrl+End` | `Cmd+↑` / `Cmd+↓` | start / end of document |
| `Ctrl+Y` | `Cmd+Shift+Z` | redo |
| `Ctrl+Tab`, `Ctrl+Space` | unchanged | next tab, completion |
| `Alt+F4` / `Ctrl+F4` | `Cmd+Q` / `Cmd+W` | quit / close the tab |
| `Alt+Tab` | `Cmd+Tab` | switch application |
| `Alt+←` / `Alt+→` | `Cmd+[` / `Cmd+]` | back / forward |
| `Ctrl+Insert`, `Shift+Del`, `Shift+Insert` | copy, cut, paste | the other PC clipboard keys |
| `Ctrl+Shift+Esc` | `Cmd+Option+Esc` | force quit |
| Windows key | `Control` | |
| `Ctrl` + click | `Cmd` + click | multiple selection (a `Ctrl` click is a right click on a Mac) |

`Shift` is always kept, so every selection variant follows. The direction is chosen
from the two platforms: a Mac keyboard in front of a Windows or Linux machine gets
the reverse table, and nothing is translated between two machines of the same
family — the toolbar button (**PC→Mac**, **Mac→PC**) only appears when there is
something to translate. Click it for **raw** mode, where every key goes through
untouched: that is what a remote terminal needs (`Ctrl+C` = SIGINT).

Three more fixes on the same path:

- **AltGr.** Windows reports AltGr as `Ctrl+Alt`, so `@`, `#`, `€`, `{` on a
  French or Swiss keyboard were sent as shortcuts and never typed. They are text.
- **Key release.** Letting go of `Ctrl` before the letter is common; the letter's
  release then arrived without `Ctrl`, was taken for text, and nothing was sent —
  the Mac kept `Cmd+C` held. The release now replays exactly what was pressed.
- `Alt+Tab`, `Alt+F4`, `Ctrl+W` and `Ctrl+T` only reach the page in **full
  screen** on Chromium; otherwise the local system keeps them.

What stays different: the application switcher cannot be held open (each `Alt+Tab`
is one complete `Cmd+Tab`), and `F2`, `Del` on a file or `PrintScreen` have no
single Mac equivalent and are sent as they are.

## Input: touch, wheel, full screen

- **Touch.** One finger is the mouse: a tap is a left click where you touched, a
  touch-then-drag holds the button, a long press without moving is a right click.
  Two fingers moving together scroll, in the "natural" direction. The **Keyboard**
  button, shown on touch devices, brings up the device keyboard. Tested in
  Chromium's touch emulation, not on a physical tablet.
- **Wheel.** The peer counts notches. One notch is sent per 100 px of accumulated
  scroll, which leaves a mouse wheel unchanged and tames a trackpad.
- **Full screen.** On Chromium the Keyboard Lock API hands the remote machine the
  shortcuts the browser or the system normally keep; hold Esc to leave. Firefox
  and Safari go full screen without the capture.

## Deployment hardening

- nginx does **not** inherit `add_header` from the `server` level into a
  `location` that declares one of its own. The three locations that set the
  session cookie were therefore served without `X-Frame-Options` or `nosniff`.
  The headers are now repeated in each, and a test fails if one goes missing.
- A content security policy forbids any script, image or connection to another
  host. It keeps `'unsafe-inline'`: the page is made of inline blocks and the
  bundle's form uses `onclick` attributes. The real-browser bench runs under this
  exact policy, read from `nginx.conf.template`.
- HSTS is sent by Caddy, where TLS terminates.

## Verifying a change

```bash
./scripts/verify.sh                 # the whole chain; needs Docker
./scripts/verify.sh --sans-docker   # everything except the images
```

`verify.sh` runs the whole pipeline — shell syntax, inline JavaScript, asset
extraction and patching, the template test bench, the real-browser bench when
Chromium is available, the authentication wire format **inside the built image**,
and a container that must actually answer 204 / 401 / 404. It works on a temporary
copy, so your `.env`, `.htpasswd` and any live deployment are left alone.
`--sans-docker` stops before the images and checks the wire format on the patched
bundle itself (CI repeats it inside the image, which is the check that counts).

The three suites can also be run on their own, after `extract-assets.sh`, `patch-assets.sh` and
`build-web.sh`:

```bash
node scripts/test-template.mjs --require-vendor          # Node only, no dependency
NODE_PATH=$(npm root -g) node scripts/test-browser.mjs   # real Chromium, via Playwright
python3 -I -m unittest discover -s fleet -v              # the machine-list service, against a fake hbbs
```

`verify.sh` also refuses a bench that runs fewer tests than its floor (149 / 86 / 19 today), so a test deleted or skipped in
silence cannot make the check pass. Run the browser bench with and without hardware decoding — it must pass on both paths.
`RD_TEST_FILTRE=text` runs only the browser tests whose name contains `text`.

The template bench loads the page's five scripts together in one context, guards
the contracts other tools read from the page, and exercises the clipboard,
session and toolbar wiring against a fake DOM, with the bundle's real zstd
decoder. The browser bench measures what a fake DOM cannot: where the pointer
actually lands, what the real `ClipboardItem` accepts, focus, and the bundle's real
login form. Without Playwright or a browser it skips itself with a message;
`--require-browser` makes it fail instead (CI passes it).

The same steps run in CI, but this does not depend on it: a clone should be
verifiable offline, and the loop is shorter than pushing to find out.

## Hidden tab: why the session timed out, and what changed

**The cause.** The bundle reads each incoming message by *polling* its buffer with
`setTimeout(…, 1)`. In a hidden tab the browser slows timers down: once per
second at first, then **once per minute** after five minutes. During that time the
page reads nothing, so it neither answers the remote machine's probes nor
acknowledges video frames — and the peer closes any connection that stays silent
for 30 seconds (`connection.rs`: `last_recv_time.elapsed() >= SEC30` →
`"Timeout"`). The messages themselves still arrive: a WebSocket's `message` event
is not throttled. A second defect sat on top: the bundle's own 12-second
"Timeout" was measured when the late timer finally fired, so a page that had only
been asleep declared a live connection dead.

**The fix.**

- Reading is now driven by the **arrival** of a message, not by a timer. The
  replacement is made on the bundle's connection class, so the file-transfer
  connection gets it too. A timer remains as a safety net only, and a late timer
  is recognised as "the page slept", not as silence.
- While the tab is hidden, frames are **acknowledged without being decoded** and
  the page asks the peer for 5 frames per second. Coming back restores your
  frame-rate cap and requests a key frame: the picture is back, up to date, in a
  fraction of a second. Nobody was watching, so this only removes load.
- The session holds a **Web Lock**, which keeps Chrome and Edge from *freezing*
  the tab (energy saver, sleeping tabs).

**What can still cut a session.** A tab the browser **discards** to reclaim
memory (Chrome's Memory Saver, Edge's sleeping tabs set to discard) is unloaded
entirely; on return the page reloads and auto-reconnect is all that is left.
Exclude the site in the browser's performance settings if that happens. A
suspended computer cuts every connection, whatever the page does.

Verified in the benches, including against the bundle's real connection class
with timers disabled. **Not** verified over a real ten-minute hidden session.

## Image quality at no extra cost

- **Colours.** RustDesk converts the screen to YUV with libyuv, which means
  BT.601, and writes nothing about it in the stream. With no indication the
  browser assumes BT.709: pure green came back as (0, 216, 2) and pure red as
  (255, 26, 1). The decoder is now told the matrix. Measured in Chromium on VP9,
  H264 and AV1 — green returns as (0, 255, 2). The cost is nil: it is the same
  computation with other coefficients, and a stream that does carry a colour tag
  still takes precedence.
- **Sharpness.** When the picture is within a few percent of a whole number of
  physical pixels per remote pixel, it is snapped to it and drawn without
  interpolation. A 1920-pixel picture shown on 1905 pixels was being resampled in
  full for an invisible gain of space; on a 125 % or 150 % display it now lands
  exactly on the physical pixels.
- **"Fit"** picks the remote resolution in *physical* pixels. On a 150 % display
  it used to choose a picture one third too small, then enlarge it.

The best quality for the least load is therefore: click **Fit**, so the remote
resolution matches your window. Fewer pixels to encode, none to interpolate.

What was looked at and **not** done, because it does cost something: 4:4:4 chroma
(sharper coloured text, about half as much data again), and a higher quality
ratio — the page already asks for 1.5, RustDesk's "best".

## Troubleshooting: `invalid key` on the relay

hbbr logs `Relay authentication failed from … - invalid key` and the browser
never gets a session. hbbr tells the client **nothing** — it just closes — so
all the browser sees is a `1006`.

**Start here, on the server machine. This is what settles it:**

```bash
./scripts/relay-doctor.sh            # readable table
./scripts/relay-doctor.sh --json     # paste into a report
```

Full step-by-step runbook, with the remedy for each verdict:
**[docs/DEPANNAGE-RELAIS.md](docs/DEPANNAGE-RELAIS.md)** (in French).

It reads the effective key of hbbs and of hbbr, derives it from the key file,
compares it with what the page will send, tests reachability of 21118 **and**
21119, reads the controlled peer's config if it lives on this machine, then
sends a real `RequestRelay` frame to `/ws/relay`. The verdict is binary.

### "But the native client works"

That is not a valid control, and it is the false witness that costs the most
time. The native client punches through NAT and goes **direct**: it barely ever
touches hbbr. The web client has no UDP — **it relays 100% of the time**.
"Native fine, web broken" is exactly the signature of a key disagreement
between hbbs and hbbr.

### What hbbr does, and how to read it

The check is one line of `relay_server.rs`:
`if !key.is_empty() && rf.licence_key != key { … return; }` — strict equality.
After that there are only two paths, and their duration tells them apart:

| Socket lifetime | Meaning |
|---|---|
| **under one second** | key rejected: immediate `return`, not a word to the client |
| **about thirty seconds** | key accepted, but the peer never arrived (`sleep(30)`) |

A relay has **two legs**, authenticated separately: the browser on one side,
the controlled host on the other. A wrong key **on the host** therefore does not
produce the instant failure but the 30-second wait. The two look alike on screen
and have different causes.

### The four causes, by frequency

1. **hbbs and hbbr do not share their key directory.** With `-k _`, each runs
   `gen_sk(300)`: after a wait, if the file is still missing it **generates its
   own pair**, silently. Under Docker that is an unshared volume; natively, two
   processes started from two different directories — the key file is looked up
   in the **working directory**, not at a fixed path.
   One-line check: the two `Key:` lines below must match.
2. **The value given to `setup.sh` is not the server's.** As of this version
   `setup.sh` reads it for you; never retype it.
3. **The private key pasted instead of the public one.** `id_ed25519` is bare
   base64, no `BEGIN`, no `PRIVATE`: nothing tells it apart by eye. `setup.sh`
   now recognises it by size (64 bytes) and offers the matching public key —
   which is literally its upper half.
4. **Stale or empty `localStorage`.** The bundle sends
   `localStorage.getItem("key") || void 0`: empty storage does not send an empty
   key, it **omits the field**, and hbbr rejects it just the same. In the page's
   console: `rdRelayTest()` for the verdict, `rdRelayReset()` to rewrite the key
   from the page and reload.

### Reading the effective key — the command that works

```bash
docker logs hbbs 2>&1 | grep 'Key:'      # Docker
docker logs hbbr 2>&1 | grep 'Key:'      # both must match
journalctl -u hbbs | grep 'Key:'         # systemd
```

> **Do not use `docker exec hbbs cat /root/id_ed25519.pub`.** That command is
> everywhere, this repository recommended it too, and it **cannot work** — for
> two independent reasons. The `rustdesk/rustdesk-server` image has **no shell,
> no `cat`, no `ls`**: `docker exec` answers `executable file not found in
> $PATH`. And the `.pub` file **often does not exist**: hbbs reads `id_ed25519`
> and derives the public key from its last 32 bytes (`common.rs`), so it never
> needs to read the `.pub` back. The key logged at startup is always the right
> one: it is the key the process actually enforces.

If all you have is the file, derive it without a container:

```bash
python3 -c "import base64,sys;k=base64.b64decode(open(sys.argv[1],'rb').read().strip());print(base64.b64encode(k[32:]).decode())" data/id_ed25519
```

> **Do not "fix" the `RequestRelay` protobuf tags.** This has now been tried and
> reverted twice. The official `rendezvous.proto` is `uuid = 2`,
> `licence_key = 6` — exactly what the bundle already sends. Reassigning them
> breaks the native client too, because hbbr then reads the uuid where the key
> should be. And hbbr does not authenticate WebSocket clients differently from
> raw TCP ones: `make_pair_` is generic over the stream, and the key check runs
> **before** any `is_ws()` branch.

## Where your server runs

`setup.sh` no longer guesses: it tries the candidates and keeps the one that
opens **21118 and 21119**. This table explains its choice, or lets you skip it.

| Condition | Read the key | `RD_BACKEND_HOST` |
|---|---|---|
| Linux + Docker, `network_mode: host` | `docker logs hbbs \| grep 'Key:'` | `172.17.0.1` |
| Docker Desktop / OrbStack / Colima | same | `host.docker.internal`, `host.lima.internal` |
| Native binaries | `journalctl -u hbbs \| grep 'Key:'`, or derive from the `id_ed25519` in the working directory | `172.17.0.1` or `127.0.0.1` |
| Server on another machine | read it over there | its name or IP |

Two warnings that cost hours:

- **`network_mode: host` under Docker Desktop does not mean macOS**, it means
  the internal Linux VM. `host.docker.internal` will not reach containers
  started that way; publish the ports, or run the web client on the same host.
- **Port 21118 does not identify hbbs.** The RustDesk *client* listens on it too
  for direct LAN connections. On a machine that hosts the server and runs the
  client, 21118 is ambiguous; **21119 is not**.

Minimal hbbs/hbbr example, with the part that matters — **one `data/`, mounted
in both**:

```yaml
services:
  hbbs:
    image: rustdesk/rustdesk-server
    command: hbbs -k _
    volumes: [./data:/root]          # the SAME as hbbr
    network_mode: host
    restart: unless-stopped
  hbbr:
    image: rustdesk/rustdesk-server
    command: hbbr -k _
    volumes: [./data:/root]          # the SAME as hbbs
    network_mode: host
    restart: unless-stopped
```

## Security

- Basic authentication on the page and assets, with rate limiting.
- 90-day session cookie, `HttpOnly` + `Secure` + `SameSite=Lax`, issued only in
  response to an already-authenticated request. **Changing the password
  regenerates the token**, which signs out previously authorised browsers.
- The source image is never executed; only its static files are served.
- No secrets in the repository: `setup.sh` generates `.env` and `.htpasswd`
  locally, both git-ignored.

> **The `/ws/id` and `/ws/relay` routes are not behind authentication.** They have
> to be: browsers do not reliably present credentials on a WebSocket handshake.
> Weigh the consequence: **this proxy makes hbbs and hbbr publicly reachable even
> if they only listen on a private interface.** What protects your server is
> `-k _`, not the page password — which means the **server public key must be
> treated as a secret**, since anyone holding it can use your relay without ever
> seeing the page.

Reasonable hardening not included here: fail2ban on nginx 401s, restricting port
443 by source IP if your usage allows it.

## Assets and provenance

The client's static assets — 59 files, 2.5 MB — are versioned in
`assets/rustdesk-web-assets.tar.gz`, with their SHA-256 in `assets/SHA256SUMS`.
Installation is **offline and depends on no third party**: nothing is downloaded
at install time.

Only the subset actually served is kept. The Flutter application shipped in the
same source image (`canvaskit`, `main.dart.js`, `assets/` — 26 MB) does not work
and is never used.

`setup.sh` unpacks them for you; there is nothing extra to run.

If you would rather audit the archive than take it on trust, this **optional**
command re-derives the same files from the original community image — pinned by
digest, never executed — and reports any divergence:

```bash
./scripts/extract-assets.sh --verify-provenance    # needs Docker and network
```

## Licensing

The code in this repository is **MIT**.

It **does** redistribute the client's compiled assets (see above). They come from
the RustDesk client, under **AGPL-3.0**; the corresponding source is the RustDesk
repository at the commit the community image was built from, referenced in
`scripts/extract-assets.sh`. ogv.js and yuv-canvas carry their own licences,
included in the archive.

What your browser executes, however, is a derivative work of the RustDesk client,
under **AGPL-3.0**. Its section 13 requires the **operator** of a network-accessible
service to offer the corresponding source: this repository, together with the
pinned digest in `scripts/extract-assets.sh` and the patches in
`patch-assets.sh`, constitutes that source. If you expose this service publicly,
keep a link to this repository reachable from your deployment.

## Support the project

This repository is maintained on a voluntary basis. If it saved you time:

```
ETH and EVM-compatible chains (Base, Arbitrum, Optimism, Polygon)
0x8eb20ec53380F3C6F8A12dfa9A8459298d2759c4
```

Check the chain before sending. No donation grants support or priority.
