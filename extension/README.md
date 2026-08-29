# Send to Atrium

Right-click an image anywhere on the web and send it into the atrium you
already have open.

## Installing it (unpacked, for your own use)

### Chrome, Edge, Brave, Opera, Vivaldi

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked**, and pick this `extension/` folder.

### Firefox

Firefox's MV3 wants `background.scripts` where Chrome's wants
`background.service_worker`, and each rejects the other's, so the two need
different manifests. Everything else is shared:

```bash
node scripts/pack-extension.mjs
```

That assembles `build-extension/firefox/`. Then open `about:debugging` → **This
Firefox** → **Load Temporary Add-on** → pick the `manifest.json` inside it.

"Temporary" is literal: it goes away when Firefox restarts. Making it stick
means signing through addons.mozilla.org, which is only worth doing if you
decide to publish it.

Re-run the script after any change to the shared files, or Firefox keeps
running the old copy.

### Safari

Not supported. It needs converting into an Xcode project and an Apple Developer
account to distribute.

## Using it

1. Open <https://digitalatrium.org> and enter an atrium — signed in, with
   edit permission.
2. Right-click on any other page:
   - an **image** → *Send image to atrium*
   - a **link** → *Send link to atrium* (arrives as an embed)
   - the **page itself** → *Send this page to atrium* (also an embed). The
     address bar cannot be right-clicked into: it is browser furniture, not
     page content, and no extension can add to its menu. Right-clicking the
     page gets the same address without selecting anything.
   - a **selection** → *as text*, or *as embed* if what you selected is an
     address
3. The trace appears in the middle of wherever you are looking.

If more than one atrium tab is open it goes to the one you used most recently.

## How it works, and what it deliberately doesn't do

The extension holds **no credentials and uploads nothing**. All it knows is the
address of the image you right-clicked. It hands that to the open atrium tab,
which is already signed in and already knows which atrium you are in, and the
page creates the trace itself.

That is why a tab has to be open — and why the extension says so rather than
failing quietly. It also means there is no token to leak: nothing here can
reach your account on its own.

The crossing between the extension and the app is a `window.postMessage`
targeted at the atrium's own origin, and the app checks the origin and the
sender before it accepts anything, so a page cannot forge one from a frame.

Only `http` and `https` images are sent. A `data:` or `blob:` image belongs to
the page that made it and means nothing anywhere else.

## Ideas not built yet

- **Send to desktop atrium** — needs a different road entirely, since an
  extension cannot talk to a native app. See the notes in the conversation: a
  localhost endpoint inside the Tauri app, with a pairing token, is the
  workable version.
- **Choose which atrium** rather than always the open one — needs the page to
  offer up the list.
