import type { ReactNode } from "react";
import Link from "next/link";
import { BrandWordmark } from "./BrandWordmark";
import "./family-access.css";

/** Shared entry surface for sign-in, connection, and recovery screens. */
export function FamilyWelcome({
  title,
  loading = false,
  children,
}: {
  title: string;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="family-access">
      <div className="family-access-shell">
        <header className="family-access-header">
          <Link
            href="/"
            className="brand family-access-brand"
            aria-label="Amberly Games home"
          >
            <BrandWordmark />
          </Link>
        </header>
        <section
          className="family-access-card"
          aria-labelledby="family-access-title"
        >
          <div
            className={`family-welcome-rack${loading ? " is-loading" : ""}`}
            aria-hidden="true"
          >
            {[
              ["P", 3],
              ["L", 1],
              ["A", 1],
              ["Y", 4],
            ].map(([letter, points]) => (
              <span className="family-welcome-tile" key={letter}>
                <b>{letter}</b>
                <small>{points}</small>
              </span>
            ))}
          </div>
          <span className="family-welcome-caption">
            A little friendly competition
          </span>
          <h1 id="family-access-title">{title}</h1>
          <div className="family-access-body">{children}</div>
        </section>
        <footer className="family-access-footer">
          <Link href="/" className="family-access-back">
            ← Games on this device
          </Link>
        </footer>
      </div>
    </main>
  );
}
