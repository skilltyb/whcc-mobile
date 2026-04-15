// ════════════════════════════════════════════════════════════════════════════
// WHCC Mobile App — Google Apps Script Backend  (Code.gs)
// Deploy as: Web App → Execute as: Me → Who has access: Anyone
//
// SETUP: Set SS_ID below to your Google Spreadsheet ID.
// Required sheets (auto-created on first use):
//   Members · Registrations · Dining Reservations · League Regs · Photos
// Ops data + conditions + tee sheets stored in Script Properties (no sheet
// needed — avoids quota limits for high-frequency writes).
// ════════════════════════════════════════════════════════════════════════════

var SS_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ← replace with your Sheet ID

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getSheet(name) {
  var ss = SpreadsheetApp.openById(SS_ID);
  var s  = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  return s;
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function props() {
  return PropertiesService.getScriptProperties();
}

// ─── doGet ───────────────────────────────────────────────────────────────────

function doGet(e) {
  var p = e.parameter || {};
  try {
    switch (p.action) {
      case 'validate-login':   return json(validateLogin(p.email, p.pin));
      case 'counts':           return json(getCounts());
      case 'get-regs':         return json(getRegs());
      case 'get-live-scoring': return json(getLiveScoring());
      case 'get-teesheets':    return json(getTeeSheets(p.event));
      case 'get-members':      return json(getMembers());
      case 'get-ops-data':     return json(getOpsData(p.key));
      case 'get-all-ops':      return json(getAllOps());
      case 'get-dining':       return json(getDining());
      case 'get-conditions':   return json(getConditions());
      case 'verify-member':    return json(verifyMember(p.memberNum, p.last));
      case 'get-photos':       return json(getPhotos());
      default:                 return json({ error: 'unknown action: ' + (p.action || '(none)') });
    }
  } catch (err) {
    return json({ error: err.toString() });
  }
}

// ─── doPost ──────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action || 'save-reg';
    switch (action) {
      case 'delete':             return json(deleteReg(body.id));
      case 'save-teesheet':      return json(saveTeeSheet(body));
      case 'save-scores':        return json(saveScores(body));
      case 'save-ops-data':      return json(saveOpsData(body.key, body.data));
      case 'save-conditions':    return json(saveConditions(body.data));
      case 'dining-reservation': return json(saveDiningRes(body));
      case 'send-dining-confirm':return json(sendDiningConfirm(body));
      case 'create-pin':         return json(createPin(body.email, body.memberNum, body.pin));
      case 'save-league-reg':    return json(saveLeagueReg(body.data));
      case 'save-reg':
      default:                   return json(saveReg(body));
    }
  } catch (err) {
    return json({ ok: false, error: err.toString() });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET ?action=validate-login&email=...&pin=...
 * Returns { ok, account: { name, role, membership, handicap, memberNumber } }
 * Members sheet columns: Member # | First Name | Last Name | Name | Email |
 *   PIN | Role | Membership | Handicap
 */
function validateLogin(email, pin) {
  if (!email || !pin) return { ok: false, error: 'missing credentials' };
  var sheet = getSheet('Members');
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: false, error: 'no members configured' };
  var hdr  = data[0].map(function(h) { return String(h).trim(); });
  var col  = makeColMap(hdr);
  var emailLower = email.trim().toLowerCase();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (str(row, col['Email']).toLowerCase() === emailLower &&
        str(row, col['PIN']) === String(pin).trim()) {
      var name = str(row, col['Name']) ||
        [str(row, col['First Name']), str(row, col['Last Name'])].filter(Boolean).join(' ');
      return {
        ok:      true,
        account: {
          name:         name,
          role:         str(row, col['Role']) || 'member',
          membership:   str(row, col['Membership']),
          handicap:     num(row, col['Handicap']),
          memberNumber: str(row, col['Member #'])
        }
      };
    }
  }
  return { ok: false, error: 'invalid credentials' };
}

/**
 * GET ?action=verify-member&memberNum=...&last=...
 * Returns { ok, name, membership, handicap } or { ok: false, error }
 */
