const footerLinks = [
  {
    label: "GitHub",
    href: "https://github.com",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.69-3.87-1.54-3.87-1.54-.53-1.34-1.3-1.7-1.3-1.7-1.06-.73.08-.72.08-.72 1.17.08 1.79 1.2 1.79 1.2 1.04 1.78 2.73 1.27 3.4.97.11-.75.41-1.27.74-1.56-2.55-.29-5.23-1.27-5.23-5.68 0-1.25.45-2.27 1.19-3.07-.12-.29-.52-1.47.11-3.07 0 0 .97-.31 3.18 1.17a11 11 0 0 1 5.8 0c2.2-1.48 3.18-1.17 3.18-1.17.63 1.6.23 2.78.11 3.07.74.8 1.18 1.82 1.18 3.07 0 4.42-2.69 5.38-5.25 5.66.42.36.79 1.07.79 2.16 0 1.56-.02 2.82-.02 3.2 0 .31.21.68.8.56A10.51 10.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
      </svg>
    ),
  },
  {
    label: "Twitter",
    href: "https://twitter.com",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M21.5 6.33c-.67.3-1.39.5-2.15.6a3.78 3.78 0 0 0 1.65-2.07 7.58 7.58 0 0 1-2.4.9 3.77 3.77 0 0 0-6.5 3.43 10.7 10.7 0 0 1-7.78-3.95 3.77 3.77 0 0 0 1.16 5.02c-.6-.02-1.17-.18-1.67-.46v.05a3.77 3.77 0 0 0 3.02 3.69c-.53.14-1.08.16-1.62.06a3.77 3.77 0 0 0 3.52 2.62 7.57 7.57 0 0 1-4.68 1.61c-.3 0-.6-.02-.9-.05a10.69 10.69 0 0 0 16.47-9.03c0-.16 0-.32-.01-.47a7.61 7.61 0 0 0 1.86-1.94Z" />
      </svg>
    ),
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M4.5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-.75 5h3.5v12h-3.5v-12Zm6.25 0h3.36v1.64h.05c.47-.9 1.62-1.86 3.33-1.86 3.56 0 4.22 2.34 4.22 5.38V20.5h-3.5v-6.14c0-1.47-.03-3.37-2.06-3.37-2.07 0-2.39 1.62-2.39 3.26v6.25h-3.5v-12Z" />
      </svg>
    ),
  },
];

export function SiteFooter() {
  return (
    <footer className="relative z-20 border-t border-white/10 bg-slate-900/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-10 text-sm text-slate-300/80 sm:flex-row sm:px-6 lg:px-8">
        <p className="text-center sm:text-left">
          &copy; {new Date().getFullYear()} Realtime Item Tracker. Crafted for seamless OCR-driven logistics.
        </p>
        <div className="flex items-center gap-4 text-slate-200">
          {footerLinks.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
              aria-label={item.label}
            >
              {item.icon}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

