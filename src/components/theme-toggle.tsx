"use client";

import * as React from 'react';
import { Button } from './ui/button';

/**
 * ThemeToggle provides a simple button that toggles between light and dark
 * themes. It stores the choice in localStorage and updates the `html` root
 * class accordingly. This component must run on the client, so be sure to
 * include the `"use client"` directive at the top of the file.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = React.useState(false);
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light');

  React.useEffect(() => {
    // On mount, read the initial theme from localStorage or media query.
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('theme') : null;
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      document.documentElement.classList.toggle('dark', stored === 'dark');
    } else if (typeof window !== 'undefined') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', prefersDark);
    }
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('theme', next);
    }
    document.documentElement.classList.toggle('dark', next === 'dark');
  };

  if (!mounted) return null;

  return (
    <Button className='hover:cursor-pointer' type="button" onClick={toggle} variant="secondary">
      {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
    </Button>
  );
}