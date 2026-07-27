# Publishing a desktop update

Two routes. **Use CI** unless you have a reason not to — it's the only one that
produces macOS and Linux builds, since Tauri can't cross-compile and each
artifact has to be built on its own OS.

---

# Route A — GitHub Actions (all platforms)

## One-time: add the signing key as a repository secret

Settings → Secrets and variables → Actions → **New repository secret**:

| Name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the entire contents of `atrium-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | leave empty (the key has no password) |

Both must exist. Without them the build still succeeds and still produces
installers — it just emits no signatures, and every installed app rejects the
update as unsigned.

## Every release

1. Bump `version` in `src-tauri/tauri.conf.json` (and `package.json`), commit,
   push.
2. Tag and push the tag:

   ```bash
   git tag v1.0.2
   git push origin v1.0.2
   ```

3. Watch the run in the **Actions** tab. Three jobs build in parallel; expect
   roughly 10–20 minutes.
4. The release is created as a **draft**. Open it, check all three platforms
   uploaded plus `latest.json`, write the notes, and **Publish**.

Publishing the draft is what makes installed apps start offering the update,
which is why it isn't automatic.

Only a tag triggers this — ordinary pushes to the branch never ship anything.

---

# Route B — locally, Windows only

Kept for quick one-offs. Produces no macOS or Linux build.

## Step by step

The desktop app checks for updates at launch, hourly after that, and again
whenever the machine reconnects. Right now it finds nothing, because no
release exists yet. This is the whole process.

---

## Before the first release (once, ever)

### 1. Back up the signing key

```
C:\Users\Ednyan\Desktop\atrium-updater-keys\atrium-updater.key
```

Copy it somewhere safe that isn't this machine — a password manager, an
encrypted drive, wherever you keep things you can't lose.

**Why it matters:** installed copies of the app only accept updates signed by
this exact key. If it's lost, every existing install becomes permanently
un-updatable and each user has to reinstall by hand. There is no recovery and
no way to "re-issue" it. `*.key` is gitignored so it can't be committed by
accident.

The matching public key is already in `src-tauri/tauri.conf.json` and gets
compiled into the app. Don't change it.

---

## Every release

### 2. Bump the version

Edit **`src-tauri/tauri.conf.json`**:

```json
"version": "1.0.1",
```

This is the number the updater compares against. If it doesn't go up, installed
apps will decide they're already current and offer nothing. Bump
`package.json` too so they don't drift apart.

Version numbers must be `MAJOR.MINOR.PATCH` — `1.0.1`, not `v1.0.1` or `1.0.1-beta`.

### 3. Build, with the signing key in the environment

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat /c/Users/Ednyan/Desktop/atrium-updater-keys/atrium-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri:build
```

Both lines matter. The password is empty because the key was generated without
one, but the variable still has to be set or the build will sit waiting for
input.

**If you skip the key entirely**, the build still succeeds and still produces
installers — it just silently produces no `.sig` file, and the update will be
rejected by every client as unsigned. That's the easiest mistake to make here.

Output lands in:

```
src-tauri\target\release\bundle\nsis\
```

You need **two** files from there:
- `The Digital Atrium_<version>_x64-setup.exe`
- `The Digital Atrium_<version>_x64-setup.exe.sig`

### 4. Create the GitHub release

On <https://github.com/Ednyan/The-Atrium/releases> → **Draft a new release**.

- **Tag:** `v1.0.1` (matching the version, with a leading `v` by convention)
- **Title:** anything you like
- **Attach:** the `.exe` **and** the `.sig` from step 3

Don't publish yet — one more file to add.

### 5. Generate `latest.json`

This is the manifest the app actually reads. Generate it rather than writing
it by hand:

```bash
node scripts/make-release-manifest.mjs "Fixed the thing. Added the other thing."
```

The argument is the release note **shown to the user** in the update prompt,
so write it for them rather than as a changelog for yourself.

It writes `latest.json` in the repo root, and handles the two things that are
easy to get wrong by hand: the `signature` field takes the `.sig` file's
*contents* (not a path), and the download URL has to use dots where the
filename has spaces, because that's how GitHub serves the asset.

It also refuses to run if the `.sig` is missing — i.e. if step 3 was run
without the signing key — rather than producing a manifest every client will
reject.

Attach `latest.json` to the same release, then **Publish**.

### 6. Verify

The app fetches `releases/latest/download/latest.json`, which always resolves
to your newest release. Check it's reachable:

```bash
curl -sL https://github.com/Ednyan/The-Atrium/releases/latest/download/latest.json
```

If that prints your JSON, an installed older copy will offer the update within
the hour — or immediately on next launch.

---

## Testing it actually works

The only real test is a version gap between an installed app and a release:

1. Install the current build (run the `.exe` — not the app from
   `target/release`, which has nothing sane to install over).
2. Bump to a higher version, build, and publish as above.
3. Launch the installed copy. The prompt should appear bottom-right.
4. Click **Update Now** — it downloads, installs, and relaunches itself.

## Notes

- A failed check is deliberately silent: offline, no releases yet, or GitHub
  being down are all normal for a background poll. Details go to the console.
- Updates apply to **installed** copies only.
- macOS and Linux would each need their own `platforms` entry and their own
  builds; the manifest above is Windows-only, which matches what you ship.