function verifyMember(memberNum, last) {
  if (!memberNum || !last) return { ok: false, error: 'missing fields' };
  var sheet = getSheet('Members');
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return { ok: false, error: 'no member records' };
  var hdr  = data[0].map(function(h) { return String(h).trim(); });
  var col  = makeColMap(hdr);
  var numStr  = String(memberNum).trim();
  var lastStr = String(last).trim().toLowerCase();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (str(row, col['Member #']) === numStr) {
      var rowLast = str(row, col['Last Name']).toLowerCase();
      if (!rowLast || rowLast.indexOf(lastStr) === 0) {
        var name = str(row, col['Name']) ||
          [str(row, col['First Name']), str(row, col['Last Name'])].filter(Boolean).join(' ');
        return { ok: true, name: name,
          membership: str(row, col['Membership']),
          handicap:   num(row, col['Handicap']) };
      }
      return { ok: false, error: 'Last name does not match our records.' };
    }
  }
  return { ok: false, error: 'Member number not found.' };
}

/**
 * POST { action: 'create-pin', email, memberNum, pin }
 * Writes email + PIN to Members sheet; creates row if needed.
 * Returns { ok } or { ok: false, error }
 */
function createPin(email, memberNum, pin) {
  if (!email || !memberNum || !pin) return { ok: false, error: 'missing fields' };
  if (!/^\d{4}$/.test(String(pin))) return { ok: false, error: 'PIN must be 4 digits' };
  var sheet = getSheet('Members');
  var data  = sheet.getDataRange().getValues();
  var hdr   = data[0].map(function(h) { return String(h).trim(); });
  var col   = makeColMap(hdr);
  var numStr = String(memberNum).trim();

  for (var i = 1; i < data.length; i++) {
    if (str(data[i], col['Member #']) === numStr) {
      sheet.getRange(i + 1, col['Email'] + 1).setValue(email.trim().toLowerCase());
      sheet.getRange(i + 1, col['PIN'] + 1).setValue(String(pin));
      return { ok: true };
    }
  }
  return { ok: false, error: 'Member not found — contact the Pro Shop.' };
}

// ════════════════════════════════════════════════════════════════════════════
// MEMBERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET ?action=get-members
 * Returns array of member objects (PIN column excluded).
 */
function getMembers() {
  var sheet = getSheet('Members');
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var hdr  = data[0].map(function(h) { return String(h).trim(); });
  return data.slice(1).map(function(row) {
    var obj = {};
    hdr.forEach(function(h, j) {
      if (h && h !== 'PIN') obj[h] = row[j]; // never expose PINs
    });
    return obj;
  }).filter(function(r) { return r['Member #'] || r['Email']; });
}

// ════════════════════════════════════════════════════════════════════════════
// REGISTRATIONS
// ════════════════════════════════════════════════════════════════════════════

var REG_COLS = ['ID','Event','Event Date/Time','First Name','Last Name','Email',
                'Phone','Partner/Team','Players','Member #','GHIN','Notes',
                'Registered At','Source'];

/**
 * GET ?action=get-regs
 * Returns all registration rows as array of objects.
 */
function getRegs() {
  var sheet = ensureHeaders(getSheet('Registrations'), REG_COLS);
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var hdr = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    hdr.forEach(function(h, j) { obj[String(h)] = row[j]; });
    return obj;
  }).filter(function(r) { return r['First Name'] || r['Last Name']; });
}

/**
 * GET ?action=counts
 * Returns { eventTitle: registrantCount } from Registrations sheet.
 */
function getCounts() {
  var sheet = getSheet('Registrations');
  var data  = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  var hdr      = data[0].map(function(h) { return String(h).trim(); });
  var col      = makeColMap(hdr);
  var eventIdx = col['Event'];
  var counts   = {};
  for (var i = 1; i < data.length; i++) {
    var ev = String(data[i][eventIdx] || '').trim();
    if (ev) counts[ev] = (counts[ev] || 0) + 1;
  }
  return counts;
}

/**
 * POST { ...regFields } (no action key, or action='save-reg')
 * Appends a new registration row.
 */
