import { recordAppealResponse, type AppealResponse } from '../lib/supportAppeal'

interface SupportAppealProps {
  onDonate: () => void
  onClose: () => void
}

// The one time the app asks for money.
//
// Shown at launch, on the welcome screen, and never over an atrium -- being
// interrupted mid-work by a request for money is how goodwill is spent rather
// than earned. It appears only after someone has used the app enough to have
// something invested in it, and every answer buys silence: months after a
// donation, another fortnight and another twenty traces after a no.
//
// Three answers rather than two. "Not now" and "remind me later" are different
// things, and collapsing them forces anyone willing to be asked again into
// declining outright.
export default function SupportAppeal({ onDonate, onClose }: SupportAppealProps) {
  const answer = (response: AppealResponse) => {
    recordAppealResponse(response)
    if (response === 'donated') onDonate()
    else onClose()
  }

  return (
    <div className="fixed inset-0 bg-nier-black/85 flex items-center justify-center z-[10000300] pointer-events-auto" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">A small ask</h3>
        </div>

        <div className="space-y-3 text-xs text-nier-bg/80 tracking-wide leading-relaxed mb-6">
          <p>
            You've been building here for a while, which is the only reason this is
            being asked at all.
          </p>
          <p>
            The Digital Atrium is made by one person, and runs on things that cost
            money every month — the database your atriums live in, the email that
            handles new accounts, the domain it all sits on. Anything you give goes
            to keeping those paid for and the work going.
          </p>
          <p className="text-nier-bg/70">
            From €1, once or monthly. Nothing here is locked, and nothing will be.
          </p>
        </div>

        <button
          type="button"
          onClick={() => answer('donated')}
          className="w-full py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
        >
          Contribute
        </button>

        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => answer('remind_later')}
            className="flex-1 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
          >
            Remind me later
          </button>
          <button
            type="button"
            onClick={() => answer('not_now')}
            className="flex-1 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
