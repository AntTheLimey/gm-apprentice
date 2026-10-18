'use strict';
// Headings gm-leak (vault_check.py) flags as Keeper-looking that the GM reviewed and means for players (#453). Each is
// a record in the publish list's `accepted` list, beside the leak gate's accepted findings, so one list settles every
// leak finding: `page` is the note's vault path, `text` the heading as written, `note` this marker. The leak gate
// leaves them alone; `explain --all` hands them to gm-leak, which skips a heading whose note and text both still match.
const HEADING_NOTE = 'gm-leak.heading';
const isSettledHeading = (a) => Boolean(a) && a.note === HEADING_NOTE;
const settledHeadingsOf = (list) => ((list && list.accepted) || []).filter(isSettledHeading).map((a) => ({ page: a.page, heading: a.text }));

module.exports = { HEADING_NOTE, isSettledHeading, settledHeadingsOf };
