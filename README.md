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
| Clipboard | remote → browser, and browser → remote (text) |
| Resolution | menu of the modes the remote display actually supports, plus "fit to window" |
| Cursor | the real remote cursor, with its hotspot |
| Audio | Opus, with the audio context resumed on first gesture |
| Zero-downtime deploys | the TLS layer waits for the web container instead of erroring out during a restart |
| Auto-reconnect | a dropped session retries on its own, with backoff — no fallback to the connect form |
| Screen wake lock | the display never sleeps while a session is live, like YouTube during playback |
| Metrics | p50/p95/p99 percentiles for latency and decode time, as an overlay |
| Access | Basic authentication plus a 90-day session cookie |

**Not supported**: file transfer. It is absent from this client's protocol — its
message loop handles eleven types, none of them file-related.

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

## The four bundle patches

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

## Troubleshooting: `invalid key` on the relay

hbbr logs `Relay authentication failed from … - invalid key` and the browser
never gets a session. hbbr tells the client nothing at all — it just closes —
so the page shows a banner inferred from how fast the socket died.

**The cause is a key mismatch, and it is nearly always one of these:**

1. **hbbs and hbbr do not share the same `data/` volume.** With `-k _`, each
   process generates its own key pair on first start, so the key hbbs publishes
   is not the key hbbr checks. Both services must mount the *same* directory.
2. The value given to `setup.sh` is not what the server actually uses. Read it
   from the server, do not retype it:
   ```bash
   docker exec hbbs cat /root/id_ed25519.pub    # 44 base64 chars, ends with '='
   ```
3. Whitespace or a newline pasted along with the key. `setup.sh` strips it and
   warns on an unexpected shape, but a browser that connected before the fix
   keeps the old value in `localStorage` — reload once after correcting `.env`.

Confirm it is really the key: a relay socket that dies in **under a second** is
a rejected key; one that lives about **30 seconds** means the key was fine and
the remote host never joined. Those are the two distinct code paths in hbbr's
`relay_server.rs`, nothing else closes that socket silently.

> **Do not "fix" the `RequestRelay` protobuf tags.** This has now been tried and
> reverted twice. The official `rendezvous.proto` is `uuid = 2`,
> `licence_key = 6` — exactly what the bundle already sends. Reassigning them
> breaks the native client too, because hbbr then reads the uuid where the key
> should be. And hbbr does not authenticate WebSocket clients differently from
> raw TCP ones: `make_pair_` is generic over the stream, and the key check runs
> **before** any `is_ws()` branch.

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
