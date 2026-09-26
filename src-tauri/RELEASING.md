# Releasing Parallax (macOS, with auto-update)

The desktop app checks for an update on launch, ~4s after first paint, and
offers it in a bar at the bottom of the window. It never installs without
being asked: a silent update that relaunches the app is indistinguishable
from a crash to whoever was mid-sentence in a briefing.

## The signing key

Updates are signed. The app refuses any bundle that does not verify against
the public key baked into `tauri.conf.json`, which is what stops someone
serving their own "update" from a machine in the middle.

The keypair was generated with `tauri signer generate`. The **public** key
is committed, in `tauri.conf.json` under `plugins.updater.pubkey`. The
**private** key is not, and must not be — anyone holding it can publish an
update that every installed copy will accept and run.

Store the private key in the password manager and as a CI secret:

- `TAURI_SIGNING_PRIVATE_KEY` — the key file's contents
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — empty for the current key

**If the private key is lost, auto-update is over for every copy already
installed.** They will keep checking, keep failing verification, and the
only way forward is for each person to download a new DMG by hand. Back it
up somewhere that survives a laptop.

## Cutting a release

1. Bump `version` in `src-tauri/tauri.conf.json`. The updater compares
   against this string, so an unchanged version ships to nobody.

2. Build, with the key in the environment:

   ```sh
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.parallax-signing/parallax.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
   npx tauri build --bundles app
   ```

   The key goes in as its CONTENTS, not as a path.
   `TAURI_SIGNING_PRIVATE_KEY_PATH` is documented but the bundler does not
   read it — the build compiles for several minutes and only then fails
   with "A public key has been found, but no private key".

   `--bundles app` rather than `dmg`: Tauri's DMG step drives Finder over
   AppleScript to lay out the window, which never returns unless a real
   logged-in Finder session is driving it. It hangs at 0% CPU with the
   staging image left mounted. Build the .app, then make the disk image
   directly:

   ```sh
   B=src-tauri/target/release/bundle
   STAGE=$(mktemp -d)
   cp -R "$B/macos/Parallax.app" "$STAGE/"
   ln -s /Applications "$STAGE/Applications"
   hdiutil create -volname Parallax -srcfolder "$STAGE" -ov -format UDZO \
     "$B/dmg/Parallax_1.0.0_aarch64.dmg"
   ```

   `createUpdaterArtifacts` is on, so this produces both the installable
   `.dmg` and the update payload: `Parallax.app.tar.gz` and its `.sig`.
   Without the `.sig` the bundle installs but cannot update — that is the
   failure people hit after shipping, because the DMG works fine.

   Output lands in `src-tauri/target/release/bundle/`.

3. Write `latest.json`:

   ```json
   {
     "version": "1.0.1",
     "notes": "What changed, in a sentence someone would actually read.",
     "pub_date": "2026-09-27T00:00:00Z",
     "platforms": {
       "darwin-aarch64": {
         "signature": "<contents of Parallax.app.tar.gz.sig>",
         "url": "https://github.com/ZaphodBeblerbox/Horizon-Watch/releases/download/v1.0.1/Parallax.app.tar.gz"
       }
     }
   }
   ```

   `signature` is the **contents** of the `.sig` file, not a path to it.
   Add a `darwin-x86_64` entry too if you ship Intel builds; a Mac only
   reads its own architecture's entry and ignores the rest.

4. Attach `Parallax.app.tar.gz`, its `.sig`, `latest.json` and the `.dmg`
   to a GitHub release, and point the release tag at the version you built.

The endpoint the app polls is in `tauri.conf.json`:

```
https://github.com/ZaphodBeblerbox/Horizon-Watch/releases/latest/download/latest.json
```

`releases/latest/download/<name>` always resolves to the newest published
release, so the endpoint never has to change when you cut a new version —
only the `latest.json` attached to that release does.

Note this URL is baked into the binary at compile time. Changing it means
rebuilding and redistributing; copies already installed keep polling
whatever they were built with.

## Notarisation

Unnotarised builds are blocked by Gatekeeper on any Mac that did not build
them, and the message the user sees ("damaged and can't be opened") does
not say why. For anything leaving this machine, set `APPLE_ID`,
`APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID` before
building, and Tauri will notarise and staple.

Auto-update does not bypass this: the downloaded bundle is checked the same
way, so an unnotarised update fails to launch after a successful install —
which looks exactly like the update having broken the app.
