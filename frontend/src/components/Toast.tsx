import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

// Success toasts, bottom-left, 3 s. Used after Send, Apply, Close, and Resend.
type Toast = { id: number; text: string };
const Ctx = createContext<(text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((text: string) => {
    const id = next.current++;
    setToasts((t) => [...t, { id, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-6 left-6 z-50 flex flex-col gap-2" data-testid="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast-in flex items-center gap-2 rounded-control bg-ink px-4 py-3 text-body text-white shadow-pop" data-testid="toast">
            <Check size={16} strokeWidth={2.2} aria-hidden="true" />
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
