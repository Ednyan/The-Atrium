# Send to Atrium

Right-click an image anywhere on the web and send it into the atrium you
already have open.

## Installing it (unpacked, for your own use)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked**, and pick this `extension/` folder.

Firefox needs its own listing and a slightly different manifest, so this is
Chrome/Edge for now.

## Using it

1. Open <https://the-atrium.pages.dev> and enter an atrium — signed in, with
   edit permission.
2. Right-click any image on any other page → **Send to web atrium**.
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

- **Send a link as an embed** — right-click a link or page, get an embed trace.
- **Send selected text** as a text trace.
- **Send to desktop atrium** — needs a different road entirely, since an
  extension cannot talk to a native app. See the notes in the conversation: a
  localhost endpoint inside the Tauri app, with a pairing token, is the
  workable version.
- **Choose which atrium** rather than always the open one — needs the page to
  offer up the list.
