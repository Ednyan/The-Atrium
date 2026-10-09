import type { ReactNode } from 'react'

// A question that can't be taken back -- deleting, a file no longer followed:
// the theme's own panel with red corners, over the atrium dimmed. Clicking
// outside it is No.
export default function ConfirmBox({ title, testId, onCancel, children }: {
  title: ReactNode
  testId?: string
  onCancel: () => void
  children: ReactNode
}) {
  return (
    <div
      className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] pointer-events-auto"
      onClick={onCancel}
    >
      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203, 203, 203, 0.1) 2px, rgba(203, 203, 203, 0.1) 4px)',
        }}
      />

      {/* The theme's own panel: it was a fixed dark grey under the
          theme's ink, so on a light theme its words were dark on dark. */}
      <div
        data-confirm={testId}
        className="bg-nier-blackLight border border-red-500/40 p-6 max-w-md w-full mx-4 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-red-500/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-red-500/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-red-500/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-red-500/60" />

        <div className="flex items-center gap-3 mb-4">
          <div className="w-1.5 h-1.5 rotate-45 border border-red-500/60" />
          <h2 className="text-lg text-red-400 tracking-[0.15em] uppercase">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  )
}

// Its two answers: No, and the thing itself.
export function ConfirmButtons({ cancel, confirm, onCancel, onConfirm }: {
  cancel: string
  confirm: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex gap-3">
      <button
        className="flex-1 py-3 border border-nier-border/60 text-nier-bg/60 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border hover:text-nier-strong transition-colors"
        onClick={onCancel}
      >
        {cancel}
      </button>
      <button
        data-confirm-yes=""
        className="flex-1 py-3 border border-red-500/60 bg-red-500/20 text-nier-strong text-[10px] tracking-[0.15em] uppercase hover:bg-red-500/30 transition-colors"
        onClick={onConfirm}
      >
        {confirm}
      </button>
    </div>
  )
}
