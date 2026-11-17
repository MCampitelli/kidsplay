import { useRef } from "react"

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Remote controls have no Tab key, so ArrowLeft/Right must move focus manually.
  function focusSibling(target: React.RefObject<HTMLButtonElement | null>) {
    return (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault()
        target.current?.focus()
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
        <h2 className="font-display text-2xl text-[#2D2D2D] text-center mb-3">
          {title}
        </h2>
        <p className="text-center text-sm text-[#5A5A5A] whitespace-pre-line">
          {message}
        </p>
        <div className="mt-6 flex gap-3">
          <button
            ref={cancelRef}
            autoFocus
            type="button"
            onClick={onCancel}
            onKeyDown={focusSibling(confirmRef)}
            className="flex-1 rounded-full bg-[#FFF8F0] px-4 py-3 font-bold text-[#2D2D2D] border-2 border-[#FFD93D] transition-colors hover:bg-[#FFE8D1]"
            data-tv-focusable
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            onKeyDown={focusSibling(cancelRef)}
            className={`flex-1 rounded-full px-4 py-3 font-bold text-white transition-colors ${
              destructive
                ? "bg-[#FF6B6B] hover:bg-[#e85555]"
                : "bg-[#4ECDC4] hover:bg-[#3bb8af]"
            }`}
            data-tv-focusable
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
