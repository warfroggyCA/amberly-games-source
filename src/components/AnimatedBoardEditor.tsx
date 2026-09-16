"use client";
import { useRef, type ComponentProps } from "react";
import { BoardEditor } from "./BoardEditor";
import { TurnAnimation, useTurnPlayback } from "./TurnAnimation";

/** Keeps turn detection mounted while each saved revision resets draft entry. */
export function AnimatedBoardEditor(props: ComponentProps<typeof BoardEditor>) {
  const root = useRef<HTMLDivElement>(null);
  const playback = useTurnPlayback(props.game);
  return (
    <div className="animated-board-editor" ref={root}>
      <BoardEditor
        {...props}
        key={`${props.game.id}-${props.game.revision}`}
        displayScores={playback.scores}
        displayTurns={playback.turns}
        displayCurrentPlayerId={playback.currentPlayerId}
      />
      <TurnAnimation
        turn={playback.turn}
        containerRef={root}
        onScore={playback.revealScore}
        onComplete={playback.finish}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {playback.turn
          ? `${props.game.players.find((p) => p.id === playback.turn?.playerId)?.name ?? "Player"} played ${playback.turn.words.map((w) => w.word).join(" and ")} for ${playback.turn.score} points.`
          : ""}
      </span>
    </div>
  );
}
