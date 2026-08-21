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
| Video | **hardware** H265 on both ends via WebCodecs, falling back to VP9 then software |
| Mouse | movement, left/right click, wheel, correctly scaled coordinates |
| Keyboard | text, accents, non-US layouts, dead keys, control keys |
| `Ctrl` → `Cmd` | toggleable, for macOS or for a remote terminal |
| Clipboard | text both ways; **images and rich text** too, on Chromium |
| Files | remote panel: browse, upload, download, create, rename, delete |
| Resolution | menu of the modes the remote display actually supports, plus "fit to window" |
| Cursor | the real remote cursor, with its hotspot |
| Audio | Opus, with the audio context resumed on first gesture |
| Zero-downtime deploys | the TLS layer waits for the web container instead of erroring out during a restart |
| Auto-reconnect | a dropped session retries on its own, with backoff — no fallback to the connect form |
| Screen wake lock | the display never sleeps while a session is live, like YouTube during playback |
| Metrics | p50/p95/p99 percentiles for latency and decode time, as an overlay |
| Access | Basic authentication plus a 90-day session cookie |

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
- A domain name with a **direct A record** to this machine, unproxied
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

## The five bundle patches

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
   already ships a wasm decoder, but module-scoped; we expose it
   (`window.__rdUnzstd`) rather than shipping a second one.

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
`paste` event already carries the bytes — so it works everywhere. Two conditions:
the peer must run **RustDesk 1.3.0 or later**, the only version that understands
`multi_clipboards` (the peer version is echoed to the console on every image
send), and the image must stay under **8 MiB**. Browsers do not always hand over
PNG: jpeg and webp are re-encoded, because announcing the wrong format would give
the peer bytes it cannot read.

**Remote → browser.** A green "Image reçue ⇩" or "Texte reçu ⇩" button appears in
the settings bar, which reveals itself. You must click it, and that is not an
oversight: writing to the system clipboard requires recent user activation, and
Chrome refuses more than roughly a second after the interaction. Posting
automatically on arrival is therefore bound to fail — Guacamole exposes a
dedicated area for the same reason. This direction is **Chromium only**: Firefox
and Safari do not write images to the clipboard, and the refusal is named in the
console. KasmVNC, the only comparable project to have done this, likewise limits
its rich clipboard to Chromium.

An image arriving over the legacy `clipboard` message is intercepted before the
bundle, whose branch decodes the payload as text unconditionally — without that,
it would paste garbage.

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

The V1 client wires up **display only**. Everything else lives in
`web/index.html.template`, through `window.curConn` and `setByName`, **without
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

## Codec

The original client declares **no** decoding capability, so the server falls back
to software VP9 — even when the controlled machine has a hardware encoder. This
repository declares `supported_decoding{prefer:H265}` after `peer_info` and
switches the browser decoder to WebCodecs.

To verify, on the controlled machine during a web session:

```
usable: h265=true → encoder: H265 → new encoder: HWRAM(hevc_videotoolbox, …)
```

> Negotiation is the **intersection of all active connections**: a native session
> open in parallel can drop both back to VP9. Open only one session when measuring.

A selector in the toolbar lets you force `h265`, `vp9`, or software decoding.

## Verifying a change

```bash
./scripts/verify.sh
```

Runs the whole pipeline — shell syntax, inline JavaScript, asset extraction and
patching, the authentication wire format **inside the built image**, and a
container that must actually answer 204 / 401 / 404. It works on a temporary
copy, so your `.env`, `.htpasswd` and any live deployment are left alone.

The same steps run in CI, but this does not depend on it: a clone should be
verifiable offline, and the loop is shorter than pushing to find out.

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
