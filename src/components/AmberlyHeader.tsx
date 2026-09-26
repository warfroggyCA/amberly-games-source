import type { ReactNode } from "react";
import { BrandWordmark } from "./BrandWordmark";
import { TabletopIcon } from "./TabletopIcon";

export function AmberlyHeader({
  className = "site-header",
  homeHref = "/family",
  onHome,
  onMenu,
  menuOpen,
  menuLabel = "Open Amberly menu",
  children,
}: {
  className?: string;
  homeHref?: string;
  onHome: () => void;
  onMenu: () => void;
  menuOpen?: boolean;
  menuLabel?: string;
  children?: ReactNode;
}) {
  return (
    <header className={className}>
      <button
        className="tabletop-tool tabletop-menu-button"
        onClick={onMenu}
        aria-label={menuLabel}
        title="Amberly menu"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
      >
        <TabletopIcon name="menu" />
      </button>
      <a
        className="brand"
        href={homeHref}
        aria-label="Amberly Games — Home"
        onClick={(event) => {
          event.preventDefault();
          onHome();
        }}
      >
        <BrandWordmark />
      </a>
      {children}
    </header>
  );
}

export function AmberlyNavigation({
  onNavigate,
  current,
  variant = "menu",
}: {
  onNavigate: (path: string) => void;
  current?: string;
  variant?: "menu" | "tabs";
}) {
  return (
    <nav
      className={variant === "tabs" ? "hub-navigation" : "game-menu-nav"}
      aria-label="Amberly Games"
    >
      {(
        [
          ["/family", "Games", "home"],
          ["/family/history", "History", "history"],
          ["/family/players", "Players", "players"],
          ["/family/settings", "Settings", "settings"],
        ] as const
      ).map(([path, label, icon]) => (
        <button
          key={path}
          className={variant === "menu" ? "button light" : undefined}
          aria-current={current === path ? "page" : undefined}
          onClick={() => onNavigate(path)}
        >
          {variant === "menu" && <TabletopIcon name={icon} />}
          {label}
        </button>
      ))}
    </nav>
  );
}
