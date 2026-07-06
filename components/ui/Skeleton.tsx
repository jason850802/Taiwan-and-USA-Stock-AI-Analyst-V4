import React from 'react';

interface SkeletonProps {
  variant?: 'card' | 'lines';
  lines?: number;
  className?: string;
}

const lineWidths = ['w-[92%]', 'w-full', 'w-[84%]', 'w-[70%]'];

const Skeleton: React.FC<SkeletonProps> = ({ variant = 'card', lines = 4, className = '' }) => {
  if (variant === 'lines') {
    return (
      <div className={`animate-pulse space-y-3 ${className}`}>
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className={`h-3 bg-surface-inset rounded ${lineWidths[index % lineWidths.length]}`}
          />
        ))}
      </div>
    );
  }

  return <div className={`animate-pulse bg-surface-inset rounded-card h-32 ${className}`} />;
};

export default Skeleton;