function saveReg(body) {
  var sheet = ensureHeaders(getSheet('Registrations'), REG_COLS);
  var hdr   = sheet.getRange(1, 1, 1, REG_COLS.length).getValues()[0];
  var id    = body.id || String(Date.now());
  var row   = hdr.map(function(col) {
    var map = {
      'ID':              id,
      'Event':           body.event     || '',
      'Event Date/Time': body.eventMeta || '',
      'First Name':      body.firstName || '',
      'Last Name':       body.lastName  || '',
      'Email':           body.email     || '',
      'Phone':           body.phone     || '',
      'Partner/Team':    body.partner   || '',
      'Players':         body.players   || '1',
      'Member #':        body.memberNum || '',
      'GHIN':            body.ghin      || '',
      'Notes':           body.notes     || '',
      'Registered At':   body.timestamp || new Date().toISOString(),
      'Source':          body.source    || 'mobile'
    };
    return map[String(col)] !== undefined ? map[String(col)] : '';
  });
  sheet.appendRow(row);
  return { ok: true, id: id };
}

/**
 * POST { action: 'delete', id }
 * Removes the registration row with the matching ID.
 */
function deleteReg(id) {
  if (!id) return { ok: false, error: 'no id' };
  var sheet = getSheet('Registrations');
  var data  = sheet.getDataRange().getValues();
  var hdr   = data[0].map(function(h) { return String(h).trim(); });
  var idIdx = hdr.indexOf('ID');
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idIdx]).trim() === String(id).trim()) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'registration not found' };
}

// ════════════════════════════════════════════════════════════════════════════
// TEE SHEETS  (stored in Script Properties — fast R/W, no sheet quota hit)
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET ?action=get-teesheets[&event=...]
 * Returns tee sheet(s). If event param present, returns that event's object;
 * otherwise returns the full { eventName: { round: {date,config,groups} } } map.
 */
function getTeeSheets(event) {
  var raw = props().getProperty('teesheets');
  var all = raw ? JSON.parse(raw) : {};
  return event ? (all[event] || null) : all;
}

/**
 * POST { action:'save-teesheet', event, round, date, config, groups }
 */
