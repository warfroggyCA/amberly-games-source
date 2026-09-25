import Image from "next/image";
import Link from "next/link";
export function GymEntryCard({
  onOpen,
  href = "/gym-lab",
}: {
  onOpen?: () => void;
  href?: string;
}) {
  return (
    <section className="hub-game">
      <div className="hub-board-art hub-gym-art">
        <Image
          src="/gym/scarlett-lift.webp"
          alt="Scarlett lifting Scrabble weights"
          width={180}
          height={180}
          unoptimized
        />
      </div>
      <div>
        <h2>Scrabble Gym</h2>
        <p>Practice &amp; training</p>
        <p>Fresh boards, hints and coaching.</p>
        {onOpen ? (
          <button className="button primary" onClick={onOpen}>
            Open Gym
          </button>
        ) : (
          <Link className="button primary" href={href}>
            Open Gym
          </Link>
        )}
      </div>
    </section>
  );
}
