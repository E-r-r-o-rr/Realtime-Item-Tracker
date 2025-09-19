"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "./theme-toggle";

const links = [
  { href: "/", label: "Scanner" },
  { href: "/history", label: "History" },
  { href: "/storage", label: "Storage" },
];

const baseLinkStyles =
  "inline-flex items-center px-1 pt-1 text-sm font-medium border-b-2 border-transparent transition-colors";

const activeLinkStyles = "border-blue-500 text-blue-600";
const inactiveLinkStyles = "text-gray-500 hover:text-gray-700 hover:border-gray-300";

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === href;
    }
    return pathname?.startsWith(href);
  };

  const toggleMenu = () => setMenuOpen((open) => !open);

  return (
    <header className="bg-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-gray-800">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 font-semibold">
            OS
          </span>
          <span className="text-lg font-semibold">OrderScanner Pro</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`${baseLinkStyles} ${isActive(link.href) ? activeLinkStyles : inactiveLinkStyles}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:hidden"
            onClick={toggleMenu}
            aria-label="Toggle navigation"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="border-t border-gray-200 bg-white md:hidden">
          <nav className="flex flex-col space-y-1 px-4 py-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`${baseLinkStyles} ${isActive(link.href) ? activeLinkStyles : inactiveLinkStyles}`}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

