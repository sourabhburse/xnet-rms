import { cn } from "@/lib/utils";

export type BrandMarkVariant = "light" | "dark" | "responsive";

interface BrandMarkProps {
  className?: string;
  variant?: BrandMarkVariant;
  alt?: string;
}

const lightLogo = "/logo/svg/xnet-logo.svg";
const darkLogo = "/logo/svg/xnet-logo-dark.svg";

export function BrandMark({
  className,
  variant = "responsive",
  alt = "XNET",
}: BrandMarkProps) {
  if (variant === "light" || variant === "dark") {
    return (
      <img
        src={variant === "dark" ? darkLogo : lightLogo}
        className={cn("block object-contain", className)}
        alt={alt}
      />
    );
  }

  return (
    <>
      <img
        src={lightLogo}
        className={cn("block object-contain dark:hidden", className)}
        alt={alt}
      />
      <img
        src={darkLogo}
        className={cn("hidden object-contain dark:block", className)}
        alt=""
        aria-hidden="true"
      />
    </>
  );
}
