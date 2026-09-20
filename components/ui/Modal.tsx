import React, { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  maxWidth?: string;
  children: React.ReactNode;
}

// 僅追蹤目前開啟的共用視窗，鍵盤及視覺層級使用同一個順序。
const openDialogs: HTMLElement[] = [];
const isAvailable = (element: HTMLElement) => element.isConnected
  && !element.matches(':disabled')
  && !element.closest('[hidden], [inert], [aria-hidden="true"]')
  && element.getClientRects().length > 0
  && getComputedStyle(element).visibility === 'visible';
const focusableIn = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>(
  'button, input, select, textarea, a[href], summary, [tabindex], [contenteditable="true"]',
)).filter(element => element.tabIndex >= 0 && isAvailable(element))
  .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
const updateLayers = () => openDialogs.forEach((dialog, index) => {
  if (dialog.parentElement) dialog.parentElement.style.zIndex = String(50 + index);
});

const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  maxWidth = 'max-w-2xl',
  children,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });

  useLayoutEffect(() => {
    const dialog = contentRef.current;
    if (!open || !dialog) return;
    const active = document.activeElement;
    // StrictMode 在新掛載時重播 effect；第二次焦點已在視窗內，不可蓋掉真正來源。
    if (active instanceof HTMLElement && !dialog.contains(active)) sourceRef.current = active;
    const source = sourceRef.current;
    // 同次掛載的內層 effect 可能先執行；外層必須排在其下方。
    const childIndex = openDialogs.findIndex(current => dialog.contains(current));
    openDialogs.splice(childIndex < 0 ? openDialogs.length : childIndex, 0, dialog);
    updateLayers();
    const isTop = () => openDialogs.at(-1) === dialog;
    const focusFirst = () => (focusableIn(dialog)[0] || dialog).focus();
    const retainFocus = () => {
      if (!isTop()) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !dialog.contains(active) || !isAvailable(active)) focusFirst();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const controls = focusableIn(dialog), active = document.activeElement;
        const index = controls.indexOf(active as HTMLElement);
        if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === controls.length - 1) {
          event.preventDefault();
          (event.shiftKey ? controls.at(-1) || dialog : controls[0] || dialog).focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', retainFocus, true);
    // 動態停用、隱藏或移除目前控制項時，也必須把焦點留在有效內容內。
    const observer = new MutationObserver(retainFocus);
    observer.observe(dialog, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['disabled', 'hidden', 'inert', 'aria-hidden', 'tabindex', 'class', 'style'] });
    if (isTop()) focusFirst();
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', retainFocus, true);
      const wasTop = isTop();
      const index = openDialogs.indexOf(dialog);
      if (index >= 0) openDialogs.splice(index, 1);
      updateLayers();
      const remaining = openDialogs.at(-1);
      // 等待本輪 React 移除 DOM；新視窗已接手時不奪回焦點。
      if (wasTop) queueMicrotask(() => {
        if (openDialogs.at(-1) !== remaining) return;
        const target = source && isAvailable(source) && (!remaining || remaining.contains(source))
          ? source : remaining ? focusableIn(remaining)[0] || remaining : focusableIn(document)[0];
        target?.focus({ preventScroll: true });
      });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={() => { if (openDialogs.at(-1) === contentRef.current) onClose(); }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || '對話視窗'}
        tabIndex={-1}
        onClick={event => event.stopPropagation()}
        className={`w-full bg-surface-card border border-surface-line rounded-modal max-h-[85vh] overflow-hidden outline-none flex flex-col ${maxWidth}`}
      >
        {/* overflow-y-auto 放內層、圓角+overflow-hidden 留外層——scrollbar 是矩形，
            跟 border-radius 同一層會蓋住右上/右下角，看起來像沒切到圓角（T7 B6） */}
        <div className="p-6 overflow-y-auto min-h-0">
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
    </div>
  );
};

export default Modal;
