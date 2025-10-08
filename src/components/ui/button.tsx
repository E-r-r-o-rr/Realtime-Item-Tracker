import * as React from 'react';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline';
}

/**
 * A simple button component styled with Tailwind CSS. This is a lightweight
 * stand‑in for shadcn/ui's Button component. It accepts standard button
 * attributes, along with a `variant` prop to adjust styling.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'default', disabled, ...props }, ref) => {
    let baseStyles =
      'relative inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold transition duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:cursor-not-allowed disabled:opacity-60';
    let variantStyles = '';
    switch (variant) {
      case 'secondary':
        variantStyles =
          'bg-slate-800/80 text-slate-100 hover:-translate-y-0.5 hover:bg-slate-700/80 hover:shadow-[0_20px_35px_rgba(15,23,42,0.45)]';
        break;
      case 'outline':
        variantStyles =
          'border border-indigo-400/50 bg-transparent text-indigo-200 hover:-translate-y-0.5 hover:bg-indigo-500/10 hover:text-white hover:shadow-[0_18px_40px_rgba(99,102,241,0.25)]';
        break;
      default:
        variantStyles =
          'bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 text-white shadow-[0_18px_40px_rgba(129,140,248,0.35)] transition-transform hover:-translate-y-0.5 hover:shadow-[0_25px_55px_rgba(129,140,248,0.4)]';
        break;
    }
    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variantStyles} ${className}`}
        disabled={disabled}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';