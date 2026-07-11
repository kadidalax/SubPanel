/** Aggregate 3→1 then distribute 1→3 */
export function BrandMark({ className = "brand-mark", title = "Sub Panel" }: { className?: string; title?: string }) {
  return (
    <span className={className} title={title} aria-hidden={title ? undefined : true}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="4" cy="6" r="1.75" fill="currentColor" opacity="0.95" />
        <circle cx="4" cy="12" r="1.75" fill="currentColor" opacity="0.95" />
        <circle cx="4" cy="18" r="1.75" fill="currentColor" opacity="0.95" />
        <path d="M5.9 6.3 10 11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
        <path d="M5.9 12H10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
        <path d="M5.9 17.7 10 13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
        <circle cx="12" cy="12" r="2.6" fill="currentColor" />
        <path d="M14 11 18.1 6.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
        <path d="M14 12H18.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
        <path d="M14 13 18.1 17.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.75" />
        <circle cx="20" cy="6" r="1.75" fill="currentColor" opacity="0.95" />
        <circle cx="20" cy="12" r="1.75" fill="currentColor" opacity="0.95" />
        <circle cx="20" cy="18" r="1.75" fill="currentColor" opacity="0.95" />
      </svg>
    </span>
  );
}
