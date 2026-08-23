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
# LAB_SUITE_DEVICE_KEY must match PPS_SHARED_SECRET on the Round Robin
# deployment. A build without it carries the development key and the
# production server refuses it — see the README's "Device authentication".
# It is already set as a repository secret, so CI builds carry it; only a
# local build needs it passed by hand.
LAB_SUITE_DEVICE_KEY=... npx tauri build          # from lab-suite/

# Copy to the exact asset name FIRST. `gh release upload file#name` sets the
# asset's *label*, not its filename — upload the bundle directly and GitHub
# names it "Niedenthal.Lab.Suite_1.0.0_x64-setup.exe", which is not what
# vercel.json redirects to, so every download 404s.
cp "src-tauri/target/release/bundle/nsis/Niedenthal Lab Suite_1.0.0_x64-setup.exe" /tmp/NiedenthalLabSuite-Setup.exe
gh release upload v1.0.0 /tmp/NiedenthalLabSuite-Setup.exe --clobber
```

**macOS** — Tauri cannot cross-compile it, so it comes from the `Build
installers` workflow (`.github/workflows/release.yml`, job `build-mac`):

```bash
gh workflow run "Build installers" --ref <branch>     # if there is no run yet
gh run download <run-id> --name niedenthal-lab-suite-macos --dir /tmp/mac
mv "/tmp/mac/Niedenthal Lab Suite_1.0.0_universal.dmg" /tmp/NiedenthalLabSuite.dmg
gh release upload v1.0.0 /tmp/NiedenthalLabSuite.dmg --clobber
```

After either, check the byte count end to end rather than trusting the upload:

```bash
curl -sI -L https://niedenthal-lab-suite.vercel.app/NiedenthalLabSuite.dmg | tail -3
```

The page checks too, and says so out loud: it reads the version and size off
the GitHub release, disables a button whose asset is missing ("Not published
yet"), and shows a notice at the top while the released installer is older
than the version the instructions describe. That notice clears itself on the
next upload — there is nothing to remember to delete.

## Known, and worth fixing

- The macOS app is **ad-hoc signed, not notarized**. Gatekeeper blocks it on
  first open; the page tells RAs to right-click → Open. Notarizing needs a paid
  Apple Developer account.
- A Mac records with **FFmpeg 7.1** while Windows records with **9.0**
  (`scripts/ffmpeg-manifest.json`). Fine for a rating station, wrong for a
  recording room — the point of pinning is that every machine encodes the same
  way.
- The Windows CI job cannot build: gyan.dev rotated its rolling release and the
  pinned checksum no longer matches (confirmed again on 2026-08-23). Windows
  installers therefore come from a local `npx tauri build`. Re-pinning changes
  the encoder every lab machine uses, so it is Randy's call, not a silent bump.
  The macOS job is unaffected and builds fine.
