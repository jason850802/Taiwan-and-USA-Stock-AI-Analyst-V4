import React from 'react';

interface BadgeProps {
  variant: 'up' | 'down' | 'ok' | 'danger' | 'warn' | 'neutral' | 'ai';
  children: React.ReactNode;
}

const variantClasses: Record<BadgeProps['variant'], string> = {
  up: 'bg-up-muted text-up',
  down: 'bg-down-muted text-down',
  ok: 'bg-ok-muted text-ok',
  danger: 'bg-danger-muted text-danger',
  warn: 'bg-warn/15 text-warn',
  neutral: 'bg-surface-inset text-slate-400',
  ai: 'bg-ai/15 text-ai',
};

const Badge: React.FC<BadgeProps> = ({ variant, children }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-ctl text-xs font-medium ${variantClasses[variant]}`}>
    {children}
  </span>
);

export default Badge;
