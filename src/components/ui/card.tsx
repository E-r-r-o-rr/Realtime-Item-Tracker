import * as React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional header section to display above card content. */
  header?: React.ReactNode;
  /** Optional footer section to display below card content. */
  footer?: React.ReactNode;
}

/**
 * Card is a container component with an optional header and footer. It
 * provides a shadow, border and padding by default to separate content from
 * its surroundings. Derived from ShadCN UI design patterns but simplified
 * to avoid external dependencies.
 */
export function Card({
  header,
  footer,
  children,
  className = '',
  ...props
}: CardProps) {
  return (
    <div
      className={`glassy-panel overflow-hidden rounded-3xl ${className}`}
      {...props}
    >
      {header && <div className="border-b border-white/10 px-5 py-4 text-slate-200/90">{header}</div>}
      <div className="px-5 py-5 text-slate-100">{children}</div>
      {footer && <div className="border-t border-white/10 px-5 py-4 text-slate-300/80">{footer}</div>}
    </div>
  );
}