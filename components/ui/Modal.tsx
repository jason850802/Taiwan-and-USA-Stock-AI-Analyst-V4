import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  maxWidth?: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  maxWidth = 'max-w-2xl',
  children,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) contentRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        className={`w-full bg-surface-card border border-surface-line rounded-modal p-6 max-h-[85vh] overflow-y-auto outline-none ${maxWidth}`}
      >
        {title && (
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="關閉"
              className="w-8 h-8 inline-flex items-center justify-center rounded-ctl text-slate-400 hover:text-white hover:bg-surface-inset transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

export default Modal;
