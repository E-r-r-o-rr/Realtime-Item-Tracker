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
      className={`rounded-lg border border-[var(--color-borderColor)] bg-[var(--color-backgroundSecondary)] shadow-sm overflow-hidden ${className}`}
      {...props}
    >
      {header && <div className="px-4 py-2 border-b border-[var(--color-borderColor)]">{header}</div>}
      <div className="px-4 py-2">{children}</div>
      {footer && <div className="px-4 py-2 border-t border-[var(--color-borderColor)]">{footer}</div>}
    </div>
  );
}