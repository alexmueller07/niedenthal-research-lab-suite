# The RA download page

One static page: <https://niedenthal-lab-suite.vercel.app>. Deploy it with
`npx vercel deploy --prod` from this folder.

## Where the installers actually live

Not here. Vercel rejects a deployment containing any single file over 100 MB,
and the macOS dmg is ~159 MB. Both installers are **GitHub release assets**,
and `vercel.json` redirects the site's own paths to them:

| Button clicks | Redirects to |
|---|---|
| `/NiedenthalLabSuite-Setup.exe` | `releases/latest/download/NiedenthalLabSuite-Setup.exe` |
| `/NiedenthalLabSuite.dmg` | `releases/latest/download/NiedenthalLabSuite.dmg` |

The buttons point at the lab's own domain rather than at github.com, so if the
files ever move — Vercel Blob, the Research Drive, DoIT — only `vercel.json`
changes and the page stays as it is.

## Refreshing an installer

Deliberately manual. The page serves `releases/latest/download/...`, so
publishing straight from CI would push a new build onto lab machines the
moment anyone merged to `main` — including mid-study.

**Windows** — build locally and upload:

```bash
npx tauri build                       # from lab-suite/
gh release upload v0.1.0 "src-tauri/target/release/bundle/nsis/Niedenthal Lab Suite_0.1.0_x64-setup.exe#NiedenthalLabSuite-Setup.exe" --clobber
```

**macOS** — Tauri cannot cross-compile it, so it comes from the `Build
installers` workflow (`.github/workflows/release.yml`, job `build-mac`):

```bash
gh run download <run-id> --name niedenthal-lab-suite-macos --dir /tmp/mac
mv "/tmp/mac/Niedenthal Lab Suite_0.1.0_universal.dmg" /tmp/NiedenthalLabSuite.dmg
gh release upload v0.1.0 /tmp/NiedenthalLabSuite.dmg --clobber
```

After either, check the byte count end to end rather than trusting the upload:

```bash
curl -sL https://niedenthal-lab-suite.vercel.app/NiedenthalLabSuite.dmg | wc -c
```

## Known, and worth fixing

- The macOS app is **ad-hoc signed, not notarized**. Gatekeeper blocks it on
  first open; the page tells RAs to right-click → Open. Notarizing needs a paid
  Apple Developer account.
- A Mac records with **FFmpeg 7.1** while Windows records with **9.0**
  (`scripts/ffmpeg-manifest.json`). Fine for a rating station, wrong for a
  recording room — the point of pinning is that every machine encodes the same
  way.
- The Windows CI job cannot build: gyan.dev rotated its rolling release and the
  pinned checksum no longer matches. Re-pinning changes the encoder every lab
  machine uses, so it is Randy's call, not a silent bump.
