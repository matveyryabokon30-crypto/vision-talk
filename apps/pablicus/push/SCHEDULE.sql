-- Apply only after schema + Edge deployment have passed review.
SELECT cron.schedule('pablicus-push-retry','* * * * *','SELECT pablicus_push_private.maintenance()');
-- Initialize server keys through the authenticated worker after deployment.
-- A newly installed outbox is empty, so this does not notify any person.
SELECT pablicus_push_private.kick();
