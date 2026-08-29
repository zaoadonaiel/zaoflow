-- Somewhere for the alt description to land.
--
-- The image panel has always had an Alt description box, and the publish path
-- has always read articles.featured_image_alt to send to WordPress -- but the
-- column was never added. So the box was write-only: what you typed lasted
-- until the page was closed, the save dropped it on purpose, and every
-- featured image went up with no alt text at all.
--
-- It matters more now that an image can be reused from the library: a picture
-- generated for one article arrives describing that article, and the
-- correction has to survive the save.
alter table articles
  add column if not exists featured_image_alt text;
