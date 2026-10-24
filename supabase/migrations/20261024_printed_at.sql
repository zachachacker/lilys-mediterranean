-- Auto-printing on the kitchen's Epson (2026-10-24, Kareem). printed_at is the
-- claim: the tablet sets it (only while null) BEFORE sending a ticket to the
-- printer, so a page refresh or a second device never prints the same order
-- twice. Everything already in the table counts as printed, so switching
-- auto-print on doesn't spit out the order history.
alter table orders add column if not exists printed_at timestamptz;
update orders set printed_at = now() where printed_at is null;
