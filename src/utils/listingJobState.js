const STALE_PROCESSING_MS = 30 * 60 * 1000;
function listingItemStatus(row, now = Date.now()) {
  if (row.status !== 'processing') return row.status;
  const started = Date.parse(row.brief?.listingAttemptStartedAt || row.created_at);
  return Number.isFinite(started) && now - started > STALE_PROCESSING_MS ? 'failed' : 'processing';
}
module.exports = { listingItemStatus, STALE_PROCESSING_MS };
