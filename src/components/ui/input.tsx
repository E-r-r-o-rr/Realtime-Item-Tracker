import * as React from 'react';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * A minimal input component. This wrapper provides consistent styling for
 * forms, including focus ring and disabled states. Additional props are
 * forwarded to the native `<input>` element.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...props }, ref) => {
    const baseStyles =
      'block w-full rounded-md border border-[var(--color-borderColor)] bg-[var(--color-backgroundSecondary)] px-3 py-2 text-sm text-[var(--color-textPrimary)] placeholder-[var(--color-textSecondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]';
    return (
      <input
        ref={ref}
        className={`${baseStyles} ${className}`}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';