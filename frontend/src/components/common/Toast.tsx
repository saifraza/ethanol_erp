import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';

interface ToastMsg { id: number; text: string; type: 'error' | 'success' | 'info'; }

const ToastCtx = createContext<{
  toast: (text: string, type?: 'error' | 'success' | 'info') => void;
}>({ toast: () => {} });

export const useToast = () => useContext(ToastCtx);

let _id = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msgs, setMsgs] = useState<ToastMsg[]>([]);

  const toast = useCallback((text: string, type: 'error' | 'success' | 'info' = 'error') => {
    const id = ++_id;
    setMsgs(prev => [...prev, { id, text, type }]);
    setTimeout(() => setMsgs(prev => prev.filter(m => m.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
        {msgs.map(m => (
          <div key={m.id}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white animate-in
              ${m.type === 'error' ? 'bg-red-600' : m.type === 'success' ? 'bg-emerald-600' : 'bg-blue-600'}`}
            onClick={() => setMsgs(prev => prev.filter(x => x.id !== m.id))}>
            {m.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
