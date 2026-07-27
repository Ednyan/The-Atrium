# Releasing a desktop update

The desktop app checks for updates at launch and hourly, and can install one
in place. This is what has to happen for it to find anything.

## One-time setup

The signing keypair already exists (generated once, and it must never be
regenerated — existing installs only trust updates signed by the key whose
public half is baked into `src-tauri/tauri.conf.json`).

- **Private key:** `C:\Users\Ednyan\Desktop\atrium-updater-keys\atrium-updater.key`
- **Public key:** already in `tauri.conf.json` under `plugins.updater.pubkey`

Back the private key up somewhere durable. If it is lost, every installed
copy of the app becomes un-updatable — they will reject anything signed by a
new key, and the only fix is for each user to reinstall by hand. `*.key` is
gitignored so it cannot be committed by accident.

## Publishing a release

1. **Bump the version** in `src-tauri/tauri.conf.json`. The updater compares
   this against the version in the release manifest, so an unchanged version
   means no update is offered.

2. **Build with the signing key in the environment.** Without it the bundler
   produces no `.sig` files and the update will be rejected as unsigned:

   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat /c/Users/Ednyan/Desktop/atrium-updater-keys/atrium-updater.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   npm run tauri:build
   ```

   `createUpdaterArtifacts` is enabled, so this emits an updater bundle plus a
   matching `.sig` alongside the normal installers.

3. **Create a GitHub release** tagged with the new version, and upload:
   - `The Digital Atrium_<version>_x64-setup.exe` (the NSIS installer)
   - its `.sig` file
   - `latest.json` (below)

4. **Write `latest.json`** and attach it to the same release. The app fetches
   it from `releases/latest/download/latest.json`, which always resolves to
   the newest release:

   ```json
   {
     "version": "1.1.0",
     "notes": "What changed in this release.",
     "pub_date": "2026-07-27T00:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<contents of the .sig file>",
         "url": "https://github.com/Ednyan/The-Atrium/releases/download/v1.1.0/The.Digital.Atrium_1.1.0_x64-setup.exe"
       }
     }
   }
   ```

   `signature` is the **contents** of the `.sig` file, not a link to it. The
   `url` must match how GitHub actually names the uploaded asset — it replaces
   spaces with dots, which is easy to get wrong.

## Notes

- The in-app `notes` field is shown to the user in the update prompt, so write
  it for them rather than as a changelog for yourself.
- A failed check is silent by design (offline, no releases yet, GitHub down);
  it just retries next hour, and immediately if the machine comes back online.
- Updates only apply to **installed** copies. Running the app straight from
  `target/release` will find updates but has nothing sane to install over.
