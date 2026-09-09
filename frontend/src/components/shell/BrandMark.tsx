export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 62 24"
      className={className}
      role="img"
      aria-label="XNET"
    >
      <circle cx="12" cy="12" r="11" fill="#203864" />
      <circle cx="24" cy="12" r="11" fill="#2e5496" />
      <circle cx="36" cy="12" r="11" fill="#3f6bb0" />
      <circle cx="48" cy="12" r="11" fill="#668bce" />
    </svg>
  );
}
