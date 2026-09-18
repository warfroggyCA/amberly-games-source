-- Optional display name; real names and historical game snapshots stay intact.
alter table scrabble.players add column nickname text;
alter table scrabble.players add constraint players_nickname_valid check (
  nickname is null or (length(nickname) between 1 and 60 and nickname = btrim(nickname) and nickname !~ '[[:cntrl:]]')
);
