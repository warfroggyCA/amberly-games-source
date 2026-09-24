import Link from "next/link";
import { GymEntryCard } from "./GymEntryCard";
import "./family-hub.css";
export function LocalGameChooser() {
  return (
    <div className="app-shell">
      <main className="hub-content">
        <p>AMBERLY GAMES · LOCAL PREVIEW</p>
        <h1>What are we playing?</h1>
        <div className="hub-games">
          <section className="hub-game">
            <div className="hub-board-art hub-scrabble" aria-hidden="true">
              {Array.from({ length: 49 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
            <div>
              <h2>Scrabble</h2>
              <p>Score a game on this device.</p>
              <Link href="/" className="button primary">
                Open Scrabble
              </Link>
            </div>
          </section>
          <section className="hub-game">
            <div className="hub-board-art hub-crokinole" aria-hidden="true">
              <i />
              <b />
              <span />
            </div>
            <div>
              <h2>Crokinole</h2>
              <p>
                Available through the family game hub. Family services are
                disconnected in this local preview.
              </p>
              <Link href="/family" className="button light">
                Family game hub
              </Link>
            </div>
          </section>
          <GymEntryCard />
        </div>
      </main>
    </div>
  );
}
