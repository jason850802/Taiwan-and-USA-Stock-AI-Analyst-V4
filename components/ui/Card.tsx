import React from 'react';

interface CardProps {
  title?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({ title, actions, className = '', children }) => (
  <div className={`bg-surface-card border border-surface-line rounded-card p-4 ${className}`}>
    {title && (
      <div className="flex items-center justify-between gap-3 border-b border-surface-line pb-3 mb-4">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    )}
    {children}
  </div>
);

export default Card;
