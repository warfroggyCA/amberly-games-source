import type { CrokinoleScoringMode } from "../../domain/crokinole";
export function CrokinoleRules({ mode }: { mode: CrokinoleScoringMode }) {
  const guides: Record<
    CrokinoleScoringMode,
    { title: string; paragraphs: string[] }
  > = {
    net_winner_only: {
      title: "Net score — winner only",
      paragraphs: [
        "Use this when your table has already cancelled overlapping points or pieces. Enter only the points awarded to the remaining winner. All other players or teams start at zero. The app adds the entered points directly; it does not subtract again.",
        "Example: after cancelling pieces, Erin has 25 points left. Enter 25 for Erin and leave everyone else at 0. Only Erin gains 25 match points. If nobody scores, save everyone at 0. More than one positive score is not allowed in this method.",
        "Your family decides how to cancel pieces in individual play. This method records that agreed result rather than imposing a highest-minus-runner-up calculation. It supports singles, doubles and three- or four-player family individual play.",
      ],
    },
    traditional_differential: {
      title: "Traditional Difference",
      paragraphs: [
        "For two opposing sides: singles or doubles. Enter both sides’ full raw round totals, including pocketed 20s. The app subtracts the lower total from the higher. Only the winning side receives the difference; a tie awards zero to both.",
        "Example: 65 against 40 awards 25–0. Do not subtract on the board and then enter both raw and net values. A customary traditional target is 100; you can choose 300 or another positive multiple of five.",
      ],
    },
    cumulative_round_totals: {
      title: "Cumulative Round Totals",
      paragraphs: [
        "A family variation in which every player or team keeps all of its raw round points. Enter each completed total, including 20s. There is no cancellation or subtraction. This is not tournament scoring.",
        "Example: totals of 65, 40, 30 and 15 add those same amounts to the four match scores. Use singles, doubles or family individual play.",
      ],
    },
    nca_match_points: {
      title: "NCA-style Match Points",
      paragraphs: [
        "For singles or doubles with two opposing sides. Enter both raw totals, including 20s. A higher total earns 2 match points, a loss earns 0, and a tied round earns 1 each. The size of the winning margin does not change the award.",
        "Example: 65–40 awards 2–0; 45–45 awards 1–1. Choose four fixed rounds or first to 5, 7, 9 or 11 match points. This scorer retains a tied result; tournament-specific playoffs are not added automatically.",
      ],
    },
  };
  return (
    <details className="crokinole-options">
      <summary>Rules & scoring explained</summary>
      <h3>{guides[mode].title}</h3>
      {guides[mode].paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <h3>How the game ends</h3>
      <p>
        For a target game, finish and save the whole round. Reaching or passing
        the target ends the game; an exact finish is not required. If several
        players reach it together, the highest total wins. Equal highest totals
        share a tie. Fixed-round games finish after the selected number of saved
        rounds, with the highest total winning or equal leaders sharing a tie.
      </p>
      <h3>Players, teams and rounds</h3>
      <p>
        Singles has two players. Doubles has two teams of two, with partners
        seated opposite; enter one score per team. Family Free-for-All has three
        or four independent players and is a house-rule format. Finish
        everyone’s shots before recording a round. The app rotates the starting
        player clockwise each round; correcting scores does not alter that
        sequence.
      </p>
      <h3>Counting and corrections</h3>
      <p>
        When counting raw totals, include pocketed 20s and discs in the 15, 10
        and 5 rings. A disc touching a dividing line uses the lower value. Enter
        non-negative multiples of five. Open a saved round to correct it, or
        undo the last round. Match totals are recalculated from the saved
        rounds.
      </p>
      <p>
        Choose the method in Game options before starting. Family defaults apply
        only to new games; a rematch keeps the previous game’s settings.
      </p>
      <p>
        <a
          href="https://worldcrokinole.com/thegame.html"
          target="_blank"
          rel="noreferrer"
        >
          Tournament playing rules ↗
        </a>
        {" · "}
        <a
          href="https://crokinole.ca/blogs/news/new-4-player-variant-crokinole-rules"
          target="_blank"
          rel="noreferrer"
        >
          An alternative four-player variant ↗
        </a>
      </p>
    </details>
  );
}
