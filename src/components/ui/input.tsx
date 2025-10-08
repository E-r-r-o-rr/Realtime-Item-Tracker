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
      'block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-400/60';
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