import { useEffect } from "react";

export interface ToastData {
  message: string;
  type: "success" | "error";
}

interface ToastProps {
  toast: ToastData | null;
  onClose: () => void;
}

export const Toast = ({ toast, onClose }: ToastProps) => {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  const bgColor = toast.type === "success" ? "bg-green-600" : "bg-red-600";

  return (
    <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg text-white shadow-lg ${bgColor} transition-all`}>
      <div className="flex items-center gap-2">
        <span>{toast.message}</span>
        <button onClick={onClose} className="text-white/80 hover:text-white text-lg leading-none">&times;</button>
      </div>
    </div>
  );
};
