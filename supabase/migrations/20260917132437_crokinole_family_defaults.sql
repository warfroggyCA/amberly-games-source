alter table scrabble.crokinole_palette add column defaults jsonb check (defaults is null or jsonb_typeof(defaults) = 'object');
