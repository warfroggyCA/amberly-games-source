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
}: {
  onNavigate: (path: string) => void;
  current?: string;
}) {
  return (
    <nav className="game-menu-nav" aria-label="Amberly Games">
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
          className="button light"
          aria-current={current === path ? "page" : undefined}
          onClick={() => onNavigate(path)}
        >
          <TabletopIcon name={icon} />
          {label}
        </button>
      ))}
    </nav>
  );
}
