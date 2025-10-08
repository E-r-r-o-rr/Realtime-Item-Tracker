"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/", label: "Scanner" },
  { href: "/history", label: "History" },
  { href: "/storage", label: "Storage" },
];

const baseLinkStyles =
  "relative inline-flex items-center px-1 pt-1 text-sm font-medium transition-colors after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-full after:origin-left after:scale-x-0 after:bg-gradient-to-r after:from-indigo-400 after:to-fuchsia-500 after:transition-transform after:duration-300";

const activeLinkStyles =
  "text-slate-100 after:scale-x-100";
const inactiveLinkStyles =
  "text-slate-300/70 hover:text-slate-100 hover:after:scale-x-100";

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
    <header className="relative z-20 border-b border-white/10 bg-slate-900/50 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 text-lg font-semibold text-white shadow-lg shadow-indigo-900/40 transition-transform group-hover:scale-105">
            RT
          </span>
          <span className="text-lg font-semibold text-slate-100">
            Realtime Item Tracker
          </span>
        </Link>
        <nav className="hidden items-center gap-10 md:flex">
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
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 md:hidden"
          onClick={toggleMenu}
          aria-label="Toggle navigation"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>
      {menuOpen && (
        <div className="border-t border-white/10 bg-slate-900/70 backdrop-blur-xl md:hidden">
          <nav className="flex flex-col space-y-1 px-4 py-4">
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

