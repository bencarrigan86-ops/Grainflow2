-- Cotton is valued as lint, seed and ginning. These are the commodity's settings for the seed and the ginning:
-- the seed price ($/t), the seed per bale (t), and the ginning and levies ($/bale). Safe to run more than once.
alter table commodities add column if not exists cotton jsonb;

notify pgrst, 'reload schema';
