import React from 'react';
import { X } from 'lucide-react';
import Button from './Button';

interface BannerProps {
  variant: 'error' | 'info';
  onDismiss: () => void;
  onRetry?: () => void;
  children: React.ReactNode;
}

const variantClasses: Record<BannerProps['variant'], string> = {
  error: 'bg-warn/10 border border-warn/40 text-warn',
  info: 'bg-accent/10 border border-accent/40 text-slate-200',
};

const Banner: React.FC<BannerProps> = ({ variant, onDismiss, onRetry, children }) => (
  <div className={`rounded-ctl px-4 py-3 flex items-center gap-3 ${variantClasses[variant]}`}>
    <div className="flex-1 text-sm">{children}</div>
    {onRetry && (
      <Button variant="ghost" size="sm" onClick={onRetry}>
        重試
      </Button>
    )}
    <button
      type="button"
      onClick={onDismiss}
      aria-label="關閉"
      className="w-8 h-8 inline-flex items-center justify-center rounded-ctl hover:bg-white/10 transition-colors"
    >
      <X size={16} />
    </button>
  </div>
);

export default Banner;
