import React from 'react';

interface ButtonProps {
  variant?: 'primary' | 'ai' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  className?: string;
  children: React.ReactNode;
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent hover:bg-accent-hover text-white',
  ai: 'bg-ai hover:opacity-90 text-white',
  ghost: 'bg-transparent border border-surface-line text-slate-300 hover:bg-surface-card',
  danger: 'bg-warn/15 border border-warn/40 text-warn hover:bg-warn/25',
};

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  type = 'button',
  className = '',
  children,
}) => (
  <button
    type={type}
    disabled={disabled}
    onClick={onClick}
    className={`rounded-ctl font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
  >
    {children}
  </button>
);

export default Button;
