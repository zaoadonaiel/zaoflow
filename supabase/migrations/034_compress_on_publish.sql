-- Per-article opt-out for the compress-before-publish step.
--
-- The publish path shrinks the featured image to <= 1 MB before it goes to
-- WordPress or the Node.js site, so the site does not pay the pageload cost
-- of an unshrunken AI-generated image. A handful of posts want the full
-- resolution (print-quality campaign shots, mostly), so the column is a
-- toggle in the article form rather than a global setting.
--
-- Default true so the person who queues a post and walks away gets the
-- compressed version by default -- opting *in* to the smaller image is the
-- shape everyone actually wants; opting out is the exception.
alter table articles
  add column if not exists compress_on_publish boolean not null default true;
