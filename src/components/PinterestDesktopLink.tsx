import { useEffect, useState } from 'react'
import { beginDesktopPinterestConnect, takeDesktopPairingCode, isPinterestConfigured } from '../lib/pinterest'

// The page a desktop app sends its user to, to connect Pinterest.
//
// Deliberately requires no Atrium account. The desktop app has no https origin
// for Pinterest to redirect back to, so the browser does the round trip on its
// behalf -- and asking someone to create an account here, purely to reach their
// own Pinterest boards from an app that stores everything locally, would be
// asking for something the task never needed.
//
// Two states: before the round trip, a button; after it, the code to carry
// back. There is nothing to keep afterwards, which is why the code is taken
// rather than read -- refreshing this page should not re-offer a code that has
// already been typed in somewhere.
export default function PinterestDesktopLink() {
  const [code, setCode] = useState<string | null>(null)

  useEffect(() => {
    setCode(takeDesktopPairingCode())
  }, [])

  return (
    <div className="fixed inset-0 bg-nier-black flex items-center justify-center p-6 font-mono">
      <div className="relative w-full max-w-md bg-nier-blackLight border border-nier-border/40 p-8">
        <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-6">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h1 className="text-lg text-white tracking-[0.15em] uppercase">Link Pinterest</h1>
        </div>

        {code ? (
          <>
            <p className="text-nier-bg/80 text-[0.85rem] leading-relaxed tracking-wide mb-4">
              Type this into the desktop app, under Profile Settings → Pinterest.
            </p>
            <div className="border border-nier-border/40 bg-nier-border/10 px-4 py-5 text-center mb-4">
              <p className="text-nier-strong text-2xl tracking-[0.5em]">{code}</p>
            </div>
            <p className="text-nier-bg/60 text-[0.75rem] leading-relaxed tracking-wide">
              It lasts ten minutes and works once. If it expires, come back here and connect again.
            </p>
          </>
        ) : (
          <>
            <p className="text-nier-bg/80 text-[0.85rem] leading-relaxed tracking-wide mb-6">
              This connects Pinterest for your desktop app. You do not need an Atrium account —
              afterwards you will get a short code to type into the app.
            </p>
            <button
              type="button"
              onClick={beginDesktopPinterestConnect}
              disabled={!isPinterestConfigured()}
              className="w-full py-2.5 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Connect Pinterest
            </button>
            {!isPinterestConfigured() && (
              <p className="text-nier-bg/60 text-[0.75rem] leading-relaxed tracking-wide mt-3">
                Pinterest is not configured on this site yet.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
