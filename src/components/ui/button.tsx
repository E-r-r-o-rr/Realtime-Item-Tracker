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
      'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';
    let variantStyles = '';
    switch (variant) {
      case 'secondary':
        variantStyles =
          'bg-gray-200 text-gray-900 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed';
        break;
      case 'outline':
        variantStyles =
          'border border-gray-300 text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed';
        break;
      default:
        variantStyles =
          'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed';
        break;
    }
    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variantStyles} ${className} px-4 py-2`}
        disabled={disabled}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';