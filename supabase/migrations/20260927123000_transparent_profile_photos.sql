-- Widen the existing bounded photo format constraint; preserve all saved JPEGs.
-- Runtime decoding still enforces a single image of at most 256 x 256 pixels.
begin;
set local lock_timeout = '5s';
alter table scrabble.players drop constraint if exists players_photo_data_url_check;
alter table scrabble.players add constraint players_photo_data_url_check check (
  char_length(photo_data_url) <= 273091
  and (photo_data_url like 'data:image/jpeg;base64,%'
       or photo_data_url like 'data:image/png;base64,%')
);
commit;