function saveTeeSheet(body) {
  var raw = props().getProperty('teesheets');
  var all = raw ? JSON.parse(raw) : {};
  if (!all[body.event]) all[body.event] = {};
  all[body.event][body.round] = {
    date:   body.date,
    config: body.config,
    groups: body.groups
  };
  props().setProperty('teesheets', JSON.stringify(all));
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE SCORING
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET ?action=get-live-scoring
 * Returns array of { event, round, scores, updated }.
 */
function getLiveScoring() {
  var raw = props().getProperty('live_scores');
  return raw ? JSON.parse(raw) : [];
}

/**
 * POST { action:'save-scores', event, round, scores }
 * Upserts scores for this event+round.
 */
function saveScores(body) {
  var raw = props().getProperty('live_scores');
  var all = raw ? JSON.parse(raw) : [];
  all = all.filter(function(s) {
    return !(s.event === body.event && s.round === body.round);
  });
  all.push({
    event:   body.event,
    round:   body.round,
    scores:  body.scores,
    updated: new Date().toISOString()
  });
  props().setProperty('live_scores', JSON.stringify(all));
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// OPS DATA  (key/value store in Script Properties)
// All live-ops state lives here: pool, grounds, staff msgs, incidents, etc.
// The app calls fetchAllOps() on staff login to hydrate all localStorage keys.
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET ?action=get-ops-data&key=pool_status
 * Returns the stored value for the given key (parsed JSON), or null.
 */
function getOpsData(key) {
  if (!key) return null;
  var raw = props().getProperty('ops_' + key);
  return raw ? JSON.parse(raw) : null;
}

/**
 * POST { action:'save-ops-data', key, data }
 * Persists any ops state object under its key.
 */
function saveOpsData(key, data) {
  if (!key) return { ok: false, error: 'no key' };
  props().setProperty('ops_' + key, JSON.stringify(data));
  return { ok: true };
}

/**
 * GET ?action=get-all-ops
 * Returns all tracked ops keys in one object for bulk hydration on login.
 * Keys match the keyMap in WHCC_SYNC.fetchAllOps().
 */
function getAllOps() {
  var keys = [
    'pool_guests', 'pool_chem',   'work_orders', 'spray_log',
    'staff_messages', 'lost_found', 'incidents',  'dining_res',
    'partners',    'pool_status', 'hole_status', 'on_course'
  ];
  var result = {};
  var p = props();
  keys.forEach(function(k) {
    var raw = p.getProperty('ops_' + k);
    result[k] = raw ? JSON.parse(raw) : null;
  });
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// COURSE CONDITIONS
// ════════════════════════════════════════════════════════════════════════════

var CONDITIONS_DEFAULT = {
  courseOpens:  '9:00 AM',
  cartRules:    'Off Path',
  rangeStatus:  'Open — Mats Only',
  rangeHours:   '',
  puttingGreen: '',
  proShop:      '',
  notice:       ''
};

/**
 * GET ?action=get-conditions
 * Returns the current conditions object.
 */
function getConditions() {
  var raw = props().getProperty('conditions');
  return raw ? JSON.parse(raw) : CONDITIONS_DEFAULT;
}

/**
 * POST { action:'save-conditions', data:{courseOpens, cartRules, ...} }
 */
function saveConditions(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'bad data' };
  props().setProperty('conditions', JSON.stringify(data));
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// DINING RESERVATIONS
// ════════════════════════════════════════════════════════════════════════════

var DINING_COLS = ['ID','Date','Time','Time Display','Name','Email',
                   'Party Size','Notes','Venue','Status','Source','Submitted'];

/**
 * GET ?action=get-dining
 * Returns all dining reservation rows as array of objects.
 */
function getDining() {
  var sheet = getSheet('Dining Reservations');
  if (sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues();
  var hdr  = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    hdr.forEach(function(h, j) { obj[String(h)] = row[j]; });
    return obj;
  });
}

/**
 * POST { action:'dining-reservation', id, date, time24, timeDisplay,
 *         name, email, party, note, venue, source, submitted }
 * Appends a row to Dining Reservations and also syncs to Ops Data so the
 * mobile staff portal updates in real time.
 */
function saveDiningRes(body) {
  var sheet = ensureHeaders(getSheet('Dining Reservations'), DINING_COLS);
  var hdr   = sheet.getRange(1, 1, 1, DINING_COLS.length).getValues()[0];
  var id    = body.id || String(Date.now());
  var row   = hdr.map(function(col) {
    var map = {
      'ID':           id,
      'Date':         body.date        || '',
      'Time':         body.time24      || '',
      'Time Display': body.timeDisplay || '',
      'Name':         body.name        || '',
      'Email':        body.email       || '',
      'Party Size':   body.party       || '',
      'Notes':        body.note        || '',
      'Venue':        body.venue       || 'hoovers',
      'Status':       'Pending',
      'Source':       body.source      || 'mobile',
      'Submitted':    body.submitted   || new Date().toISOString()
    };
    return map[String(col)] !== undefined ? map[String(col)] : '';
  });
  sheet.appendRow(row);

  // Also persist to ops_dining_res so fetchAllOps picks it up
  var opsRaw = props().getProperty('ops_dining_res');
  var opsList = opsRaw ? JSON.parse(opsRaw) : [];
  opsList.push({
    id:          id,
    isoDate:     body.date,
    date:        body.date,
    time24:      body.time24      || '',
    timeDisplay: body.timeDisplay || '',
    name:        body.name        || '',
    party:       body.party       || 1,
    note:        body.note        || '',
    venue:       body.venue       || 'hoovers',
    seated:      false,
    source:      body.source      || 'mobile'
  });
  props().setProperty('ops_dining_res', JSON.stringify(opsList));

  return { ok: true, id: id };
}

/**
 * POST { action:'send-dining-confirm', email, name, venue, date, time, party, note }
 * Sends a nicely formatted HTML confirmation email to the member.
 */
function sendDiningConfirm(body) {
  if (!body.email) return { ok: false, error: 'no email' };
  var subject = 'Your Reservation at ' + body.venue + ' — ' + body.date;
  var noteRow = body.note
    ? '<tr><td style="padding:8px 0;color:#666;vertical-align:top;">Special Requests</td>' +
      '<td style="text-align:right;">' + body.note + '</td></tr>'
    : '';
  var html = [
    '<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;color:#1a2b1f;border:1px solid #e8e0d4;border-radius:8px;overflow:hidden;">',
    '  <div style="background:#1a2b1f;padding:28px;text-align:center;">',
    '    <div style="font-size:1.5rem;color:#b8976a;letter-spacing:.1em;font-weight:300;">WESTWOOD HILLS</div>',
    '    <div style="font-size:.65rem;letter-spacing:.25em;color:rgba(245,240,232,.55);text-transform:uppercase;margin-top:4px;">Country Club</div>',
    '  </div>',
    '  <div style="padding:32px 28px;">',
    '    <h2 style="font-size:1.3rem;margin:0 0 6px;color:#1a2b1f;">Reservation Confirmed ✓</h2>',
    '    <p style="color:#888;margin:0 0 24px;font-size:.9rem;">Hello ' + (body.name || 'Member') + ', we look forward to seeing you.</p>',
    '    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">',
    '      <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;">Venue</td><td style="text-align:right;font-weight:700;">' + body.venue + '</td></tr>',
    '      <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;">Date</td><td style="text-align:right;font-weight:600;">' + body.date + '</td></tr>',
    '      <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;">Time</td><td style="text-align:right;font-weight:600;">' + body.time + '</td></tr>',
    '      <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#666;">Party Size</td><td style="text-align:right;font-weight:600;">' + body.party + ' ' + (body.party == 1 ? 'guest' : 'guests') + '</td></tr>',
    noteRow,
    '    </table>',
    '    <div style="background:#f5f0e8;border-radius:6px;padding:14px 16px;font-size:.82rem;color:#555;line-height:1.6;">',
    '      Need to change or cancel? Call us at <strong>(573) 785-5253</strong> or reply to this email.',
    '    </div>',
    '  </div>',
    '  <div style="background:#f5f0e8;padding:14px;text-align:center;font-size:.72rem;color:#999;border-top:1px solid #e8e0d4;">',
    '    1 Birdie Ln, Poplar Bluff, MO &nbsp;·&nbsp; (573) 785-5253 &nbsp;·&nbsp; westwoodhillscc.com',
    '  </div>',
    '</div>'
  ].join('\n');

  try {
    GmailApp.sendEmail(body.email, subject, '', {
      htmlBody: html,
      name:     'Westwood Hills CC'
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LEAGUE REGISTRATIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * POST { action:'save-league-reg', data:{league, member, email, team, notes} }
 */
function saveLeagueReg(data) {
  if (!data) return { ok: false, error: 'no data' };
  var sheet = ensureHeaders(getSheet('League Regs'),
    ['Timestamp','League','Member','Email','Team','Notes']);
  var hdr = sheet.getRange(1, 1, 1, 6).getValues()[0];
  var row = hdr.map(function(col) {
    var map = {
      'Timestamp': new Date().toISOString(),
      'League':    data.league || '',
      'Member':    data.member || data.name || '',
      'Email':     data.email  || '',
      'Team':      data.team   || '',
      'Notes':     data.notes  || ''
    };
    return map[String(col)] !== undefined ? map[String(col)] : '';
  });
  sheet.appendRow(row);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// HERO PHOTOS
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET ?action=get-photos
 * Returns [{ url: '...' }] from the Photos sheet (column "URL").
 * Add public image URLs to the Photos sheet to enable hero photo rotation.
 */
function getPhotos() {
  var sheet = getSheet('Photos');
  if (sheet.getLastRow() < 2) return [];
  var data   = sheet.getDataRange().getValues();
  var hdr    = data[0].map(function(h) { return String(h).trim(); });
  var urlIdx = hdr.indexOf('URL');
  if (urlIdx < 0) urlIdx = 0; // fallback to first column
  return data.slice(1)
    .map(function(row) { return { url: String(row[urlIdx] || '').trim() }; })
    .filter(function(p) { return p.url; });
}

// ════════════════════════════════════════════════════════════════════════════
// INTERNAL UTILITIES
// ════════════════════════════════════════════════════════════════════════════

/** Returns a { columnName: columnIndex } map for a header row. */
function makeColMap(hdr) {
  var map = {};
  hdr.forEach(function(h, i) { if (h) map[h] = i; });
  return map;
}

/** Safe string from row cell (never null/undefined). */
function str(row, idx) {
  return idx !== undefined && idx >= 0 ? String(row[idx] || '').trim() : '';
}

/** Safe number from row cell. */
function num(row, idx) {
  if (idx === undefined || idx < 0) return 0;
  var v = parseFloat(row[idx]);
  return isNaN(v) ? 0 : v;
}

/**
 * Ensures the sheet has the given header row.
 * Writes headers if the sheet is empty; otherwise leaves existing headers intact.
 */
function ensureHeaders(sheet, cols) {
  if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
