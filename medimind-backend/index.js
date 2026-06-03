const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'medimind',
});

db.connect((err) => {
  if (err) { console.error('Error connecting to MySQL:', err); return; }
  console.log('Connected to MySQL Database.');
});

// =============================================================================
// PROMISE WRAPPER HELPER
// =============================================================================
function dbQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

// =============================================================================
// PUSH NOTIFICATIONS via Expo
// =============================================================================
async function sendPushNotification(expoPushToken, title, body, data = {}) {
  if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken')) return;
  try {
    const payload = {
      to: expoPushToken,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      channelId: 'reminders',
    };
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (result?.data?.status === 'error') console.log('Push error:', result.data.message);
  } catch (err) {
    console.log('Push notification failed:', err.message);
  }
}

async function sendCaregiverPush(caregiverId, title, body, data = {}) {
  db.query('SELECT expo_push_token FROM users WHERE id=?', [caregiverId], async (err, rows) => {
    if (err || !rows || !rows.length || !rows[0].expo_push_token) return;
    await sendPushNotification(rows[0].expo_push_token, title, body, data);
  });
}

// =============================================================================
// HELPERS
// =============================================================================
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

function parseMeta(notesStr) {
  try {
    const p = JSON.parse(notesStr);
    if (p && Array.isArray(p.days)) return p;
  } catch (_) {}
  return null;
}

function logActivity(elderId, activityType, description) {
  db.query(
    `INSERT INTO activity_logs (elder_id, activity_type, description) VALUES (?,?,?)`,
    [elderId, activityType, description],
    (err) => { if (err) console.log('Activity log error:', err.message); }
  );
}

function notifyCaregivers(elderId, alertType, message, priority = 'medium') {
  db.query(
    `SELECT requester_id FROM connections WHERE elder_id = ? AND status = 'approved'`,
    [elderId],
    (err, caregivers) => {
      if (err || !caregivers || !caregivers.length) return;
      const vals = caregivers.map(c => [elderId, c.requester_id, alertType, message, 0, priority, new Date()]);
      db.query(
        `INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, priority, created_at) VALUES ?`,
        [vals],
        (err2) => { if (err2) console.log('Alert error:', err2.message); }
      );
      caregivers.forEach(c => {
        sendCaregiverPush(
          c.requester_id,
          alertType === 'overdue' ? '⚠️ Overdue Task' : '📊 Health Update',
          message
        );
      });
    }
  );
}

function checkHealthRisks(userId, logType, value, unit) {
  db.query(
    `SELECT value FROM health_logs WHERE user_id = ? AND log_type = ?
     AND logged_at >= DATE_SUB(NOW(), INTERVAL 3 DAY) ORDER BY logged_at DESC LIMIT 5`,
    [userId, logType],
    (err, logs) => {
      if (err || !logs || logs.length < 3) return;
      let riskDetected = false, riskMessage = '', severity = 'warning', riskType = '', priority = 'medium';

      if (logType === 'blood_pressure') {
        const readings = logs.map(l => {
          const p = l.value.split('/');
          if (p.length !== 2) return null;
          const s = parseInt(p[0]), d = parseInt(p[1]);
          return isNaN(s) || isNaN(d) ? null : { s, d };
        }).filter(Boolean);
        if (readings.length < 3) return;
        const critHigh = readings.filter(r => r.s > 180 || r.d > 120).length;
        const high     = readings.filter(r => r.s > 140 || r.d > 90).length;
        const low      = readings.filter(r => r.s < 90  || r.d < 60).length;
        if      (critHigh >= 2) { riskDetected = true; severity = 'critical'; riskType = 'critical_high_bp';    priority = 'critical'; riskMessage = `🚨 CRITICAL BP: Blood pressure dangerously high (${value} ${unit}). SEEK IMMEDIATE MEDICAL ATTENTION.`; }
        else if (high >= 3)     { riskDetected = true; severity = 'danger';   riskType = 'high_blood_pressure'; priority = 'high';     riskMessage = `⚠️ HIGH BP: ${high} elevated readings in 3 days. Current: ${value} ${unit}. Please consult a doctor.`; }
        else if (low >= 3)      { riskDetected = true; severity = 'warning';  riskType = 'low_blood_pressure';  priority = 'high';     riskMessage = `⚠️ LOW BP: ${low} low readings in 3 days. Current: ${value} ${unit}. Monitor closely.`; }
      } else if (logType === 'blood_sugar') {
        const readings = logs.map(l => parseFloat(l.value)).filter(r => !isNaN(r));
        if (readings.length < 3) return;
        const critLow = readings.filter(r => r < 54).length;
        const low     = readings.filter(r => r < 70).length;
        const high    = readings.filter(r => r > 180).length;
        if      (critLow >= 2) { riskDetected = true; severity = 'critical'; riskType = 'critical_low_sugar'; priority = 'critical'; riskMessage = `🚨 CRITICAL SUGAR: Blood sugar dangerously low (${value} ${unit}). EMERGENCY ATTENTION NEEDED.`; }
        else if (low >= 3)     { riskDetected = true; severity = 'danger';   riskType = 'low_blood_sugar';    priority = 'high';     riskMessage = `⚠️ LOW SUGAR: ${low} low readings in 3 days. Current: ${value} ${unit}.`; }
        else if (high >= 3)    { riskDetected = true; severity = 'warning';  riskType = 'high_blood_sugar';   priority = 'medium';   riskMessage = `⚠️ HIGH SUGAR: ${high} elevated readings in 3 days. Current: ${value} ${unit}.`; }
      } else if (logType === 'heart_rate') {
        const readings = logs.map(l => parseFloat(l.value)).filter(r => !isNaN(r));
        if (readings.length < 3) return;
        const critHigh = readings.filter(r => r > 130).length;
        const high     = readings.filter(r => r > 100).length;
        const low      = readings.filter(r => r < 60).length;
        if      (critHigh >= 2) { riskDetected = true; severity = 'critical'; riskType = 'critical_high_hr'; priority = 'critical'; riskMessage = `🚨 CRITICAL HEART RATE: ${value} ${unit} — dangerously high. SEEK IMMEDIATE HELP.`; }
        else if (high >= 3)     { riskDetected = true; severity = 'danger';   riskType = 'high_heart_rate';  priority = 'high';     riskMessage = `⚠️ HIGH HEART RATE: ${high} elevated readings in 3 days. Current: ${value} ${unit}.`; }
        else if (low >= 3)      { riskDetected = true; severity = 'warning';  riskType = 'low_heart_rate';   priority = 'medium';   riskMessage = `⚠️ LOW HEART RATE: ${low} low readings in 3 days. Current: ${value} ${unit}.`; }
      } else if (logType === 'temperature') {
        const readings = logs.map(l => parseFloat(l.value)).filter(r => !isNaN(r));
        if (readings.length < 3) return;
        const critHigh = readings.filter(r => r >= 103).length;
        const low      = readings.filter(r => r < 96).length;
        if      (critHigh >= 2) { riskDetected = true; severity = 'critical'; riskType = 'high_fever';      priority = 'critical'; riskMessage = `🚨 HIGH FEVER: Temperature ${value}${unit}. MEDICAL ATTENTION REQUIRED NOW.`; }
        else if (low >= 2)      { riskDetected = true; severity = 'danger';   riskType = 'low_temperature'; priority = 'high';     riskMessage = `⚠️ LOW TEMP: ${low} low temperature readings. Current: ${value}${unit}.`; }
      }

      if (riskDetected) {
        db.query(
          `INSERT INTO health_risks (elder_id, risk_type, log_type, severity, message, readings_count) VALUES (?,?,?,?,?,?)`,
          [userId, riskType, logType, severity, riskMessage, logs.length]
        );
        notifyCaregivers(userId, 'vital', riskMessage, priority);
      }
    }
  );
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isScheduledToday(scheduledDays) {
  if (!scheduledDays || !scheduledDays.length) return true;
  const today = DAY_NAMES[new Date().getDay()];
  return scheduledDays.includes('daily') ||
    scheduledDays.includes('everyday') ||
    scheduledDays.includes(today) ||
    scheduledDays.includes(today.toLowerCase());
}

function isScheduledOnDate(scheduledDays, dateISO) {
  if (!scheduledDays || !scheduledDays.length) return true;
  const dayName = DAY_NAMES[new Date(dateISO + 'T12:00:00').getDay()];
  return scheduledDays.includes('daily') ||
    scheduledDays.includes('everyday') ||
    scheduledDays.includes(dayName) ||
    scheduledDays.includes(dayName.toLowerCase());
}

function toScheduleShape(row) {
  const m = parseMeta(row.notes) || {};
  return {
    id:              row.id,
    elder_id:        row.user_id,
    elder_name:      row.elder_name     || '',
    type:            row.frequency      || 'medicine',
    title:           row.name,
    description:     m.desc             || null,
    dosage:          row.dosage         || null,
    scheduled_time:  row.time,
    scheduled_days:  m.days             || ['daily'],
    start_date:      m.startDate        || new Date().toISOString().split('T')[0],
    end_date:        m.endDate          || null,
    repeat_interval: m.interval         || 30,
    max_reminders:   m.maxRem           || 3,
    is_active:       true,
  };
}

function buildDateClause(col, dateFilter, days, params) {
  if (dateFilter) {
    params.push(dateFilter);
    return `AND DATE(${col}) = ?`;
  }
  params.push(days);
  return `AND ${col} >= DATE_SUB(NOW(), INTERVAL ? DAY)`;
}

function tryParse(str, fallback) {
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

// =============================================================================
// CRON JOB — runs every minute
// =============================================================================
cron.schedule('* * * * *', () => {
  const todayISO = new Date().toISOString().split('T')[0];
  const nowTime  = new Date().toTimeString().slice(0, 5);

  db.query(
    `UPDATE medication_intake
     SET status = 'pending', snooze_until = NULL
     WHERE status = 'snoozed'
       AND snooze_until IS NOT NULL
       AND snooze_until <= NOW()`,
    [],
    (err) => { if (err) console.log('[CRON] snooze expiry error:', err.message); }
  );

  db.query(
    `SELECT
       m.id           AS medId,
       m.user_id      AS elderId,
       m.name         AS title,
       m.frequency    AS type,
       m.notes,
       m.time         AS scheduledTime,
       u.expo_push_token,
       u.name         AS elderName,
       (SELECT COUNT(*)
        FROM reminder_logs rl
        WHERE rl.medication_id = m.id
          AND rl.user_id       = m.user_id
          AND rl.scheduled_date = ?) AS attemptCount,
       (SELECT status
        FROM medication_intake mi
        WHERE mi.medication_id  = m.id
          AND mi.user_id        = m.user_id
          AND DATE(mi.taken_at) = ?
        ORDER BY mi.taken_at DESC
        LIMIT 1) AS intakeStatus,
       (SELECT snooze_until
        FROM medication_intake mi2
        WHERE mi2.medication_id  = m.id
          AND mi2.user_id        = m.user_id
          AND DATE(mi2.taken_at) = ?
          AND mi2.status         = 'snoozed'
          AND mi2.snooze_until   > NOW()
        LIMIT 1) AS activeSnoozeUntil
     FROM medications m
     JOIN medication_reminder mr
       ON mr.medication_id = m.id AND mr.is_active = 1
     JOIN users u ON u.id = m.user_id
     WHERE TIME(mr.reminder_time) <= ?
       AND m.notes IS NOT NULL`,
    [todayISO, todayISO, todayISO, nowTime],
    (err, rows) => {
      if (err || !rows) return;

      rows.forEach(row => {
        const meta = parseMeta(row.notes) || {};
        if (!meta.days || !Array.isArray(meta.days))     return;
        if (meta.startDate && todayISO < meta.startDate) return;
        if (!isScheduledToday(meta.days || ['daily']))   return;
        if (meta.endDate   && todayISO > meta.endDate)   return;

        if (row.intakeStatus === 'taken' || row.intakeStatus === 'partial') return;
        if (row.intakeStatus === 'overdue') return;
        if (row.activeSnoozeUntil) return;

        const maxReminders = meta.maxRem   || 3;
        const intervalMins = meta.interval || 30;
        const attemptCount = row.attemptCount || 0;

        db.query(
          `SELECT sent_at FROM reminder_logs
           WHERE medication_id = ? AND user_id = ? AND scheduled_date = ?
           ORDER BY sent_at DESC LIMIT 1`,
          [row.medId, row.elderId, todayISO],
          (err2, lastLog) => {
            if (err2) return;

            const now = new Date();
            if (lastLog && lastLog.length) {
              const diffMins = (now - new Date(lastLog[0].sent_at)) / 60000;
              if (diffMins < intervalMins) return;
            }

            if (attemptCount >= maxReminders) {
              db.query(
                `SELECT id FROM medication_intake
                 WHERE medication_id  = ? AND user_id = ?
                   AND DATE(taken_at) = ?
                   AND (is_overdue    = 1 OR status = 'missed')
                 LIMIT 1`,
                [row.medId, row.elderId, todayISO],
                (err3, already) => {
                  if (err3 || (already && already.length)) return;

                  db.query(
                    `INSERT INTO medication_intake
                       (medication_id, user_id, taken_at, status, is_overdue)
                     VALUES (?, ?, NOW(), 'missed', 1)`,
                    [row.medId, row.elderId],
                    () => {}
                  );

                  logActivity(
                    row.elderId, 'medication_missed',
                    `⚠️ OVERDUE: "${row.title}" (${row.type}) — no response after ${attemptCount} reminders`
                  );

                  const sevenDaysAgo = new Date();
                  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
                  const sevenDaysAgoISO = sevenDaysAgo.toISOString().split('T')[0];

                  db.query(
                    `SELECT
                       COUNT(*) AS days_due,
                       SUM(CASE WHEN mi.status='taken'   THEN 1 ELSE 0 END) AS days_taken,
                       SUM(CASE WHEN mi.status='partial' THEN 0.5 ELSE 0 END) AS days_partial
                     FROM (
                       SELECT DATE(mi2.taken_at) AS intake_date,
                              MAX(CASE WHEN mi2.status='taken' THEN 2
                                       WHEN mi2.status='partial' THEN 1 ELSE 0 END) AS best_status_rank,
                              MAX(mi2.status) AS status
                       FROM medication_intake mi2
                       WHERE mi2.medication_id = ? AND mi2.user_id = ?
                         AND DATE(mi2.taken_at) BETWEEN ? AND ?
                       GROUP BY DATE(mi2.taken_at)
                     ) mi`,
                    [row.medId, row.elderId, sevenDaysAgoISO, todayISO],
                    (errAdh, adhRows) => {
                      const adhData = adhRows && adhRows[0] ? adhRows[0] : null;
                      let adhStr = '';
                      if (adhData && adhData.days_due > 0) {
                        const pct = Math.round(((parseFloat(adhData.days_taken) + parseFloat(adhData.days_partial)) / adhData.days_due) * 100);
                        const trend = pct >= 90 ? '🟢' : pct >= 70 ? '🟡' : pct >= 50 ? '🟠' : '🔴';
                        adhStr = ` | 7-day adherence: ${trend} ${pct}%`;
                      }

                      const msg = `🚨 MISSED DOSE: "${row.title}" (${row.type}) — ${row.elderName} did not respond after ${attemptCount} reminders.${adhStr}`;
                      notifyCaregivers(row.elderId, 'overdue', msg, 'high');

                      if (row.expo_push_token) {
                        sendPushNotification(
                          row.expo_push_token,
                          '⚠️ Dose Missed',
                          `"${row.title}" has been marked overdue. Please open the app.`,
                          { screen: 'TodayReminders', scheduleId: row.medId }
                        );
                      }
                      console.log(`[OVERDUE] Elder ${row.elderId} — "${row.title}"${adhStr}`);
                    }
                  );
                }
              );
              return;
            }

            const attemptNum = attemptCount + 1;
            const isFirst    = attemptNum === 1;

            db.query(
              `INSERT INTO reminder_logs
                 (medication_id, user_id, scheduled_date, attempt_number, status)
               VALUES (?, ?, ?, ?, 'sent')`,
              [row.medId, row.elderId, todayISO, attemptNum],
              () => {}
            );

            if (row.expo_push_token) {
              const pushTitle = isFirst
                ? `⏰ Time for: ${row.title}`
                : `🔔 Reminder ${attemptNum}/${maxReminders}: ${row.title}`;
              const pushBody  = row.type === 'medicine'
                ? 'Please take your medicine and mark it as done.'
                : 'Please complete this task and mark it as done.';
              sendPushNotification(
                row.expo_push_token, pushTitle, pushBody,
                { screen: 'TodayReminders', scheduleId: row.medId }
              );
            }

            if (isFirst && meta.cgId) {
              db.query(
                `INSERT INTO alerts
                   (user_id, caregiver_id, alert_type, message, is_read, priority, created_at)
                 VALUES (?, ?, 'reminder_sent', ?, 0, 'low', NOW())`,
                [row.elderId, meta.cgId,
                 `⏰ Reminder sent to ${row.elderName}: "${row.title}" at ${row.scheduledTime}`],
                () => {}
              );
            }

            if (!isFirst && meta.cgId) {
              db.query(
                `INSERT INTO alerts
                   (user_id, caregiver_id, alert_type, message, is_read, priority, created_at)
                 VALUES (?, ?, 'reminder_sent', ?, 0, 'medium', NOW())`,
                [row.elderId, meta.cgId,
                 `🔔 Re-reminder ${attemptNum}/${maxReminders} sent to ${row.elderName}: "${row.title}" — no response yet`],
                () => {}
              );
              sendCaregiverPush(
                meta.cgId,
                '🔔 No response yet',
                `${row.elderName} hasn't responded to "${row.title}" (attempt ${attemptNum}/${maxReminders})`
              );
            }

            console.log(`[REMIND] Elder ${row.elderId} — "${row.title}" attempt ${attemptNum}/${maxReminders}`);
          }
        );
      });
    }
  );
});

// =============================================================================
// TEST
// =============================================================================
app.get('/test', (req, res) => res.json({ message: 'Server is working!', timestamp: new Date().toISOString() }));

// =============================================================================
// AUTH
// =============================================================================
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role, phone, dob, gender, emergency } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const regCode = (role === 'elderly') ? generateCode() : null;
    db.query(
      `INSERT INTO users (name,email,password,role,phone,registration_code,dob,gender,emergency_contact)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [name, email, hashedPassword, role, phone, regCode, dob, gender, (role === 'elderly' ? emergency : null)],
      (err, result) => {
        if (err) return res.status(400).json({ message: 'Registration failed: ' + err.message });
        res.json({ message: 'Success', registration_code: regCode, userId: result.insertId });
      }
    );
  } catch { res.status(500).json({ message: 'Server Error' }); }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.query('SELECT * FROM users WHERE email=?', [email], async (err, results) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!results.length) return res.status(401).json({ message: 'Invalid credentials' });
    const user  = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });
    if (user.role === 'caregiver' || user.role === 'doctor') {
      db.query(
        `SELECT COUNT(*) as count FROM connections WHERE requester_id=? AND status='approved'`,
        [user.id],
        (_, connResults) => {
          const hasConnection = connResults && connResults[0] && connResults[0].count > 0;
          res.json({ id: user.id, role: user.role, name: user.name, email: user.email, code: user.registration_code, hasConnection });
        }
      );
    } else {
      res.json({ id: user.id, role: user.role, name: user.name, email: user.email, code: user.registration_code });
    }
  });
});

app.post('/api/auth/connect', (req, res) => {
  const { requesterId, targetCode, relationship } = req.body;
  db.query('SELECT id, name FROM users WHERE registration_code=?', [targetCode], (err, results) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!results.length) return res.status(404).json({ message: 'Invalid Code' });
    const elderId = results[0].id;
    if (elderId == requesterId) return res.status(400).json({ message: 'Cannot connect to yourself' });
    db.query('SELECT status FROM connections WHERE elder_id=? AND requester_id=?', [elderId, requesterId], (_, cr) => {
      if (cr && cr.length > 0) return res.status(400).json({ message: 'Already connected or pending' });
      db.query(
        `INSERT INTO connections (elder_id,requester_id,relationship,status) VALUES (?,?,?,'pending')`,
        [elderId, requesterId, relationship],
        (err2) => {
          if (err2) return res.status(400).json({ message: 'Failed to send request' });
          res.json({ message: 'Request sent successfully!', elderName: results[0].name });
        }
      );
    });
  });
});

app.get('/api/auth/pending/:elderId', (req, res) => {
  db.query(
    `SELECT c.id as connectionId, u.name, u.role, c.relationship
     FROM connections c JOIN users u ON c.requester_id=u.id
     WHERE c.elder_id=? AND c.status='pending'`,
    [req.params.elderId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

app.post('/api/auth/approve-connection', (req, res) => {
  db.query('UPDATE connections SET status="approved" WHERE id=?', [req.body.connectionId], (err) => {
    if (err) return res.status(500).json({ message: 'Approval failed' });
    res.json({ message: 'Approved' });
  });
});

app.post('/api/auth/reject-connection', (req, res) => {
  db.query('DELETE FROM connections WHERE id=?', [req.body.connectionId], (err) => {
    if (err) return res.status(500).json({ message: 'Failed' });
    res.json({ message: 'Request removed' });
  });
});

app.get('/api/connections/:caregiverId', (req, res) => {
  db.query(
    `SELECT u.id, u.name, u.dob, u.phone, u.emergency_contact, c.relationship
     FROM connections c JOIN users u ON c.elder_id=u.id
     WHERE c.requester_id=? AND c.status='approved'`,
    [req.params.caregiverId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

// new
// ─────────────────────────────────────────────────────────────────────────────
// ADD BOTH OF THESE ROUTES TO index.js
// Place them near the other /api/connections routes (around line 180)
// ─────────────────────────────────────────────────────────────────────────────

// [1] Used by CaregiverNavigator to get the elder's id on startup
app.get('/api/caregiver/elder/:caregiverId', (req, res) => {
  db.query(
    `SELECT u.id, u.name, u.dob, u.phone, u.emergency_contact, c.relationship
     FROM connections c JOIN users u ON c.elder_id=u.id
     WHERE c.requester_id=? AND c.status='approved'
     LIMIT 1`,
    [req.params.caregiverId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      if (!results || !results.length) return res.status(404).json({ message: 'No elder connected' });
      res.json(results[0]);
    }
  );
});

// [2] Used by CaregiverChatScreen to list doctors connected to an elder
//     Returns each doctor with their latest message preview + unread count
app.get('/api/doctor/connected/:elderId', async (req, res) => {
  const { elderId } = req.params;
  try {
    const doctors = await dbQuery(
      `SELECT u.id, u.name, u.phone,
         NULL AS specialty
       FROM connections c
       JOIN users u ON c.requester_id = u.id
       WHERE c.elder_id = ? AND c.status = 'approved' AND u.role = 'doctor'
       ORDER BY u.name ASC`,
      [elderId]
    );
    await Promise.all(doctors.map(async (doc) => {
      const [lastMsg] = await dbQuery(
        `SELECT message, sent_at FROM chat_messages
         WHERE elder_id = ? AND (sender_id = ? OR receiver_id = ?)
         ORDER BY sent_at DESC LIMIT 1`,
        [elderId, doc.id, doc.id]
      ).catch(() => []);
      const [unread] = await dbQuery(
        `SELECT COUNT(*) AS cnt FROM chat_messages
         WHERE elder_id = ? AND sender_id = ? AND is_read = 0`,
        [elderId, doc.id]
      ).catch(() => [{ cnt: 0 }]);
      doc.last_message    = lastMsg?.message    || null;
      doc.last_message_at = lastMsg?.sent_at    || null;
      doc.unread_count    = unread?.cnt         || 0;
    }));
    res.json(doctors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// [3] UPDATE /api/doctor/patients/:doctorId to include today_alerts per patient
//     REPLACE the existing route with this version to show today's alerts
//     in the Priority Patients section of DoctorDashboard
app.get('/api/doctor/patients/:doctorId', async (req, res) => {
  const doctorId = parseInt(req.params.doctorId);
  if (!doctorId) return res.status(400).json({ message: 'Invalid doctorId' });
  try {
    const patients = await dbQuery(
      `SELECT u.id, u.name, u.dob, u.phone, u.gender, u.emergency_contact, c.relationship,
         (SELECT COUNT(*) FROM alerts a WHERE a.user_id=u.id AND a.is_read=0) AS unread_alerts,
         (SELECT COUNT(*) FROM health_risks hr WHERE hr.elder_id=u.id AND hr.resolved=0) AS active_risks,
         (SELECT COUNT(*) FROM health_risks hr2 WHERE hr2.elder_id=u.id AND hr2.severity='critical'
            AND hr2.detected_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)) AS critical_flags
       FROM connections c JOIN users u ON c.elder_id=u.id
       WHERE c.requester_id=? AND c.status='approved'
       ORDER BY unread_alerts DESC, u.name ASC`,
      [doctorId]
    );
    await Promise.all(patients.map(async p => {
      const [vitals, risk, mood, todayAlerts] = await Promise.all([
        dbQuery(`SELECT log_type, value, unit, logged_at FROM health_logs h1
          WHERE user_id=? AND logged_at=(SELECT MAX(logged_at) FROM health_logs h2
          WHERE h2.user_id=h1.user_id AND h2.log_type=h1.log_type)`, [p.id]),
        dbQuery(`SELECT risk_level, risk_score, is_critical FROM ai_risk_scores
          WHERE elder_id=? ORDER BY assessed_at DESC LIMIT 1`, [p.id]).catch(()=>[]),
        dbQuery(`SELECT mood, sentiment_label FROM mood_logs
          WHERE user_id=? ORDER BY logged_at DESC LIMIT 1`, [p.id]).catch(()=>[]),
        // ✅ Today's alerts for priority cards
        dbQuery(`SELECT id, alert_type, message, priority, created_at FROM alerts
          WHERE user_id=? AND DATE(created_at)=CURDATE()
          ORDER BY FIELD(priority,'critical','high','medium','low'), created_at DESC
          LIMIT 5`, [p.id]).catch(()=>[]),
      ]);
      p.latest_vitals  = vitals;
      p.latest_risk    = risk[0]        || null;
      p.latest_mood    = mood[0]        || null;
      p.today_alerts   = todayAlerts    || [];
    }));
    res.json(patients);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// =============================================================================
// PUSH TOKEN
// =============================================================================
app.post('/api/push-token', (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) return res.status(400).json({ message: 'Missing userId or token' });
  db.query('UPDATE users SET expo_push_token=? WHERE id=?', [token, userId], (err) => {
    if (err) return res.status(500).json({ message: 'Failed to save token' });
    res.json({ message: 'Push token saved' });
  });
});

// =============================================================================
// MEDICATIONS
// =============================================================================
app.post('/api/medications', (req, res) => {
  const { elderId, name, type, dosage, frequency, time, notes, date, recurrence, end_date } = req.body;
  if (!name || !type) return res.status(400).json({ message: 'Name and type are required' });
  if (type === 'medicine' && (!dosage || !frequency))
    return res.status(400).json({ message: 'Dosage and frequency required for medicine' });
  db.query(
    `INSERT INTO medications (user_id,name,type,dosage,frequency,time,notes,date,recurrence,end_date)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [elderId, name, type, dosage || null, frequency || null, time || null, notes || null, date || null, recurrence || 'none', end_date || null],
    (err, result) => {
      if (err) return res.status(400).json({ message: 'Failed to add schedule: ' + err.message });
      if (time) {
        db.query(
          `INSERT INTO medication_reminder (medication_id, reminder_time, is_active) VALUES (?, ?, 1)`,
          [result.insertId, time],
          () => {}
        );
      }
      res.json({ message: 'Schedule added successfully', scheduleId: result.insertId });
    }
  );
});

app.get('/api/medications/:userId', (req, res) => {
  db.query(
    'SELECT * FROM medications WHERE user_id=? ORDER BY time',
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error fetching schedules' });
      res.json(results || []);
    }
  );
});

app.put('/api/medications/:id', (req, res) => {
  const { name, type, dosage, frequency, time, notes, date, recurrence, end_date } = req.body;
  if (type === 'medicine' && (!dosage || !frequency))
    return res.status(400).json({ message: 'Dosage and frequency required for medicine' });
  db.query(
    `UPDATE medications SET name=?,type=?,dosage=?,frequency=?,time=?,notes=?,date=?,recurrence=?,end_date=? WHERE id=?`,
    [name, type, dosage || null, frequency || null, time || null, notes || null, date || null, recurrence || 'none', end_date || null, req.params.id],
    (err) => {
      if (err) return res.status(400).json({ message: 'Failed to update schedule' });
      if (time) db.query(`UPDATE medication_reminder SET reminder_time=? WHERE medication_id=?`, [time, req.params.id], () => {});
      res.json({ message: 'Schedule updated' });
    }
  );
});

app.delete('/api/medications/:id', (req, res) => {
  db.query(`UPDATE medication_reminder SET is_active=0 WHERE medication_id=?`, [req.params.id], () => {});
  db.query('DELETE FROM medications WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: 'Failed' });
    res.json({ message: 'Deleted' });
  });
});

app.post('/api/medications/mark-taken', (req, res) => {
  const { medicationId, userId, status } = req.body;
  db.query(
    `INSERT INTO medication_intake (medication_id, user_id, taken_at, status) VALUES (?,?,NOW(),?)`,
    [medicationId, userId, status],
    (err, result) => {
      if (err) return res.status(400).json({ message: 'Failed' });
      db.query('SELECT name FROM medications WHERE id=?', [medicationId], (_, rows) => {
        const medName = rows && rows[0] ? rows[0].name : 'Unknown';
        logActivity(userId,
          status === 'taken' ? 'medication_taken' : 'medication_missed',
          `${status === 'taken' ? 'Took' : 'Missed'} ${medName}`
        );
      });
      res.json({ message: 'Medication logged', logId: result.insertId });
    }
  );
});

app.get('/api/medication-logs/:userId', (req, res) => {
  db.query(
    `SELECT mi.*, m.name, m.dosage, m.time
     FROM medication_intake mi
     JOIN medications m ON mi.medication_id=m.id
     WHERE mi.user_id=? ORDER BY mi.taken_at DESC LIMIT 100`,
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

app.get('/api/medications/today/:userId', (req, res) => {
  db.query(
    `SELECT m.*,
       (SELECT COUNT(*) FROM medication_intake mi
        WHERE mi.medication_id=m.id AND mi.user_id=m.user_id
          AND DATE(mi.taken_at)=CURDATE() AND mi.status='taken') AS taken_today
     FROM medications m WHERE m.user_id=? ORDER BY m.time`,
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});



// =============================================================================
// HEALTH LOGS
// =============================================================================
app.post('/api/health-logs', (req, res) => {
  const { userId, logType, value, unit, notes } = req.body;
  if (!userId || !logType || !value || !unit) return res.status(400).json({ message: 'Missing required fields' });
  db.query(
    `INSERT INTO health_logs (user_id, log_type, value, unit, notes) VALUES (?,?,?,?,?)`,
    [userId, logType, value, unit, notes || null],
    (err, result) => {
      if (err) return res.status(400).json({ message: 'Failed: ' + err.message });
      const label = logType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      logActivity(userId, 'health_log', `Logged ${label}: ${value} ${unit}`);
      notifyCaregivers(userId, 'health_log', `📊 New health log: ${label} — ${value} ${unit}${notes ? ` (${notes})` : ''}`, 'low');
      checkHealthRisks(userId, logType, value, unit);
      runRiskAssessment(userId, 'vital_logged').catch(() => {});
      res.json({ message: 'Health data logged', logId: result.insertId });
    }
  );
});

app.get('/api/health-logs/:userId', (req, res) => {
  db.query(
    'SELECT * FROM health_logs WHERE user_id=? ORDER BY logged_at DESC LIMIT 50',
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

app.get('/api/health-logs/latest/:userId', (req, res) => {
  db.query(
    `SELECT log_type, value, unit, logged_at FROM health_logs h1
     WHERE user_id=?
       AND logged_at = (SELECT MAX(logged_at) FROM health_logs h2
                        WHERE h2.user_id=h1.user_id AND h2.log_type=h1.log_type)`,
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

app.get('/api/health-summary/:userId', (req, res) => {
  db.query(
    `SELECT log_type, COUNT(*) as total_logs, MAX(logged_at) as last_logged,
       AVG(CASE WHEN log_type IN ('blood_sugar','heart_rate','weight','temperature')
           THEN CAST(value AS DECIMAL(10,2)) ELSE NULL END) as avg_value
     FROM health_logs
     WHERE user_id=? AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
     GROUP BY log_type`,
    [req.params.userId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

// =============================================================================
// DJANGO REGRESSION SERVICE
// =============================================================================
const DJANGO_REGRESSION_URL = process.env.DJANGO_REGRESSION_URL || 'http://localhost:8001';

async function callDjangoRegressionBatch(vitalsPayload) {
  try {
    const resp = await fetch(`${DJANGO_REGRESSION_URL}/api/regression/batch/`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ vitals: vitalsPayload }),
    });
    if (!resp.ok) {
      console.error('[django-regression] batch returned', resp.status);
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.error('[django-regression] batch call failed:', err.message);
    return null;
  }
}

async function callDjangoRegressionSingle(log_type, readings) {
  try {
    const resp = await fetch(`${DJANGO_REGRESSION_URL}/api/regression/single/`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ log_type, readings }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (err) {
    console.error('[django-regression] single call failed:', err.message);
    return null;
  }
}

// =============================================================================
// REGRESSION HELPERS — progressive date-window fallback
// =============================================================================
function groupByLogType(rows) {
  const g = {};
  rows.forEach(r => {
    if (!g[r.log_type]) g[r.log_type] = [];
    g[r.log_type].push({ date: r.date, value: r.value });
  });
  return g;
}

async function fetchAllVitalsWithFallback(elderId, preferredDays) {
  const FALLBACK_WINDOWS = [preferredDays, 30, 14, 7]
    .filter((v, i, arr) => arr.indexOf(v) === i && v > 0)
    .sort((a, b) => b - a);

  for (const days of FALLBACK_WINDOWS) {
    const endDate   = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const rows = await new Promise((resolve) => {
      db.query(
        `SELECT log_type, value, unit, DATE(logged_at) AS date
         FROM   health_logs
         WHERE  user_id = ?
           AND  DATE(logged_at) BETWEEN ? AND ?
         ORDER  BY log_type, logged_at ASC`,
        [elderId, startDate, endDate],
        (err, r) => resolve(err ? [] : (r || []))
      );
    });

    const grouped    = groupByLogType(rows);
    const validTypes = Object.values(grouped).filter(arr => arr.length >= 2);
    if (validTypes.length > 0) return { rows, windowDays: days };
  }

  const rows = await new Promise((resolve) => {
    db.query(
      `SELECT log_type, value, unit, DATE(logged_at) AS date
       FROM   health_logs
       WHERE  user_id = ?
       ORDER  BY log_type, logged_at DESC`,
      [elderId],
      (err, r) => resolve(err ? [] : (r || []))
    );
  });

  const grouped     = groupByLogType(rows);
  const limitedRows = [];
  Object.entries(grouped).forEach(([logType, arr]) => {
    arr.slice(0, 20).reverse().forEach(item => {
      limitedRows.push({ log_type: logType, value: item.value, date: item.date });
    });
  });

  return limitedRows.length >= 2 ? { rows: limitedRows, windowDays: null } : null;
}

async function fetchSingleVitalWithFallback(elderId, logType, preferredDays) {
  const FALLBACK_WINDOWS = [preferredDays, 30, 14, 7]
    .filter((v, i, arr) => arr.indexOf(v) === i && v > 0)
    .sort((a, b) => b - a);

  for (const days of FALLBACK_WINDOWS) {
    const endDate   = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const rows = await new Promise((resolve) => {
      db.query(
        `SELECT value, DATE(logged_at) AS date
         FROM   health_logs
         WHERE  user_id  = ?
           AND  log_type = ?
           AND  DATE(logged_at) BETWEEN ? AND ?
         ORDER  BY logged_at ASC`,
        [elderId, logType, startDate, endDate],
        (err, r) => resolve(err ? [] : (r || []))
      );
    });

    if (rows.length >= 2) return { rows, windowDays: days };
  }

  const rows = await new Promise((resolve) => {
    db.query(
      `SELECT value, DATE(logged_at) AS date
       FROM   health_logs
       WHERE  user_id  = ? AND log_type = ?
       ORDER  BY logged_at DESC LIMIT 20`,
      [elderId, logType],
      (err, r) => resolve(err ? [] : (r || []).reverse())
    );
  });

  return rows.length >= 2 ? { rows, windowDays: null } : null;
}

// =============================================================================
// GET /api/health-trends/report/:elderId
// =============================================================================
app.get('/api/health-trends/report/:elderId', async (req, res) => {
  const { elderId } = req.params;
  const preferredDays = parseInt(req.query.days) || 30;

  const result = await fetchAllVitalsWithFallback(elderId, preferredDays);

  if (!result || !result.rows || !result.rows.length) {
    return res.json([]);
  }

  const { rows, windowDays } = result;

  const grouped       = groupByLogType(rows);
  const vitalsPayload = Object.entries(grouped)
    .filter(([, readings]) => readings.length >= 2)
    .map(([log_type, readings]) => ({ log_type, readings }));

  if (!vitalsPayload.length) return res.json([]);

  const regressionResults = await callDjangoRegressionBatch(vitalsPayload);
  if (!regressionResults) {
    return res.status(503).json({
      message: 'Regression service unavailable. Is Django running on port 8001?',
    });
  }

  const enriched = regressionResults.map(vital => ({
    ...vital,
    data_window_days:  windowDays,
    data_window_label: windowDays ? `Last ${windowDays} days` : 'All available data',
  }));

  res.json(enriched);
});

// =============================================================================
// GET /api/health-trends/report/:elderId/:logType
// =============================================================================
app.get('/api/health-trends/report/:elderId/:logType', async (req, res) => {
  const { elderId, logType } = req.params;
  const preferredDays = parseInt(req.query.days) || 30;

  const result = await fetchSingleVitalWithFallback(elderId, logType, preferredDays);

  if (!result) {
    return res.status(404).json({
      message: `No data found for ${logType}. At least 2 readings are required to compute a trend.`,
    });
  }

  const { rows, windowDays } = result;

  const regressionResult = await callDjangoRegressionSingle(logType, rows);
  if (!regressionResult) {
    return res.status(503).json({ message: 'Regression service unavailable' });
  }

  res.json({
    ...regressionResult,
    data_window_days:  windowDays,
    data_window_label: windowDays ? `Last ${windowDays} days` : 'All available data',
  });
});

// =============================================================================
// GET /api/health-trends/:userId/:logType — MUST be AFTER the /report routes
// =============================================================================
app.get('/api/health-trends/:userId/:logType', (req, res) => {
  db.query(
    `SELECT value, unit, logged_at FROM health_logs
     WHERE user_id=? AND log_type=?
       AND logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     ORDER BY logged_at ASC`,
    [req.params.userId, req.params.logType, req.query.days || 7],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

// =============================================================================
// MOOD
// =============================================================================
// =============================================================================
// PASTE THIS FILE'S CONTENT INTO index.js
// ─────────────────────────────────────────────────────────────────────────────
// 1. callDjangoSentiment()   — helper (add near callDjangoRiskAssess)
// 2. getMoodStreak()         — helper (add near callDjangoSentiment)
// 3. POST /api/mood          — REPLACE the existing POST /api/mood route
// 4. GET  /api/mood/sentiment/:userId  — NEW route (add after POST /api/mood)
// 5. GET  /api/mood/history/:userId    — NEW route (add after sentiment route)
// =============================================================================


// =============================================================================
// [1] HELPER — call Django sentiment microservice
//     Add this near callDjangoRiskAssess()
// =============================================================================
async function callDjangoSentiment(payload) {
  try {
    const resp = await fetch(`${DJANGO_REGRESSION_URL}/api/regression/sentiment/analyze/`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.error('[sentiment] Django returned', resp.status);
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.error('[sentiment] Django call failed:', err.message);
    return null;
  }
}


// =============================================================================
// [2] HELPER — compute mood streak (consecutive concerning moods)
//     Add this near callDjangoSentiment()
//     Returns: number of consecutive sad/anxious/lonely/tired moods ending now
// =============================================================================
async function getMoodStreak(userId) {
  try {
    const rows = await dbQuery(
      `SELECT mood FROM mood_logs
       WHERE user_id = ?
       ORDER BY logged_at DESC
       LIMIT 10`,
      [userId]
    );
    const concerning = new Set(['sad', 'anxious', 'lonely', 'tired']);
    let streak = 0;
    for (const row of rows) {
      if (concerning.has(row.mood)) streak++;
      else break;
    }
    return streak;
  } catch (_) {
    return 0;
  }
}


// =============================================================================
// [3] POST /api/mood   — REPLACE the existing route with this version
//     Changes vs old route:
//       - Calls Django sentiment after saving
//       - Saves sentiment result to mood_logs (sentiment_label, concern_score)
//       - Sends smarter caregiver alert with AI label + advice
//       - Stores alert_id so front-end can reference it
// =============================================================================
app.post('/api/mood', async (req, res) => {
  const { userId, mood, notes } = req.body;
  if (!userId || !mood) return res.status(400).json({ message: 'userId and mood required' });

  try {
    // ── 1. Save mood log ──────────────────────────────────────────────────
    const insertResult = await dbQuery(
      `INSERT INTO mood_logs (user_id, mood, notes) VALUES (?, ?, ?)`,
      [userId, mood, notes || null]
    );
    const moodLogId = insertResult.insertId;

    logActivity(userId, 'mood_log', `Mood recorded: ${mood}`);

    // ── 2. Compute streak + hour ──────────────────────────────────────────
    const streak = await getMoodStreak(userId);
    const hour   = new Date().getHours();

    // ── 3. Call Django sentiment model ────────────────────────────────────
    let sentimentResult = null;
    try {
      const djangoResp = await callDjangoSentiment({
        elder_id:    userId,
        mood,
        notes:       notes || '',
        mood_streak: streak,
        hour,
      });
      if (djangoResp && djangoResp.assessment) {
        sentimentResult = djangoResp.assessment;
      }
    } catch (sentErr) {
      console.log('[sentiment] Non-fatal error:', sentErr.message);
    }

    // ── 4. Update mood_log with sentiment result (if columns exist) ───────
    if (sentimentResult) {
      db.query(
        `UPDATE mood_logs
         SET sentiment_label = ?,
             concern_score   = ?,
             sentiment_color = ?
         WHERE id = ?`,
        [
          sentimentResult.sentiment_label,
          sentimentResult.concern_score,
          sentimentResult.sentiment_color,
          moodLogId,
        ],
        (err) => {
          if (err) console.log('[sentiment] mood_logs update error (run migration):', err.message);
        }
      );
    }

    // ── 5. Caregiver notification ─────────────────────────────────────────
    const concerningMoods = new Set(['sad', 'anxious', 'lonely']);
    const isConcerning    = concerningMoods.has(mood);

    let alertPriority = 'low';
    let alertMessage;
    let alertEmoji = '😊';

    if (sentimentResult) {
      // AI-powered alert message
      const label = sentimentResult.sentiment_label;
      const score = sentimentResult.concern_score;
      const emoji = sentimentResult.sentiment_emoji;
      alertEmoji  = emoji;

      if (label === 'CRITICAL') {
        alertPriority = 'critical';
        alertMessage  = `🚨 CRITICAL mood alert for elder — ${emoji} ${label} (score: ${score}/100)\n` +
                        `Mood: ${mood.charAt(0).toUpperCase() + mood.slice(1)}` +
                        (notes ? `\nNote: "${notes}"` : '') +
                        `\n\n💡 Advice: ${sentimentResult.advice}`;
      } else if (label === 'CONCERNING') {
        alertPriority = 'high';
        alertMessage  = `⚠️ Mood concern detected — ${emoji} ${label} (score: ${score}/100)\n` +
                        `Mood: ${mood.charAt(0).toUpperCase() + mood.slice(1)}` +
                        (notes ? `\nNote: "${notes}"` : '') +
                        `\n\n💡 Advice: ${sentimentResult.advice}`;
      } else {
        alertMessage  = `${emoji} Mood check-in: ${mood.charAt(0).toUpperCase() + mood.slice(1)} (${label})` +
                        (notes ? ` — "${notes}"` : '');
      }
    } else {
      // Fallback: original simple alert
      alertMessage = `${isConcerning ? '⚠️' : '😊'} Mood check-in: ${mood.charAt(0).toUpperCase() + mood.slice(1)}` +
                     (notes ? ` — "${notes}"` : '');
      alertPriority = isConcerning ? 'high' : 'low';
    }

    notifyCaregivers(userId, 'mood', alertMessage, alertPriority);

    // ── 6. Extra push for CRITICAL ────────────────────────────────────────
    if (sentimentResult?.sentiment_label === 'CRITICAL') {
      db.query(
        `SELECT requester_id FROM connections WHERE elder_id = ? AND status = 'approved'`,
        [userId],
        (err, caregivers) => {
          if (err || !caregivers) return;
          caregivers.forEach(c => {
            sendCaregiverPush(
              c.requester_id,
              '🚨 Critical Mood Alert',
              `Elder needs immediate attention — concern score: ${sentimentResult.concern_score}/100`
            );
          });
        }
      );
    }

    res.json({
      message:   'Mood logged successfully',
      moodLogId,
      sentiment: sentimentResult ? {
        label:        sentimentResult.sentiment_label,
        emoji:        sentimentResult.sentiment_emoji,
        score:        sentimentResult.concern_score,
        should_alert: sentimentResult.should_alert,
      } : null,
    });

  } catch (err) {
    console.error('POST /api/mood error:', err.message);
    res.status(500).json({ message: 'Failed to log mood: ' + err.message });
  }
});


// =============================================================================
// [4] GET /api/mood/sentiment/:userId
//     Returns the latest sentiment assessment for an elder
//     Used by: caregiver MoodInsightsCard
// =============================================================================
app.get('/api/mood/sentiment/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!userId) return res.status(400).json({ message: 'Invalid userId' });

  try {
    // Latest 10 mood logs with sentiment data
    const logs = await dbQuery(
      `SELECT id, mood, notes, sentiment_label, concern_score, sentiment_color, logged_at
       FROM mood_logs
       WHERE user_id = ?
       ORDER BY logged_at DESC
       LIMIT 10`,
      [userId]
    );

    if (!logs.length) {
      return res.json({ has_data: false, logs: [] });
    }

    // Streak calculation
    const streak    = await getMoodStreak(userId);
    const latest    = logs[0];

    // 7-day mood distribution
    const distribution = await dbQuery(
      `SELECT mood, COUNT(*) as count
       FROM mood_logs
       WHERE user_id = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY mood
       ORDER BY count DESC`,
      [userId]
    );

    // Count of concerning logs in last 7 days
    const concerningCount = await dbQuery(
      `SELECT COUNT(*) as cnt FROM mood_logs
       WHERE user_id = ?
         AND mood IN ('sad','anxious','lonely')
         AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [userId]
    );

    res.json({
      has_data:          true,
      latest_mood:       latest.mood,
      latest_sentiment:  latest.sentiment_label  || null,
      latest_score:      latest.concern_score    || null,
      latest_color:      latest.sentiment_color  || null,
      latest_at:         latest.logged_at,
      mood_streak:       streak,
      concerning_7d:     concerningCount[0]?.cnt || 0,
      distribution_7d:   distribution,
      logs:              logs,
    });

  } catch (err) {
    console.error('GET /api/mood/sentiment error:', err.message);
    res.status(500).json({ message: err.message });
  }
});


// =============================================================================
// [5] GET /api/mood/history/:userId
//     Full mood history with sentiment labels — for elder's own view
// =============================================================================
app.get('/api/mood/history/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  const limit  = Math.min(parseInt(req.query.limit) || 20, 50);

  try {
    const logs = await dbQuery(
      `SELECT id, mood, notes, sentiment_label, concern_score,
              sentiment_color, logged_at
       FROM mood_logs
       WHERE user_id = ?
       ORDER BY logged_at DESC
       LIMIT ?`,
      [userId, limit]
    );
    res.json(logs || []);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
//

app.get('/api/mood/:userId', (req, res) => {
  db.query('SELECT * FROM mood_logs WHERE user_id=? ORDER BY logged_at DESC', [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json(results || []);
  });
});

// =============================================================================
// ALERTS
// =============================================================================
app.get('/api/alerts/caregiver/:caregiverId', (req, res) => {
  db.query(
    `SELECT a.*, u.name as elder_name FROM alerts a JOIN users u ON a.user_id=u.id
     WHERE a.caregiver_id=? AND a.is_read=0
     ORDER BY FIELD(a.priority,'critical','high','medium','low'), a.created_at DESC`,
    [req.params.caregiverId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

app.get('/api/alerts/caregiver/:caregiverId/all', (req, res) => {
  db.query(
    `SELECT a.*, u.name as elder_name FROM alerts a JOIN users u ON a.user_id=u.id
     WHERE a.caregiver_id=? ORDER BY a.created_at DESC LIMIT ?`,
    [req.params.caregiverId, parseInt(req.query.limit) || 50],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

app.get('/api/alerts/elder/:elderId', (req, res) => {
  db.query(
    `SELECT * FROM alerts WHERE user_id=? AND is_read=0
     ORDER BY FIELD(priority,'critical','high','medium','low'), created_at DESC LIMIT 50`,
    [req.params.elderId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

app.put('/api/alerts/:id/read', (req, res) => {
  db.query('UPDATE alerts SET is_read=1 WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(400).json({ message: 'Failed' });
    res.json({ message: 'Alert marked as read' });
  });
});

app.put('/api/alerts/caregiver/:caregiverId/read-all', (req, res) => {
  db.query('UPDATE alerts SET is_read=1 WHERE caregiver_id=?', [req.params.caregiverId], (err) => {
    if (err) return res.status(400).json({ message: 'Failed' });
    res.json({ message: 'All alerts marked as read' });
  });
});

// =============================================================================
// OVERDUE
// =============================================================================
app.get('/api/overdue/:elderId', (req, res) => {
  db.query(
    `SELECT mi.*, m.name AS title, m.frequency AS type, m.time AS scheduled_time, m.dosage
     FROM medication_intake mi JOIN medications m ON mi.medication_id = m.id
     WHERE mi.user_id=? AND mi.is_overdue=1 AND DATE(mi.taken_at)=CURDATE()
     ORDER BY mi.taken_at DESC`,
    [req.params.elderId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

app.get('/api/overdue/caregiver/:caregiverId', (req, res) => {
  db.query(
    `SELECT mi.*, m.name AS title, m.frequency AS type, m.time AS scheduled_time,
            m.dosage, u.name AS elder_name, u.id AS elder_id
     FROM medication_intake mi
     JOIN medications m ON mi.medication_id = m.id
     JOIN users u ON mi.user_id = u.id
     JOIN connections c ON c.elder_id=u.id AND c.requester_id=? AND c.status='approved'
     WHERE mi.is_overdue=1 AND DATE(mi.taken_at)=CURDATE()
     ORDER BY mi.taken_at DESC`,
    [req.params.caregiverId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

app.get('/api/reminder-count/:medicationId/:userId', (req, res) => {
  const todayISO = new Date().toISOString().split('T')[0];
  db.query(
    `SELECT COUNT(*) as count FROM reminder_logs
     WHERE medication_id=? AND user_id=? AND scheduled_date=?`,
    [req.params.medicationId, req.params.userId, todayISO],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json({ count: rows[0]?.count || 0 });
    }
  );
});

// =============================================================================
// HEALTH RISKS HELPERS
// =============================================================================
function safeFloat(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}
function parseSystolic(val) {
  if (!val) return 120;
  const parts = String(val).split('/');
  return safeFloat(parts[0], 120);
}
function parseDiastolic(val) {
  if (!val) return 80;
  const parts = String(val).split('/');
  return safeFloat(parts[1] || parts[0], 80);
}

// =============================================================================
// HEALTH RISKS
// IMPORTANT: /ai/:elderId MUST be registered BEFORE /:elderId
// Otherwise Express matches :elderId = "ai" and the AI route is never reached
// =============================================================================

// ── GET /api/health-risks/ai/:elderId ── RF assessment (REGISTERED FIRST) ───
app.get('/api/health-risks/ai/:elderId', async (req, res) => {
  const elderId = parseInt(req.params.elderId);
  if (!elderId) return res.status(400).json({ message: 'Invalid elderId' });

  try {
    const now   = new Date();
    const ago30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const ago7  = new Date(now - 7  * 24 * 60 * 60 * 1000);
    const fmt   = d => d.toISOString().slice(0, 19).replace('T', ' ');

    // Latest vitals
    const latestVitals = await dbQuery(
      `SELECT log_type, value, logged_at
       FROM health_logs
       WHERE user_id = ? AND logged_at >= ?
       ORDER BY logged_at DESC`,
      [elderId, fmt(ago30)]
    );
    const byType = {};
    latestVitals.forEach(r => { if (!byType[r.log_type]) byType[r.log_type] = r; });

    const bp          = byType['blood_pressure'];
    const bpSys       = bp ? parseSystolic(bp.value)  : 120;
    const bpDia       = bp ? parseDiastolic(bp.value) : 80;
    const bloodSugar  = safeFloat(byType['blood_sugar']?.value,   100);
    const heartRate   = safeFloat(byType['heart_rate']?.value,     72);
    const temperature = safeFloat(byType['temperature']?.value,  98.6);

    // Weight change
    const weightRows = await dbQuery(
      `SELECT value FROM health_logs
       WHERE user_id = ? AND log_type = 'weight'
       ORDER BY logged_at DESC LIMIT 2`,
      [elderId]
    );
    const weightChange = weightRows.length >= 2
      ? safeFloat(weightRows[0].value) - safeFloat(weightRows[1].value)
      : 0;

    // Days since last reading
    const lastReadingRows = await dbQuery(
      `SELECT MAX(logged_at) AS last_at FROM health_logs WHERE user_id = ?`,
      [elderId]
    );
    const lastAt = lastReadingRows[0]?.last_at;
    const daysSinceLastReading = lastAt
      ? Math.floor((now - new Date(lastAt)) / (1000 * 60 * 60 * 24))
      : 7;

    // Reading count last 7 days
    const readingCount7dRows = await dbQuery(
      `SELECT COUNT(*) AS cnt FROM health_logs WHERE user_id = ? AND logged_at >= ?`,
      [elderId, fmt(ago7)]
    );
    const readingCount7d = readingCount7dRows[0]?.cnt || 0;

    // Rule-based risk flags last 7 days
    const flagRows = await dbQuery(
      `SELECT COUNT(*) AS cnt FROM health_risks WHERE elder_id = ? AND detected_at >= ?`,
      [elderId, fmt(ago7)]
    );
    const riskFlagCount7d = flagRows[0]?.cnt || 0;

    // Medication adherence
    let missedDoses7d = 0, missedDosesStreak = 0, medicationAdherencePct = 100;
    try {
      const medRows = await dbQuery(
        `SELECT DATE(taken_at) AS day, status
         FROM medication_intake
         WHERE user_id = ? AND taken_at >= ?
         ORDER BY taken_at DESC`,
        [elderId, fmt(ago7)]
      );
      if (medRows.length > 0) {
        const missed = medRows.filter(r => r.status === 'missed' || r.status === 'not_taken');
        const taken  = medRows.filter(r => r.status === 'taken');
        missedDoses7d          = missed.length;
        medicationAdherencePct = Math.round((taken.length / medRows.length) * 100);
        const missedDays = new Set(missed.map(r => new Date(r.day).toISOString().slice(0, 10)));
        let streak = 0;
        for (let i = 0; i < 7; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          if (missedDays.has(d.toISOString().slice(0, 10))) streak++;
          else break;
        }
        missedDosesStreak = streak;
      }
    } catch (_) {}

    // Missed reminders last 7 days
    let missedReminders7d = 0, reminderAdherencePct = 100;
    try {
      const remRows = await dbQuery(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END) AS ack
         FROM reminder_logs
         WHERE user_id = ? AND sent_at >= ?`,
        [elderId, fmt(ago7)]
      );
      const total = parseInt(remRows[0]?.total) || 0;
      const ack   = parseInt(remRows[0]?.ack)   || 0;
      if (total > 0) {
        missedReminders7d    = total - ack;
        reminderAdherencePct = Math.round((ack / total) * 100);
      }
    } catch (_) {}

    // Build feature payload for Django RF model
    const featurePayload = {
      elder_id:                 elderId,
      bp_sys:                   bpSys,
      bp_dia:                   bpDia,
      blood_sugar:              bloodSugar,
      heart_rate:               heartRate,
      temperature:              temperature,
      weight_change:            weightChange,
      missed_doses_7d:          missedDoses7d,
      missed_doses_streak:      missedDosesStreak,
      medication_adherence_pct: medicationAdherencePct,
      missed_routines_7d:       0,
      routine_adherence_pct:    100,
      missed_reminders_7d:      missedReminders7d,
      reminder_adherence_pct:   reminderAdherencePct,
      missed_appointments_7d:   0,
      total_missed_7d:          missedDoses7d + missedReminders7d,
      days_since_last_reading:  daysSinceLastReading,
      reading_count_7d:         readingCount7d,
      risk_flag_count_7d:       riskFlagCount7d,
    };

    // Call Django RF model
    const djangoResp = await fetch(`${DJANGO_REGRESSION_URL}/api/regression/risk/assess/`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(featurePayload),
    });

    if (!djangoResp.ok) {
      const errText = await djangoResp.text();
      console.error('[AI risk] Django error:', djangoResp.status, errText);
      return res.status(502).json({ error: 'Risk model service error', detail: errText });
    }

    const djangoData = await djangoResp.json();

    // Forward assessment as-is — screen reads data.assessment.risks
    return res.json({
      elder_id:     elderId,
      assessment:   djangoData.assessment,
      features:     featurePayload,
      generated_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('AI risk assessment error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// ── GET /api/health-risks/:elderId ── rule-based (REGISTERED AFTER /ai/) ────
app.get('/api/health-risks/:elderId', (req, res) => {
  db.query(
    `SELECT * FROM health_risks WHERE elder_id=? AND resolved=0 ORDER BY detected_at DESC`,
    [req.params.elderId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

// =============================================================================
// ACTIVITY LOGS
// =============================================================================
app.get('/api/activity/:elderId', (req, res) => {
  db.query(
    `SELECT * FROM activity_logs WHERE elder_id=?
     AND logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY logged_at DESC`,
    [req.params.elderId, parseInt(req.query.days) || 7],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

// =============================================================================
// ELDER SUMMARY
// =============================================================================
app.get('/api/elder-summary/:elderId', (req, res) => {
  const elderId = req.params.elderId;
  const result  = { todayHealthLogs: 0, todayMood: null, todayMedsTaken: 0, todayMedsTotal: 0, latestVitals: [], activeRisksCount: 0, unreadAlertsCount: 0, overdueCount: 0 };
  let pending = 7;
  const done  = () => { if (--pending === 0) res.json(result); };

  db.query(`SELECT COUNT(*) as count FROM health_logs WHERE user_id=? AND DATE(logged_at)=CURDATE()`, [elderId], (_, r) => { if (r && r[0]) result.todayHealthLogs = r[0].count || 0; done(); });
  db.query(`SELECT mood,logged_at FROM mood_logs WHERE user_id=? AND DATE(logged_at)=CURDATE() ORDER BY logged_at DESC LIMIT 1`, [elderId], (_, r) => { if (r && r.length) result.todayMood = r[0]; done(); });
  db.query(`SELECT COUNT(DISTINCT m.id) as total, SUM(CASE WHEN mi.status='taken' AND DATE(mi.taken_at)=CURDATE() THEN 1 ELSE 0 END) as taken FROM medications m LEFT JOIN medication_intake mi ON mi.medication_id=m.id WHERE m.user_id=?`, [elderId], (_, r) => { if (r && r[0]) { result.todayMedsTotal = r[0].total || 0; result.todayMedsTaken = r[0].taken || 0; } done(); });
  db.query(`SELECT h1.log_type,h1.value,h1.unit,h1.logged_at FROM health_logs h1 WHERE h1.user_id=? AND h1.logged_at=(SELECT MAX(h2.logged_at) FROM health_logs h2 WHERE h2.user_id=h1.user_id AND h2.log_type=h1.log_type) ORDER BY h1.logged_at DESC`, [elderId], (_, r) => { if (r) result.latestVitals = r; done(); });
  db.query(`SELECT COUNT(*) as count FROM health_risks WHERE elder_id=? AND resolved=0`, [elderId], (_, r) => { if (r && r[0]) result.activeRisksCount = r[0].count || 0; done(); });
  db.query(`SELECT COUNT(*) as count FROM alerts WHERE user_id=? AND is_read=0`, [elderId], (_, r) => { if (r && r[0]) result.unreadAlertsCount = r[0].count || 0; done(); });
  db.query(`SELECT COUNT(*) as count FROM medication_intake WHERE user_id=? AND is_overdue=1 AND DATE(taken_at)=CURDATE()`, [elderId], (_, r) => { if (r && r[0]) result.overdueCount = r[0].count || 0; done(); });
});

// =============================================================================
// REPORTS
// =============================================================================
app.get('/api/reports/weekly/:userId', (req, res) => {
  const userId = req.params.userId;
  let startDate, endDate, intervalDays;
  if (req.query.startDate && req.query.endDate) {
    startDate    = req.query.startDate; endDate = req.query.endDate;
    intervalDays = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
  } else {
    intervalDays = parseInt(req.query.days) || 7;
    const endD = new Date(), startD = new Date();
    startD.setDate(endD.getDate() - (intervalDays - 1));
    startDate = startD.toISOString().split('T')[0]; endDate = endD.toISOString().split('T')[0];
  }
  const queries = [
    [`SELECT COUNT(*) as total, SUM(CASE WHEN status='taken' THEN 1 ELSE 0 END) as taken, SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) as partial, SUM(CASE WHEN is_overdue=1 THEN 1 ELSE 0 END) as overdue FROM medication_intake WHERE user_id=? AND DATE(taken_at) BETWEEN ? AND ?`, [userId, startDate, endDate]],
    [`SELECT log_type, COUNT(*) as count, AVG(CASE WHEN log_type IN('blood_sugar','heart_rate','weight','temperature') THEN CAST(value AS DECIMAL(10,2)) ELSE NULL END) as avg_value, MAX(value) as max_value, MIN(value) as min_value FROM health_logs WHERE user_id=? AND DATE(logged_at) BETWEEN ? AND ? GROUP BY log_type`, [userId, startDate, endDate]],
    [`SELECT mood, COUNT(*) as count FROM mood_logs WHERE user_id=? AND DATE(logged_at) BETWEEN ? AND ? GROUP BY mood`, [userId, startDate, endDate]],
    [`SELECT COUNT(*) as alert_count FROM alerts WHERE user_id=? AND DATE(created_at) BETWEEN ? AND ?`, [userId, startDate, endDate]],
    [`SELECT risk_type, severity, message, detected_at FROM health_risks WHERE elder_id=? AND DATE(detected_at) BETWEEN ? AND ? ORDER BY detected_at DESC`, [userId, startDate, endDate]],
    [`SELECT activity_type, COUNT(*) as count, DATE(logged_at) as day FROM activity_logs WHERE elder_id=? AND DATE(logged_at) BETWEEN ? AND ? GROUP BY activity_type, DATE(logged_at) ORDER BY day DESC`, [userId, startDate, endDate]],
  ];
  let results = new Array(queries.length).fill(null), done = 0;
  queries.forEach(([sql, params], i) => {
    db.query(sql, params, (err, rows) => {
      if (!err) results[i] = rows;
      if (++done === queries.length) {
        const reportData = {
          medications: (results[0] && results[0][0]) || { total: 0, taken: 0, partial: 0, overdue: 0 },
          healthLogs:  results[1] || [], mood: results[2] || [],
          alerts:      (results[3] && results[3][0]) || { alert_count: 0 },
          risks:       results[4] || [], activity: results[5] || [],
          dateRange:   { startDate, endDate, days: intervalDays },
        };
        const moodJson   = JSON.stringify((results[2] || []).reduce((a, m) => { a[m.mood] = m.count; return a; }, {}));
        const healthJson = JSON.stringify((results[1] || []).reduce((a, h) => { a[h.log_type] = { count: h.count, avg: h.avg_value }; return a; }, {}));
        db.query(
          `INSERT INTO weekly_reports (elder_id,week_start,week_end,medications_total,medications_taken,health_logs_count,mood_summary,health_summary,alerts_count,generated_at)
           VALUES (?,?,?,?,?,?,?,?,?,NOW())
           ON DUPLICATE KEY UPDATE medications_total=VALUES(medications_total),medications_taken=VALUES(medications_taken),health_logs_count=VALUES(health_logs_count),mood_summary=VALUES(mood_summary),health_summary=VALUES(health_summary),alerts_count=VALUES(alerts_count),generated_at=NOW()`,
          [userId, startDate, endDate, reportData.medications.total || 0, reportData.medications.taken || 0, (results[1] || []).reduce((a, h) => a + h.count, 0), moodJson, healthJson, reportData.alerts.alert_count || 0],
          (saveErr) => { if (saveErr) console.log('Report save error:', saveErr.message); }
        );
        res.json(reportData);
      }
    });
  });
});

// =============================================================================
// SCHEDULES — CREATE
// =============================================================================
app.post('/api/schedules', (req, res) => {
  const { elderId, caregiverId, type, title, description, dosage, scheduledTime, scheduledDays, startDate, endDate, repeatInterval, maxReminders } = req.body;
  if (!elderId || !caregiverId || !type || !title || !scheduledTime || !scheduledDays || !startDate)
    return res.status(400).json({ message: 'Missing required fields' });
  db.query(
    `SELECT id FROM connections WHERE requester_id=? AND elder_id=? AND status='approved'`,
    [caregiverId, elderId],
    (err, rows) => {
      if (err || !rows || !rows.length) return res.status(403).json({ message: 'Not authorised for this elder' });
      const notesBlob = JSON.stringify({
        desc: description || null, days: scheduledDays, startDate,
        endDate: endDate || null, interval: repeatInterval || 30,
        maxRem: maxReminders || 3, cgId: caregiverId,
      });
      db.query(
        `INSERT INTO medications (user_id,name,dosage,frequency,time,notes) VALUES (?,?,?,?,?,?)`,
        [elderId, title, dosage || null, type, scheduledTime, notesBlob],
        (err2, result) => {
          if (err2) return res.status(400).json({ message: 'DB error: ' + err2.message });
          const medId = result.insertId;
          db.query(`INSERT INTO medication_reminder (medication_id,reminder_time,is_active) VALUES (?,?,1)`, [medId, scheduledTime], () => {});
          db.query(`INSERT INTO alerts (user_id,caregiver_id,alert_type,message,is_read,priority,created_at) VALUES (?,?,'schedule',?,0,'medium',NOW())`, [elderId, caregiverId, `📅 New ${type} scheduled: "${title}" — starts ${startDate}`], () => {});
          db.query('SELECT expo_push_token FROM users WHERE id=?', [elderId], async (_, uRows) => {
            if (uRows && uRows[0] && uRows[0].expo_push_token) {
              await sendPushNotification(uRows[0].expo_push_token, '📅 New Schedule Added', `Your caregiver scheduled "${title}" for you starting ${startDate}`, { screen: 'TodayReminders' });
            }
          });
          res.json({ message: 'Schedule created', scheduleId: medId });
        }
      );
    }
  );
});

app.get('/api/schedules/caregiver/:caregiverId', (req, res) => {
  db.query(
    `SELECT m.*, u.name AS elder_name FROM medications m
     JOIN users u ON m.user_id=u.id
     JOIN connections c ON c.elder_id=u.id AND c.requester_id=? AND c.status='approved'
     ORDER BY u.name, m.time`,
    [req.params.caregiverId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });
      res.json((rows || []).filter(r => { const m = parseMeta(r.notes); return m && String(m.cgId) === String(req.params.caregiverId); }).map(r => toScheduleShape(r)));
    }
  );
});

app.get('/api/schedules/elder/:elderId', (req, res) => {
  db.query(`SELECT m.* FROM medications m WHERE m.user_id=? ORDER BY m.time`, [req.params.elderId], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json((rows || []).filter(r => parseMeta(r.notes)).map(r => toScheduleShape(r)));
  });
});

// =============================================================================
// SCHEDULES/TODAY
// =============================================================================
app.get('/api/schedules/today/:elderId', (req, res) => {
  const todayISO = new Date().toISOString().split('T')[0];

  db.query(
    `SELECT m.*,
       mi.id              AS log_id,
       mi.status          AS intake_status,
       mi.is_overdue,
       mi.snooze_until,
       mi.snooze_count,
       mi.partial_dose,
       mi.actual_taken_at,
       mi.notes           AS response_note,
       (SELECT COUNT(*) FROM reminder_logs rl
        WHERE rl.medication_id=m.id AND rl.user_id=m.user_id
          AND rl.scheduled_date=?) AS reminded_count
     FROM medications m
     LEFT JOIN medication_intake mi
       ON mi.id = (
         SELECT id FROM medication_intake
         WHERE medication_id  = m.id
           AND user_id        = m.user_id
           AND DATE(taken_at) = CURDATE()
         ORDER BY taken_at DESC
         LIMIT 1
       )
     WHERE m.user_id=?
     ORDER BY m.time`,
    [todayISO, req.params.elderId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });

      const schedRows = (rows || []).filter(r => {
        const meta = parseMeta(r.notes);
        if (!meta) return false;
        if (meta.startDate && todayISO < meta.startDate) return false;
        if (meta.endDate   && todayISO > meta.endDate)   return false;
        return isScheduledToday(meta.days);
      });

      if (!schedRows.length) return res.json([]);

      const output = schedRows.map(r => {
        const meta = parseMeta(r.notes) || {};
        let log_status = null;
        if      (r.is_overdue)                    log_status = 'overdue';
        else if (r.intake_status === 'taken')     log_status = 'done';
        else if (r.intake_status === 'partial')   log_status = 'partial';
        else if (r.intake_status === 'snoozed')   log_status = 'snoozed';
        else if (r.intake_status === 'not_taken') log_status = 'not_taken';
        else if (r.intake_status === 'missed')    log_status = 'skipped';

        return {
          id:              r.id,
          type:            r.frequency       || 'medicine',
          title:           r.name,
          description:     meta.desc         || null,
          dosage:          r.dosage          || null,
          scheduled_time:  r.time,
          caregiver_name:  null,
          repeat_interval: meta.interval     || 30,
          max_reminders:   meta.maxRem       || 3,
          log_id:          r.log_id          || null,
          log_status,
          is_overdue:      r.is_overdue      || 0,
          reminded_count:  r.reminded_count  || 0,
          snooze_until:    r.snooze_until    || null,
          snooze_count:    r.snooze_count    || 0,
          partial_dose:    r.partial_dose    || null,
          actual_taken_at: r.actual_taken_at || null,
          response_note:   r.response_note   || null,
          _cgId:           meta.cgId,
        };
      });

      const cgIds = [...new Set(output.map(o => o._cgId).filter(Boolean))];
      if (!cgIds.length) { output.forEach(o => delete o._cgId); return res.json(output); }

      db.query(`SELECT id, name FROM users WHERE id IN (?)`, [cgIds], (_, cgRows) => {
        const cgMap = {};
        (cgRows || []).forEach(u => { cgMap[u.id] = u.name; });
        output.forEach(o => { o.caregiver_name = cgMap[o._cgId] || 'Caregiver'; delete o._cgId; });
        res.json(output);
      });
    }
  );
});

// =============================================================================
// SCHEDULES/TODAY/CAREGIVER
// =============================================================================
app.get('/api/schedules/today/caregiver/:caregiverId', (req, res) => {
  const todayISO = new Date().toISOString().split('T')[0];
  const elderFilter = req.query.elderId || null;

  let elderSQL = '';
  const queryParams = [todayISO, req.params.caregiverId];
  if (elderFilter) {
    elderSQL = 'AND m.user_id = ?';
    queryParams.push(elderFilter);
  }

  db.query(
    `SELECT
       m.*,
       u.name            AS elder_name,
       u.id              AS elder_id,
       mi.id             AS log_id,
       mi.status         AS intake_status,
       mi.is_overdue,
       mi.snooze_until,
       mi.snooze_count,
       mi.partial_dose,
       mi.actual_taken_at,
       mi.notes          AS response_note,
       (SELECT COUNT(*)
        FROM reminder_logs rl
        WHERE rl.medication_id = m.id
          AND rl.user_id       = m.user_id
          AND rl.scheduled_date = ?) AS reminded_count
     FROM medications m
     JOIN users u ON u.id = m.user_id
     JOIN connections c ON c.elder_id = u.id AND c.requester_id = ? AND c.status = 'approved'
     LEFT JOIN medication_intake mi
       ON mi.id = (
         SELECT id FROM medication_intake
         WHERE medication_id  = m.id
           AND user_id        = m.user_id
           AND DATE(taken_at) = CURDATE()
         ORDER BY taken_at DESC
         LIMIT 1
       )
     WHERE m.notes IS NOT NULL ${elderSQL}
     ORDER BY u.name, m.time`,
    queryParams,
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });

      const nowStr = new Date().toTimeString().slice(0, 5);
      const output = [];

      (rows || []).forEach(r => {
        const meta = parseMeta(r.notes);
        if (!meta) return;
        if (meta.startDate && todayISO < meta.startDate) return;
        if (meta.endDate   && todayISO > meta.endDate)   return;
        if (!isScheduledToday(meta.days)) return;

        const scheduledTime = r.time || '00:00';
        const reminderCount = r.reminded_count || 0;
        const maxReminders  = meta.maxRem || 3;
        const intakeStatus  = r.intake_status;
        const isOverdue     = r.is_overdue || 0;

        let visual_state;
        if (isOverdue) {
          visual_state = 'overdue';
        } else if (intakeStatus === 'taken') {
          visual_state = 'taken';
        } else if (intakeStatus === 'partial') {
          visual_state = 'partial';
        } else if (intakeStatus === 'not_taken') {
          visual_state = 'not_taken';
        } else if (intakeStatus === 'missed') {
          visual_state = 'not_taken';
        } else if (intakeStatus === 'snoozed' && r.snooze_until && new Date(r.snooze_until) > new Date()) {
          visual_state = 'snoozed';
        } else if (nowStr < scheduledTime) {
          visual_state = 'upcoming';
        } else if (reminderCount >= maxReminders) {
          visual_state = 'overdue';
        } else if (reminderCount > 0) {
          visual_state = 'reminded';
        } else {
          visual_state = 'pending';
        }

        output.push({
          id:              r.id,
          elder_id:        r.elder_id,
          elder_name:      r.elder_name,
          type:            r.frequency      || 'medicine',
          title:           r.name,
          description:     meta.desc        || null,
          dosage:          r.dosage         || null,
          scheduled_time:  scheduledTime,
          repeat_interval: meta.interval    || 30,
          max_reminders:   maxReminders,
          log_id:          r.log_id         || null,
          intake_status:   intakeStatus     || null,
          is_overdue:      isOverdue,
          reminded_count:  reminderCount,
          snooze_until:    r.snooze_until   || null,
          snooze_count:    r.snooze_count   || 0,
          partial_dose:    r.partial_dose   || null,
          actual_taken_at: r.actual_taken_at || null,
          response_note:   r.response_note  || null,
          visual_state,
        });
      });

      res.json(output);
    }
  );
});

// =============================================================================
// SCHEDULES/DATE/CAREGIVER
// =============================================================================
app.get('/api/schedules/date/caregiver/:caregiverId', (req, res) => {
  const dateISO     = req.query.date || new Date().toISOString().split('T')[0];
  const elderFilter = req.query.elderId || null;

  let elderSQL = '';
  if (elderFilter) elderSQL = 'AND m.user_id = ?';
  const queryParams = [dateISO, req.params.caregiverId, dateISO, ...(elderFilter ? [elderFilter] : [])];

  db.query(
    `SELECT
       m.*,
       u.name             AS elder_name,
       u.id               AS elder_id,
       mi.id              AS log_id,
       mi.status          AS intake_status,
       mi.is_overdue,
       mi.snooze_until,
       mi.snooze_count,
       mi.partial_dose,
       mi.actual_taken_at,
       mi.notes           AS response_note,
       (SELECT COUNT(*)
        FROM reminder_logs rl
        WHERE rl.medication_id  = m.id
          AND rl.user_id        = m.user_id
          AND rl.scheduled_date = ?) AS reminded_count
     FROM medications m
     JOIN users u ON u.id = m.user_id
     JOIN connections c ON c.elder_id = u.id AND c.requester_id = ? AND c.status = 'approved'
     LEFT JOIN medication_intake mi
       ON mi.id = (
         SELECT id FROM medication_intake
         WHERE medication_id  = m.id
           AND user_id        = m.user_id
           AND DATE(taken_at) = ?
         ORDER BY taken_at DESC
         LIMIT 1
       )
     WHERE m.notes IS NOT NULL ${elderSQL}
     ORDER BY u.name, m.time`,
    queryParams,
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });

      const isPast = dateISO < new Date().toISOString().split('T')[0];
      const output = [];

      (rows || []).forEach(r => {
        const meta = parseMeta(r.notes);
        if (!meta) return;
        if (meta.startDate && dateISO < meta.startDate) return;
        if (meta.endDate   && dateISO > meta.endDate)   return;
        if (!isScheduledOnDate(meta.days, dateISO))     return;

        const scheduledTime = r.time        || '00:00';
        const reminderCount = r.reminded_count || 0;
        const maxReminders  = meta.maxRem   || 3;
        const intakeStatus  = r.intake_status;
        const isOverdue     = r.is_overdue  || 0;

        let visual_state;
        if (isOverdue) {
          visual_state = 'overdue';
        } else if (intakeStatus === 'taken') {
          visual_state = 'taken';
        } else if (intakeStatus === 'partial') {
          visual_state = 'partial';
        } else if (intakeStatus === 'not_taken' || intakeStatus === 'missed') {
          visual_state = 'not_taken';
        } else if (intakeStatus === 'snoozed') {
          visual_state = isPast ? 'not_taken' : 'snoozed';
        } else if (!intakeStatus && isPast && reminderCount > 0) {
          visual_state = 'overdue';
        } else if (!intakeStatus && isPast) {
          visual_state = 'pending';
        } else if (reminderCount >= maxReminders) {
          visual_state = 'overdue';
        } else if (reminderCount > 0) {
          visual_state = 'reminded';
        } else {
          visual_state = 'pending';
        }

        output.push({
          id:              r.id,
          elder_id:        r.elder_id,
          elder_name:      r.elder_name,
          type:            r.frequency     || 'medicine',
          title:           r.name,
          description:     meta.desc       || null,
          dosage:          r.dosage        || null,
          scheduled_time:  scheduledTime,
          repeat_interval: meta.interval   || 30,
          max_reminders:   maxReminders,
          log_id:          r.log_id        || null,
          intake_status:   intakeStatus    || null,
          is_overdue:      isOverdue,
          reminded_count:  reminderCount,
          snooze_until:    r.snooze_until  || null,
          snooze_count:    r.snooze_count  || 0,
          partial_dose:    r.partial_dose  || null,
          actual_taken_at: r.actual_taken_at || null,
          response_note:   r.response_note || null,
          visual_state,
        });
      });

      res.json(output);
    }
  );
});

app.put('/api/schedules/:id', (req, res) => {
  const { title, description, dosage, scheduledTime, scheduledDays, endDate, repeatInterval, maxReminders } = req.body;
  db.query(`SELECT notes FROM medications WHERE id=?`, [req.params.id], (err, rows) => {
    if (err || !rows || !rows.length) return res.status(404).json({ message: 'Not found' });
    const ex = parseMeta(rows[0].notes) || {};
    const notesBlob = JSON.stringify({
      desc:      description !== undefined ? description || null : ex.desc,
      days:      scheduledDays             || ex.days             || ['daily'],
      startDate: ex.startDate              || new Date().toISOString().split('T')[0],
      endDate:   endDate !== undefined     ? endDate || null      : ex.endDate,
      interval:  repeatInterval            || ex.interval         || 30,
      maxRem:    maxReminders              || ex.maxRem           || 3,
      cgId:      ex.cgId,
    });
    db.query(`UPDATE medications SET name=?, dosage=?, time=?, notes=? WHERE id=?`, [title, dosage || null, scheduledTime, notesBlob, req.params.id], (err2) => {
      if (err2) return res.status(400).json({ message: 'Failed: ' + err2.message });
      db.query(`UPDATE medication_reminder SET reminder_time=? WHERE medication_id=?`, [scheduledTime, req.params.id], () => {});
      res.json({ message: 'Schedule updated' });
    });
  });
});

app.delete('/api/schedules/:id', (req, res) => {
  db.query(`UPDATE medication_reminder SET is_active=0 WHERE medication_id=?`, [req.params.id], () => {});
  db.query(`DELETE FROM medications WHERE id=?`, [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: 'Failed' });
    res.json({ message: 'Schedule removed' });
  });
});

// =============================================================================
// SCHEDULES/RESPOND
// =============================================================================
app.post('/api/schedules/respond', (req, res) => {
  const { scheduleId, elderId, status, responseNote, partialDose, snoozeDuration } = req.body;

  const intakeStatus =
    status === 'done'      ? 'taken'     :
    status === 'partial'   ? 'partial'   :
    status === 'snooze'    ? 'snoozed'   :
    status === 'not_taken' ? 'not_taken' : 'missed';

  const isTerminalPositive = (status === 'done' || status === 'partial');
  const actualTakenAt      = isTerminalPositive ? new Date() : null;
  const snoozeUntil        = (status === 'snooze' && snoozeDuration)
    ? new Date(Date.now() + snoozeDuration * 60000)
    : null;

  db.query(
    `SELECT id, is_overdue, snooze_count FROM medication_intake
     WHERE medication_id=? AND user_id=? AND DATE(taken_at)=CURDATE()
     ORDER BY taken_at DESC LIMIT 1`,
    [scheduleId, elderId],
    (err, existing) => {
      if (err) return res.status(500).json({ message: 'Error' });

      const existingRow    = existing && existing[0] ? existing[0] : null;
      const newSnoozeCount = (status === 'snooze')
        ? (existingRow ? (existingRow.snooze_count || 0) + 1 : 1)
        : (existingRow ? existingRow.snooze_count || 0 : 0);

      const afterSave = (saveErr) => {
        if (saveErr) return res.status(400).json({ message: 'Failed: ' + saveErr.message });

        db.query('SELECT name, notes, frequency FROM medications WHERE id=?', [scheduleId], (_, rows) => {
          if (!rows || !rows.length) return;
          const { name, notes, frequency } = rows[0];
          const meta = parseMeta(notes) || {};
          const type = frequency || 'medicine';

          logActivity(
            elderId,
            isTerminalPositive ? 'medication_taken' : 'medication_missed',
            `${intakeStatus === 'taken' ? '✅' : intakeStatus === 'partial' ? '💊' : intakeStatus === 'snoozed' ? '😴' : intakeStatus === 'not_taken' ? '❌' : '⏭'} "${name}" (${type})` +
            (responseNote   ? ': ' + responseNote                       : '') +
            (partialDose    ? ' — partial: ' + partialDose              : '') +
            (snoozeDuration ? ` — snoozed ${snoozeDuration}min`         : '')
          );

          if (isTerminalPositive) {
            const todayISO = new Date().toISOString().split('T')[0];
            db.query(
              `UPDATE reminder_logs SET status='responded'
               WHERE medication_id=? AND user_id=? AND scheduled_date=?`,
              [scheduleId, elderId, todayISO],
              () => {}
            );
          }

          if (meta.cgId) {
            const wasOverdue = existingRow && existingRow.is_overdue;
            const priority   = isTerminalPositive ? 'low' : wasOverdue ? 'high' : status === 'snooze' ? 'low' : 'medium';
            const alertMsg   =
              status === 'done'      ? `✅ "${name}" marked as taken${responseNote ? ': ' + responseNote : ''}` :
              status === 'partial'   ? `💊 "${name}" partial dose${partialDose ? ' (' + partialDose + ')' : ''}${responseNote ? ': ' + responseNote : ''}` :
              status === 'snooze'    ? `😴 "${name}" snoozed for ${snoozeDuration} minutes` :
              status === 'not_taken' ? `❌ "${name}" not taken this cycle` :
              `⏭ "${name}" skipped${responseNote ? ': ' + responseNote : ''}`;

            db.query(
              `INSERT INTO alerts (user_id,caregiver_id,alert_type,message,is_read,priority,created_at)
               VALUES (?,?,'schedule_response',?,0,?,NOW())`,
              [elderId, meta.cgId, alertMsg, priority],
              () => {}
            );
            sendCaregiverPush(
              meta.cgId,
              status === 'done'      ? '✅ Task Completed' :
              status === 'partial'   ? '💊 Partial Dose'  :
              status === 'snooze'    ? '😴 Task Snoozed'  :
              status === 'not_taken' ? '❌ Not Taken'     : '⏭ Task Skipped',
              alertMsg
            );
          }
        });

        res.json({ message: 'Response recorded' });
      };

      if (existingRow) {
        db.query(
          `UPDATE medication_intake
           SET status          = ?,
               notes           = ?,
               taken_at        = NOW(),
               is_overdue      = 0,
               partial_dose    = ?,
               snooze_until    = ?,
               snooze_count    = ?,
               actual_taken_at = ?
           WHERE id = ?`,
          [intakeStatus, responseNote || null, partialDose || null, snoozeUntil, newSnoozeCount, actualTakenAt, existingRow.id],
          (uErr) => afterSave(uErr)
        );
      } else {
        db.query(
          `INSERT INTO medication_intake
             (medication_id, user_id, taken_at, status, notes, is_overdue,
              partial_dose, snooze_until, snooze_count, actual_taken_at)
           VALUES (?,?,NOW(),?,?,0,?,?,?,?)`,
          [scheduleId, elderId, intakeStatus, responseNote || null, partialDose || null, snoozeUntil, newSnoozeCount, actualTakenAt],
          (iErr) => afterSave(iErr)
        );
      }
    }
  );
});

app.get('/api/schedules/compliance/:elderId', (req, res) => {
  const start = req.query.startDate || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const end   = req.query.endDate   || new Date().toISOString().split('T')[0];
  db.query(
    `SELECT m.id, m.frequency AS type, m.name AS title,
       COUNT(mi.id)                                                 AS total_logged,
       SUM(CASE WHEN mi.status='taken'     THEN 1 ELSE 0 END)      AS done_count,
       SUM(CASE WHEN mi.status='partial'   THEN 1 ELSE 0 END)      AS partial_count,
       SUM(CASE WHEN mi.status='not_taken' THEN 1 ELSE 0 END)      AS not_taken_count,
       SUM(CASE WHEN mi.status='missed'    THEN 1 ELSE 0 END)      AS skipped_count,
       SUM(CASE WHEN mi.is_overdue=1       THEN 1 ELSE 0 END)      AS overdue_count
     FROM medications m
     LEFT JOIN medication_intake mi
       ON mi.medication_id=m.id AND DATE(mi.taken_at) BETWEEN ? AND ?
     WHERE m.user_id=?
     GROUP BY m.id, m.frequency, m.name
     ORDER BY m.frequency, m.name`,
    [start, end, req.params.elderId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(rows || []);
    }
  );
});

app.get('/api/schedules/today-summary/:elderId', (req, res) => {
  const todayISO = new Date().toISOString().split('T')[0];
  db.query(
    `SELECT m.*, mi.status AS intake_status, mi.is_overdue
     FROM medications m
     LEFT JOIN medication_intake mi
       ON mi.id = (
         SELECT id FROM medication_intake
         WHERE medication_id=m.id AND user_id=m.user_id AND DATE(taken_at)=CURDATE()
         ORDER BY taken_at DESC LIMIT 1
       )
     WHERE m.user_id=?`,
    [req.params.elderId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error' });
      const schedRows = (rows || []).filter(r => {
        const meta = parseMeta(r.notes);
        if (!meta) return false;
        if (meta.startDate && todayISO < meta.startDate) return false;
        if (meta.endDate   && todayISO > meta.endDate)   return false;
        return isScheduledToday(meta.days);
      });
      const total    = schedRows.length;
      const done     = schedRows.filter(r => r.intake_status === 'taken').length;
      const partial  = schedRows.filter(r => r.intake_status === 'partial').length;
      const snoozed  = schedRows.filter(r => r.intake_status === 'snoozed').length;
      const notTaken = schedRows.filter(r => r.intake_status === 'not_taken').length;
      const skipped  = schedRows.filter(r => r.intake_status === 'missed' && !r.is_overdue).length;
      const overdue  = schedRows.filter(r => r.is_overdue).length;
      const pending  = total - done - partial - snoozed - notTaken - skipped - overdue;
      res.json({ total, done, partial, snoozed, not_taken: notTaken, skipped, overdue, pending });
    }
  );
});

// =============================================================================
// MEDICATION ACTIVITY FEED
// =============================================================================
app.get('/api/medication-activity/:elderId', (req, res) => {
  const elderId    = req.params.elderId;
  const days       = parseInt(req.query.days) || 7;
  const dateFilter = req.query.date || null;

  const intakeParams   = [elderId];
  const reminderParams = [elderId];
  const intakeDateSQL   = buildDateClause('mi.taken_at', dateFilter, days, intakeParams);
  const reminderDateSQL = buildDateClause('rl.sent_at',  dateFilter, days, reminderParams);

  db.query(
    `(SELECT
       'intake'         AS source,
       mi.id, mi.medication_id,
       mi.user_id       AS elder_id,
       mi.status, mi.is_overdue,
       mi.notes         AS response_note,
       mi.partial_dose,
       mi.snooze_until,
       mi.snooze_count,
       mi.actual_taken_at,
       mi.taken_at      AS event_time,
       m.name AS title, m.frequency AS type,
       m.time AS scheduled_time, m.dosage,
       NULL             AS attempt_number,
       0                AS is_nudge
     FROM medication_intake mi
     JOIN medications m ON mi.medication_id = m.id
     WHERE mi.user_id = ? ${intakeDateSQL})

     UNION ALL

     (SELECT
       'reminder'       AS source,
       rl.id, rl.medication_id,
       rl.user_id       AS elder_id,
       rl.status, 0     AS is_overdue,
       NULL AS response_note, NULL AS partial_dose,
       NULL AS snooze_until,  NULL AS snooze_count,
       NULL AS actual_taken_at,
       rl.sent_at       AS event_time,
       m.name AS title, m.frequency AS type,
       m.time AS scheduled_time, m.dosage,
       rl.attempt_number,
       rl.is_nudge
     FROM reminder_logs rl
     JOIN medications m ON rl.medication_id = m.id
     WHERE rl.user_id = ? ${reminderDateSQL})

     ORDER BY event_time DESC LIMIT 200`,
    [...intakeParams, ...reminderParams],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });
      res.json(results || []);
    }
  );
});

app.get('/api/medication-activity/caregiver/:caregiverId', (req, res) => {
  const caregiverId = req.params.caregiverId;
  const days        = parseInt(req.query.days) || 7;
  const dateFilter  = req.query.date    || null;
  const elderFilter = req.query.elderId || null;

  const intakeParams   = [caregiverId];
  const reminderParams = [caregiverId];
  const intakeDateSQL   = buildDateClause('mi.taken_at', dateFilter, days, intakeParams);
  const reminderDateSQL = buildDateClause('rl.sent_at',  dateFilter, days, reminderParams);

  let elderIntakeSQL = '', elderReminderSQL = '';
  if (elderFilter) {
    intakeParams.push(elderFilter);
    reminderParams.push(elderFilter);
    elderIntakeSQL   = 'AND u.id = ?';
    elderReminderSQL = 'AND u.id = ?';
  }

  db.query(
    `(SELECT
       'intake'         AS source,
       mi.id, mi.medication_id,
       mi.user_id       AS elder_id, u.name AS elder_name,
       mi.status, mi.is_overdue,
       mi.notes         AS response_note,
       mi.partial_dose,
       mi.snooze_until,
       mi.snooze_count,
       mi.actual_taken_at,
       mi.taken_at      AS event_time,
       m.name AS title, m.frequency AS type,
       m.time AS scheduled_time, m.dosage,
       NULL             AS attempt_number,
       0                AS is_nudge
     FROM medication_intake mi
     JOIN medications m ON mi.medication_id = m.id
     JOIN users u ON mi.user_id = u.id
     JOIN connections c ON c.elder_id=u.id AND c.requester_id=? AND c.status='approved'
     WHERE 1=1 ${intakeDateSQL} ${elderIntakeSQL})

     UNION ALL

     (SELECT
       'reminder'       AS source,
       rl.id, rl.medication_id,
       rl.user_id       AS elder_id, u.name AS elder_name,
       rl.status, 0     AS is_overdue,
       NULL AS response_note, NULL AS partial_dose,
       NULL AS snooze_until,  NULL AS snooze_count,
       NULL AS actual_taken_at,
       rl.sent_at       AS event_time,
       m.name AS title, m.frequency AS type,
       m.time AS scheduled_time, m.dosage,
       rl.attempt_number,
       rl.is_nudge
     FROM reminder_logs rl
     JOIN medications m ON rl.medication_id = m.id
     JOIN users u ON rl.user_id = u.id
     JOIN connections c ON c.elder_id=u.id AND c.requester_id=? AND c.status='approved'
     WHERE 1=1 ${reminderDateSQL} ${elderReminderSQL})

     ORDER BY event_time DESC LIMIT 500`,
    [...intakeParams, ...reminderParams],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });

      let filtered = results || [];

      const statusFilter = req.query.status;
      if (statusFilter) {
        const statuses = statusFilter.split(',').map(s => s.trim().toLowerCase());
        filtered = filtered.filter(item => {
          if (item.source === 'reminder')          return statuses.includes('pending') || statuses.includes('reminder');
          if (item.is_overdue)                     return statuses.includes('overdue');
          if (item.status === 'taken')             return statuses.includes('taken');
          if (item.status === 'partial')           return statuses.includes('partial');
          if (item.status === 'snoozed')           return statuses.includes('snoozed');
          if (item.status === 'not_taken')         return statuses.includes('not_taken') || statuses.includes('missed');
          if (item.status === 'missed')            return statuses.includes('missed');
          return false;
        });
      }

      res.json(filtered);
    }
  );
});

// =============================================================================
// ADHERENCE
// =============================================================================
app.get('/api/adherence/:elderId', (req, res) => {
  const elderId = req.params.elderId;
  const days    = Math.min(parseInt(req.query.days) || 7, 30);

  const dateList = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dateList.push(d.toISOString().split('T')[0]);
  }
  const startDate = dateList[dateList.length - 1];
  const endDate   = dateList[0];

  db.query(
    `SELECT m.*,
       (SELECT GROUP_CONCAT(mi2.status ORDER BY mi2.taken_at DESC SEPARATOR '|')
        FROM medication_intake mi2
        WHERE mi2.medication_id = m.id
          AND mi2.user_id       = m.user_id
          AND DATE(mi2.taken_at) BETWEEN ? AND ?
       ) AS intake_statuses,
       (SELECT GROUP_CONCAT(DATE(mi3.taken_at) ORDER BY mi3.taken_at DESC SEPARATOR '|')
        FROM medication_intake mi3
        WHERE mi3.medication_id = m.id
          AND mi3.user_id       = m.user_id
          AND DATE(mi3.taken_at) BETWEEN ? AND ?
       ) AS intake_dates,
       (SELECT GROUP_CONCAT(CONCAT(DATE(mi4.taken_at),':', mi4.status, ':', IFNULL(mi4.is_overdue,0)) ORDER BY mi4.taken_at DESC SEPARATOR '|')
        FROM medication_intake mi4
        WHERE mi4.medication_id = m.id
          AND mi4.user_id       = m.user_id
          AND DATE(mi4.taken_at) BETWEEN ? AND ?
       ) AS daily_detail
     FROM medications m
     WHERE m.user_id = ?`,
    [startDate, endDate, startDate, endDate, startDate, endDate, elderId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });

      const DAY_NAMES_ADH = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const results = [];
      let overallDue = 0, overallDone = 0;

      (rows || []).forEach(r => {
        const meta = parseMeta(r.notes);
        if (!meta) return;

        const scheduledDays = meta.days || ['daily'];
        const medStart      = meta.startDate || startDate;
        const medEnd        = meta.endDate   || endDate;

        const dailyMap = {};
        if (r.daily_detail) {
          r.daily_detail.split('|').forEach(entry => {
            const [date, status, isOvr] = entry.split(':');
            if (!dailyMap[date] || isOvr === '1') {
              dailyMap[date] = { status, is_overdue: isOvr === '1' };
            }
          });
        }

        let daysDue = 0, daysTaken = 0, daysPartial = 0,
            daysMissed = 0, daysOverdue = 0, daysNoData = 0;

        const dailyBreakdown = dateList.map(iso => {
          const dayName = DAY_NAMES_ADH[new Date(iso + 'T12:00:00').getDay()];
          const isDue =
            iso >= medStart && iso <= medEnd &&
            (scheduledDays.includes('daily') || scheduledDays.includes('everyday') ||
             scheduledDays.includes(dayName) || scheduledDays.includes(dayName.toLowerCase()));

          let outcome = 'not_scheduled';
          if (isDue) {
            daysDue++;
            const d = dailyMap[iso];
            if (!d) {
              outcome = iso === endDate ? 'pending' : 'missed';
              if (iso !== endDate) daysMissed++;
              else daysNoData++;
            } else if (d.is_overdue || d.status === 'missed') {
              outcome = 'overdue'; daysOverdue++;
            } else if (d.status === 'taken') {
              outcome = 'taken'; daysTaken++;
            } else if (d.status === 'partial') {
              outcome = 'partial'; daysPartial++;
            } else if (d.status === 'not_taken') {
              outcome = 'skipped'; daysMissed++;
            } else if (d.status === 'snoozed') {
              outcome = 'pending'; daysNoData++;
            } else {
              outcome = 'pending'; daysNoData++;
            }
          }

          return { date: iso, outcome };
        });

        const adherencePct = daysDue > 0
          ? Math.round(((daysTaken + daysPartial * 0.5) / daysDue) * 100)
          : null;

        overallDue  += daysDue;
        overallDone += daysTaken + daysPartial * 0.5;

        results.push({
          id:             r.id,
          title:          r.name,
          type:           r.frequency || 'medicine',
          dosage:         r.dosage    || null,
          scheduled_time: r.time,
          scheduled_days: scheduledDays,
          days_due:       daysDue,
          days_taken:     daysTaken,
          days_partial:   daysPartial,
          days_missed:    daysMissed,
          days_overdue:   daysOverdue,
          adherence_pct:  adherencePct,
          daily_breakdown: dailyBreakdown.reverse(),
        });
      });

      results.sort((a, b) => {
        if (a.adherence_pct === null) return 1;
        if (b.adherence_pct === null) return -1;
        return a.adherence_pct - b.adherence_pct;
      });

      const overallPct = overallDue > 0
        ? Math.round((overallDone / overallDue) * 100)
        : null;

      res.json({
        elder_id:    elderId,
        period_days: days,
        start_date:  startDate,
        end_date:    endDate,
        overall_adherence_pct: overallPct,
        overall_days_due:      overallDue,
        overall_days_done:     Math.round(overallDone),
        medications: results,
      });
    }
  );
});

// Caregiver adherence summary
app.get('/api/adherence/caregiver/:caregiverId', (req, res) => {
  const caregiverId = req.params.caregiverId;
  const days        = Math.min(parseInt(req.query.days) || 7, 30);
  const elderFilter = req.query.elderId || null;

  let elderSQL = '';
  const params = [caregiverId];
  if (elderFilter) { elderSQL = 'AND u.id = ?'; params.push(elderFilter); }

  db.query(
    `SELECT u.id, u.name FROM users u
     JOIN connections c ON c.elder_id = u.id AND c.requester_id = ? AND c.status = 'approved'
     WHERE 1=1 ${elderSQL}`,
    params,
    async (err, elders) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });
      if (!elders || !elders.length) return res.json([]);

      const results = await Promise.all(elders.map(elder => {
        return new Promise((resolve) => {
          const dateList = [];
          for (let i = 0; i < days; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            dateList.push(d.toISOString().split('T')[0]);
          }
          const startDate = dateList[dateList.length - 1];
          const endDate   = dateList[0];
          const DAY_NAMES_CG = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

          db.query(
            `SELECT m.*,
               (SELECT GROUP_CONCAT(CONCAT(DATE(mi4.taken_at),':', mi4.status, ':', IFNULL(mi4.is_overdue,0)) ORDER BY mi4.taken_at DESC SEPARATOR '|')
                FROM medication_intake mi4
                WHERE mi4.medication_id = m.id AND mi4.user_id = m.user_id
                  AND DATE(mi4.taken_at) BETWEEN ? AND ?
               ) AS daily_detail
             FROM medications m WHERE m.user_id = ?`,
            [startDate, endDate, elder.id],
            (err2, rows) => {
              if (err2) return resolve({ elder_id: elder.id, elder_name: elder.name, overall_adherence_pct: null, total_meds: 0, critical_count: 0 });

              let overallDue = 0, overallDone = 0, criticalCount = 0, totalMeds = 0;

              (rows || []).forEach(r => {
                const meta = parseMeta(r.notes);
                if (!meta) return;
                const scheduledDays = meta.days || ['daily'];
                const medStart = meta.startDate || startDate;
                const medEnd   = meta.endDate   || endDate;

                const dailyMap = {};
                if (r.daily_detail) {
                  r.daily_detail.split('|').forEach(entry => {
                    const [date, status, isOvr] = entry.split(':');
                    if (!dailyMap[date] || isOvr === '1') dailyMap[date] = { status, is_overdue: isOvr === '1' };
                  });
                }

                let daysDue = 0, daysTaken = 0, daysPartial = 0;
                dateList.forEach(iso => {
                  const dayName = DAY_NAMES_CG[new Date(iso + 'T12:00:00').getDay()];
                  const isDue = iso >= medStart && iso <= medEnd &&
                    (scheduledDays.includes('daily') || scheduledDays.includes('everyday') ||
                     scheduledDays.includes(dayName) || scheduledDays.includes(dayName.toLowerCase()));
                  if (!isDue) return;
                  daysDue++;
                  const d = dailyMap[iso];
                  if (d?.status === 'taken') daysTaken++;
                  else if (d?.status === 'partial') daysPartial++;
                });

                if (daysDue > 0) {
                  totalMeds++;
                  const pct = Math.round(((daysTaken + daysPartial * 0.5) / daysDue) * 100);
                  if (pct < 50) criticalCount++;
                  overallDue  += daysDue;
                  overallDone += daysTaken + daysPartial * 0.5;
                }
              });

              resolve({
                elder_id:              elder.id,
                elder_name:            elder.name,
                overall_adherence_pct: overallDue > 0 ? Math.round((overallDone / overallDue) * 100) : null,
                total_meds:            totalMeds,
                critical_count:        criticalCount,
                period_days:           days,
              });
            }
          );
        });
      }));

      res.json(results);
    }
  );
});

// =============================================================================
// DAILY END-OF-DAY SUMMARY CRON — 9 PM
// =============================================================================
cron.schedule('0 21 * * *', () => {
  const todayISO = new Date().toISOString().split('T')[0];

  db.query(
    `SELECT DISTINCT c.requester_id AS caregiverId, u.expo_push_token, u.name AS caregiverName
     FROM connections c
     JOIN users u ON u.id = c.requester_id
     WHERE c.status = 'approved'`,
    [],
    (err, caregivers) => {
      if (err || !caregivers) return;

      caregivers.forEach(cg => {
        db.query(
          `SELECT u.id, u.name FROM users u
           JOIN connections c ON c.elder_id = u.id AND c.requester_id = ? AND c.status = 'approved'`,
          [cg.caregiverId],
          (err2, elders) => {
            if (err2 || !elders || !elders.length) return;

            let summaryLines = [];
            let pending = elders.length;
            const done = () => {
              if (--pending > 0) return;
              if (!summaryLines.length) return;
              const msg = summaryLines.join('\n');
              if (cg.expo_push_token) {
                sendPushNotification(
                  cg.expo_push_token,
                  '📊 Daily Medication Summary',
                  msg,
                  { screen: 'Monitor' }
                );
              }
              elders.forEach(elder => {
                db.query(
                  `INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, priority, created_at)
                   VALUES (?, ?, 'daily_summary', ?, 0, 'low', NOW())`,
                  [elder.id, cg.caregiverId, msg],
                  () => {}
                );
              });
              console.log(`[DAILY SUMMARY] Caregiver ${cg.caregiverId} — ${summaryLines.length} elders`);
            };

            elders.forEach(elder => {
              db.query(
                `SELECT m.*,
                   (SELECT COUNT(*) FROM medication_intake mi
                    WHERE mi.medication_id=m.id AND mi.user_id=m.user_id
                      AND DATE(mi.taken_at)=? AND mi.status='taken') AS taken_today,
                   (SELECT COUNT(*) FROM medication_intake mi2
                    WHERE mi2.medication_id=m.id AND mi2.user_id=m.user_id
                      AND DATE(mi2.taken_at)=? AND mi2.status='partial') AS partial_today,
                   (SELECT COUNT(*) FROM medication_intake mi3
                    WHERE mi3.medication_id=m.id AND mi3.user_id=m.user_id
                      AND DATE(mi3.taken_at)=? AND mi3.is_overdue=1) AS overdue_today
                 FROM medications m WHERE m.user_id=?`,
                [todayISO, todayISO, todayISO, elder.id],
                (err3, meds) => {
                  const scheduled = (meds || []).filter(m => {
                    const meta = parseMeta(m.notes);
                    if (!meta) return false;
                    if (meta.startDate && todayISO < meta.startDate) return false;
                    if (meta.endDate   && todayISO > meta.endDate)   return false;
                    return isScheduledToday(meta.days || ['daily']);
                  });

                  if (scheduled.length) {
                    const total   = scheduled.length;
                    const taken   = scheduled.filter(m => m.taken_today > 0).length;
                    const partial = scheduled.filter(m => m.partial_today > 0 && m.taken_today === 0).length;
                    const overdue = scheduled.filter(m => m.overdue_today > 0).length;
                    const missed  = total - taken - partial - overdue;
                    const pct     = Math.round(((taken + partial * 0.5) / total) * 100);
                    const statusIcon = pct >= 80 ? '✅' : pct >= 50 ? '⚠️' : '🚨';
                    summaryLines.push(
                      `${statusIcon} ${elder.name}: ${taken}/${total} taken (${pct}%)` +
                      (overdue  > 0 ? ` · ${overdue} overdue`  : '') +
                      (missed   > 0 ? ` · ${missed} missed`    : '') +
                      (partial  > 0 ? ` · ${partial} partial`  : '')
                    );
                  }
                  done();
                }
              );
            });
          }
        );
      });
    }
  );
});

// =============================================================================
// WEEKLY ADHERENCE ALERT CRON — Monday 8 AM
// =============================================================================
cron.schedule('0 8 * * 1', () => {
  const DAY_NAMES_WK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dateList = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dateList.push(d.toISOString().split('T')[0]);
  }
  const startDate = dateList[dateList.length - 1];
  const endDate   = dateList[0];

  db.query(
    `SELECT DISTINCT c.elder_id, c.requester_id AS caregiver_id, u.name AS elder_name
     FROM connections c JOIN users u ON u.id = c.elder_id WHERE c.status = 'approved'`,
    [],
    (err, rows) => {
      if (err || !rows) return;
      rows.forEach(row => {
        db.query(
          `SELECT m.*, (SELECT GROUP_CONCAT(CONCAT(DATE(mi.taken_at),':',mi.status,':',IFNULL(mi.is_overdue,0)) SEPARATOR '|')
            FROM medication_intake mi WHERE mi.medication_id=m.id AND mi.user_id=m.user_id
            AND DATE(mi.taken_at) BETWEEN ? AND ?) AS daily_detail
           FROM medications m WHERE m.user_id=?`,
          [startDate, endDate, row.elder_id],
          (err2, meds) => {
            if (err2 || !meds) return;
            let due = 0, done = 0;
            meds.forEach(m => {
              const meta = parseMeta(m.notes);
              if (!meta) return;
              const sd = meta.days || ['daily'];
              const dailyMap = {};
              if (m.daily_detail) m.daily_detail.split('|').forEach(e => {
                const [date, status, ov] = e.split(':');
                if (!dailyMap[date] || ov === '1') dailyMap[date] = { status, is_overdue: ov === '1' };
              });
              dateList.forEach(iso => {
                const dayName = DAY_NAMES_WK[new Date(iso + 'T12:00:00').getDay()];
                const isDue = iso >= (meta.startDate || startDate) && iso <= (meta.endDate || endDate) &&
                  (sd.includes('daily') || sd.includes('everyday') || sd.includes(dayName) || sd.includes(dayName.toLowerCase()));
                if (!isDue) return;
                due++;
                const d = dailyMap[iso];
                if (d?.status === 'taken') done++;
                else if (d?.status === 'partial') done += 0.5;
              });
            });
            if (due === 0) return;
            const pct = Math.round((done / due) * 100);
            if (pct < 70) {
              const msg = `⚠️ Weekly Adherence Alert: ${row.elder_name} only took ${pct}% of scheduled medications this week (${Math.round(done)}/${due} doses). Please follow up.`;
              db.query(
                `INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, priority, created_at) VALUES (?,?,'adherence_alert',?,0,'high',NOW())`,
                [row.elder_id, row.caregiver_id, msg], () => {}
              );
              sendCaregiverPush(row.caregiver_id, '📉 Low Adherence Alert', msg);
              console.log(`[WEEKLY ADHERENCE] Elder ${row.elder_id} — ${pct}%`);
            }
          }
        );
      });
    }
  );
});

// =============================================================================
// ADHERENCE — missed dose history for a specific medication
// =============================================================================
app.get('/api/adherence/missed/:elderId/:medicationId', (req, res) => {
  const { elderId, medicationId } = req.params;
  const days      = Math.min(parseInt(req.query.days) || 7, 30);
  const dateList  = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dateList.push(d.toISOString().split('T')[0]);
  }
  const startDate = dateList[dateList.length - 1];
  const endDate   = dateList[0];

  db.query(
    `SELECT m.id, m.name, m.dosage, m.frequency, m.time, m.notes,
       (SELECT GROUP_CONCAT(CONCAT(DATE(mi.taken_at),':',mi.status,':',IFNULL(mi.is_overdue,0)) ORDER BY mi.taken_at DESC SEPARATOR '|')
        FROM medication_intake mi
        WHERE mi.medication_id = m.id AND mi.user_id = m.user_id
          AND DATE(mi.taken_at) BETWEEN ? AND ?) AS daily_detail
     FROM medications m WHERE m.id = ? AND m.user_id = ?`,
    [startDate, endDate, medicationId, elderId],
    (err, rows) => {
      if (err || !rows || !rows.length) return res.status(404).json({ message: 'Not found' });
      const r    = rows[0];
      const meta = parseMeta(r.notes);
      if (!meta) return res.status(404).json({ message: 'Not a scheduled medication' });

      const DAY_NAMES_MS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const scheduledDays = meta.days || ['daily'];
      const medStart      = meta.startDate || startDate;
      const medEnd        = meta.endDate   || endDate;

      const dailyMap = {};
      if (r.daily_detail) {
        r.daily_detail.split('|').forEach(entry => {
          const [date, status, isOvr] = entry.split(':');
          if (!dailyMap[date] || isOvr === '1') dailyMap[date] = { status, is_overdue: isOvr === '1' };
        });
      }

      let daysDue = 0, daysTaken = 0, daysPartial = 0, daysMissed = 0, daysOverdue = 0;
      const daily = dateList.map(iso => {
        const dayName = DAY_NAMES_MS[new Date(iso + 'T12:00:00').getDay()];
        const isDue   = iso >= medStart && iso <= medEnd &&
          (scheduledDays.includes('daily') || scheduledDays.includes('everyday') ||
           scheduledDays.includes(dayName) || scheduledDays.includes(dayName.toLowerCase()));
        if (!isDue) return { date: iso, outcome: 'not_scheduled' };

        daysDue++;
        const d = dailyMap[iso];
        const isToday = iso === endDate;
        let outcome;
        if (!d)              { outcome = isToday ? 'pending' : 'missed'; if (!isToday) daysMissed++; }
        else if (d.is_overdue || d.status === 'missed') { outcome = 'overdue'; daysOverdue++; }
        else if (d.status === 'taken')    { outcome = 'taken';   daysTaken++; }
        else if (d.status === 'partial')  { outcome = 'partial'; daysPartial++; }
        else if (d.status === 'not_taken'){ outcome = 'skipped'; daysMissed++; }
        else                             { outcome = 'pending'; }

        return { date: iso, outcome };
      });

      const adherencePct = daysDue > 0
        ? Math.round(((daysTaken + daysPartial * 0.5) / daysDue) * 100)
        : null;

      res.json({
        id: r.id, title: r.name, dosage: r.dosage || null,
        type: r.frequency || 'medicine', scheduled_time: r.time,
        scheduled_days: scheduledDays, period_days: days,
        start_date: startDate, end_date: endDate,
        days_due: daysDue, days_taken: daysTaken, days_partial: daysPartial,
        days_missed: daysMissed, days_overdue: daysOverdue,
        adherence_pct: adherencePct, daily_breakdown: daily.reverse(),
      });
    }
  );
});

// =============================================================================
// ADHERENCE — quick summary for a single elder
// =============================================================================
app.get('/api/adherence/summary/:elderId', (req, res) => {
  const elderId = req.params.elderId;
  const days    = Math.min(parseInt(req.query.days) || 7, 30);
  const dateList = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dateList.push(d.toISOString().split('T')[0]);
  }
  const startDate = dateList[dateList.length - 1];
  const endDate   = dateList[0];
  const DAY_NAMES_SUM = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  db.query(
    `SELECT m.id, m.name, m.frequency, m.time, m.notes,
       (SELECT GROUP_CONCAT(CONCAT(DATE(mi.taken_at),':',mi.status,':',IFNULL(mi.is_overdue,0)) ORDER BY mi.taken_at DESC SEPARATOR '|')
        FROM medication_intake mi WHERE mi.medication_id=m.id AND mi.user_id=m.user_id
          AND DATE(mi.taken_at) BETWEEN ? AND ?) AS daily_detail
     FROM medications m WHERE m.user_id=?`,
    [startDate, endDate, elderId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error' });

      let overallDue = 0, overallDone = 0;
      const medStats = [];

      (rows || []).forEach(r => {
        const meta = parseMeta(r.notes);
        if (!meta) return;
        const scheduledDays = meta.days || ['daily'];
        const medStart = meta.startDate || startDate;
        const medEnd   = meta.endDate   || endDate;
        const dailyMap = {};
        if (r.daily_detail) r.daily_detail.split('|').forEach(entry => {
          const [date, status, isOvr] = entry.split(':');
          if (!dailyMap[date] || isOvr === '1') dailyMap[date] = { status, is_overdue: isOvr === '1' };
        });

        let daysDue = 0, daysTaken = 0, daysPartial = 0, daysMissed = 0, daysOverdue = 0;
        dateList.forEach(iso => {
          const dayName = DAY_NAMES_SUM[new Date(iso + 'T12:00:00').getDay()];
          const isDue = iso >= medStart && iso <= medEnd &&
            (scheduledDays.includes('daily') || scheduledDays.includes('everyday') ||
             scheduledDays.includes(dayName) || scheduledDays.includes(dayName.toLowerCase()));
          if (!isDue) return;
          daysDue++;
          const d = dailyMap[iso];
          if (!d) { if (iso !== endDate) daysMissed++; }
          else if (d.is_overdue || d.status === 'missed') daysOverdue++;
          else if (d.status === 'taken')   daysTaken++;
          else if (d.status === 'partial') daysPartial++;
          else if (d.status === 'not_taken') daysMissed++;
        });

        if (daysDue > 0) {
          overallDue  += daysDue;
          overallDone += daysTaken + daysPartial * 0.5;
          medStats.push({
            id: r.id, title: r.name, type: r.frequency || 'medicine',
            scheduled_time: r.time,
            days_due: daysDue, days_taken: daysTaken, days_partial: daysPartial,
            days_missed: daysMissed + daysOverdue,
            adherence_pct: Math.round(((daysTaken + daysPartial * 0.5) / daysDue) * 100),
          });
        }
      });

      medStats.sort((a, b) => a.adherence_pct - b.adherence_pct);
      const overallPct = overallDue > 0 ? Math.round((overallDone / overallDue) * 100) : null;

      res.json({
        elder_id: elderId, period_days: days,
        overall_pct: overallPct, overall_due: overallDue,
        overall_done: Math.round(overallDone),
        total_meds: medStats.length,
        critical_meds: medStats.filter(m => m.adherence_pct < 50).length,
        warning_meds:  medStats.filter(m => m.adherence_pct >= 50 && m.adherence_pct < 70).length,
        worst_med:  medStats[0] || null,
        best_med:   medStats[medStats.length - 1] || null,
        medications: medStats,
      });
    }
  );
});

// =============================================================================
// AI RISK DETECTION — buildRiskPayload helper
// =============================================================================
async function buildRiskPayload(elderId) {
  return new Promise((resolve, reject) => {
    db.query(
      `SELECT log_type, value FROM health_logs h1
       WHERE user_id = ?
         AND logged_at = (SELECT MAX(logged_at) FROM health_logs h2
                          WHERE h2.user_id = h1.user_id AND h2.log_type = h1.log_type)`,
      [elderId],
      (err, vitalRows) => {
        if (err) return reject(err);

        const vitals = {};
        (vitalRows || []).forEach(r => { vitals[r.log_type] = r.value; });

        db.query(
          `SELECT log_type, value, DATE(logged_at) AS date
           FROM health_logs
           WHERE user_id = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
           ORDER BY log_type, logged_at ASC`,
          [elderId],
          async (err2, trendRows) => {
            if (err2) return reject(err2);

            let trends = {};
            const grouped = {};
            (trendRows || []).forEach(r => {
              if (!grouped[r.log_type]) grouped[r.log_type] = [];
              grouped[r.log_type].push({ date: r.date, value: r.value });
            });
            const vitalsPayload = Object.entries(grouped)
              .filter(([, arr]) => arr.length >= 2)
              .map(([log_type, readings]) => ({ log_type, readings }));

            if (vitalsPayload.length > 0) {
              const rr = await callDjangoRegressionBatch(vitalsPayload).catch(() => null);
              if (rr) rr.forEach(r => { trends[r.log_type] = r.regression?.trend || 'stable'; });
            }

            const today    = new Date().toISOString().split('T')[0];
            const sevenAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0];

            db.query(
              `SELECT
                 COUNT(*) AS total_intakes,
                 SUM(CASE WHEN status='taken'   THEN 1 ELSE 0 END) AS taken,
                 SUM(CASE WHEN status='partial' THEN 0.5 ELSE 0 END) AS partial,
                 SUM(CASE WHEN is_overdue=1     THEN 1 ELSE 0 END) AS overdue
               FROM medication_intake
               WHERE user_id=? AND DATE(taken_at) BETWEEN ? AND ?`,
              [elderId, sevenAgo, today],
              (err3, adhRows) => {
                if (err3) return reject(err3);

                const adh    = adhRows && adhRows[0] ? adhRows[0] : {};
                const total  = parseInt(adh.total_intakes) || 0;
                const done   = parseFloat(adh.taken || 0) + parseFloat(adh.partial || 0);
                const pct7d  = total > 0 ? Math.round((done / total) * 100) : 100;
                const missed7d = total - Math.round(done);

                db.query(
                  `SELECT COUNT(*) AS cnt FROM medication_intake
                   WHERE user_id=? AND is_overdue=1 AND DATE(taken_at)=CURDATE()`,
                  [elderId],
                  (err4, ovRows) => {
                    const overdueToday = ovRows && ovRows[0] ? parseInt(ovRows[0].cnt) || 0 : 0;

                    db.query(
                      `SELECT DATE(taken_at) AS d,
                              MAX(CASE WHEN status='taken' OR status='partial' THEN 1 ELSE 0 END) AS had_dose
                       FROM medication_intake
                       WHERE user_id=? AND DATE(taken_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                       GROUP BY DATE(taken_at)
                       ORDER BY d DESC`,
                      [elderId],
                      (err5, doseRows) => {
                        let consecutiveMissed = 0;
                        for (const row of (doseRows || [])) {
                          if (!parseInt(row.had_dose)) consecutiveMissed++;
                          else break;
                        }

                        db.query(
                          `SELECT COUNT(*) AS cnt FROM health_risks
                           WHERE elder_id=? AND resolved=0`,
                          [elderId],
                          (err6, riskRows) => {
                            const activeRisks = riskRows && riskRows[0]
                              ? parseInt(riskRows[0].cnt) || 0 : 0;

                            db.query(
                              `SELECT DATEDIFF(CURDATE(), DATE(MAX(logged_at))) AS days_ago
                               FROM health_logs WHERE user_id=?`,
                              [elderId],
                              (err7, logRows) => {
                                const daysSinceLog = logRows && logRows[0]
                                  ? parseInt(logRows[0].days_ago) || 0 : 30;

                                db.query(
                                  `SELECT
                                     COUNT(m.id)                                          AS total_today,
                                     SUM(CASE WHEN mi.status='taken' OR mi.status='partial'
                                              THEN 1 ELSE 0 END)                          AS done_today
                                   FROM medications m
                                   LEFT JOIN medication_intake mi
                                     ON mi.medication_id=m.id AND mi.user_id=m.user_id
                                     AND DATE(mi.taken_at)=CURDATE()
                                   WHERE m.user_id=? AND m.notes IS NOT NULL`,
                                  [elderId],
                                  (err8, schRows) => {
                                    const sch      = schRows && schRows[0] ? schRows[0] : {};
                                    const schTotal = parseInt(sch.total_today) || 0;
                                    const schDone  = parseInt(sch.done_today)  || 0;
                                    const schPct   = schTotal > 0
                                      ? Math.round((schDone / schTotal) * 100) : 100;

                                    resolve({
                                      elder_id: elderId,
                                      vitals,
                                      trends,
                                      adherence: {
                                        pct_7d:              pct7d,
                                        missed_7d:           Math.max(missed7d, 0),
                                        overdue_today:       overdueToday,
                                        consecutive_missed:  consecutiveMissed,
                                        total_risks:         activeRisks,
                                      },
                                      schedule: {
                                        completed_today_pct: schPct,
                                      },
                                      days_since_log: daysSinceLog,
                                    });
                                  }
                                );
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
}

async function callDjangoRiskAssess(payload) {
  try {
    const resp = await fetch(`${DJANGO_REGRESSION_URL}/api/regression/risk/assess/`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!resp.ok) { console.error('[risk] Django returned', resp.status); return null; }
    return await resp.json();
  } catch (err) {
    console.error('[risk] Django call failed:', err.message);
    return null;
  }
}

// =============================================================================
// RISK DETECTION CORE — run assessment for one elder, save, alert caregivers
// =============================================================================
async function runRiskAssessment(elderId, trigger = 'cron') {
  try {
    const payload = await buildRiskPayload(elderId);
    const result  = await callDjangoRiskAssess(payload);
    if (!result) return;

    const score      = result.risk_score;
    const level      = result.risk_level;
    const isCritical = result.is_critical;

    db.query(
      `INSERT INTO ai_risk_scores
         (elder_id, risk_score, risk_level, is_critical, alert_message,
          alert_reasons, top_factors, trigger_source, assessed_at)
       VALUES (?,?,?,?,?,?,?,?,NOW())`,
      [
        elderId, score, level, isCritical ? 1 : 0,
        result.alert_message,
        JSON.stringify(result.alert_reasons || []),
        JSON.stringify(result.top_factors   || []),
        trigger,
      ],
      (dbErr) => {
        if (dbErr) {
          console.log('[risk] DB insert error (run migration first):', dbErr.message);
        }
      }
    );


    if (score < 40) return result;

    const priority  = isCritical ? 'critical' : 'high';
    const alertType = 'ai_risk';
    const message   = result.alert_message;

    
    db.query(
      `SELECT requester_id FROM connections WHERE elder_id=? AND status='approved'`,
      [elderId],
      (err, cgs) => {
        if (err || !cgs || !cgs.length) return;

        const vals = cgs.map(c => [elderId, c.requester_id, alertType, message, 0, priority, new Date()]);
        db.query(
          `INSERT INTO alerts (user_id,caregiver_id,alert_type,message,is_read,priority,created_at) VALUES ?`,
          [vals],
          () => {}
        );

        cgs.forEach(c => {
          sendCaregiverPush(
            c.requester_id,
            result.alert_title,
            message
          );
        });

        console.log(`[RISK] Elder ${elderId} — score ${score}% (${level})${isCritical ? ' ⚠️ CRITICAL' : ''} | ${trigger}`);
      }
    );

    return result;
  } catch (err) {
    console.error(`[risk] Assessment failed for elder ${elderId}:`, err.message);
  }
}

// =============================================================================
// CRON — Run risk assessment for ALL elders every 6 hours
// =============================================================================
cron.schedule('0 */6 * * *', async () => {
  console.log('[RISK CRON] Running scheduled AI risk assessment for all elders…');
  db.query(`SELECT DISTINCT id FROM users WHERE role='elderly'`, [], async (err, rows) => {
    if (err || !rows) return;
    for (const row of rows) {
      await runRiskAssessment(row.id, 'scheduled_cron');
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[RISK CRON] Done — assessed ${rows.length} elder(s)`);
  });
});

// =============================================================================
// ROUTE: POST /api/risk/assess/:elderId — Manual trigger
// =============================================================================
app.post('/api/risk/assess/:elderId', async (req, res) => {
  const { elderId } = req.params;
  try {
    const result = await runRiskAssessment(elderId, 'manual_trigger');
    if (!result) return res.status(503).json({ message: 'Risk service unavailable. Is Django running?' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Risk assessment error: ' + err.message });
  }
});

// =============================================================================
// ROUTE: GET /api/risk/scores/:elderId
// =============================================================================
app.get('/api/risk/scores/:elderId', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  db.query(
    `SELECT id, elder_id, risk_score, risk_level, is_critical,
            alert_message, alert_reasons, top_factors, trigger_source, assessed_at
     FROM ai_risk_scores
     WHERE elder_id=?
     ORDER BY assessed_at DESC LIMIT ?`,
    [req.params.elderId, limit],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });
      const parsed = (rows || []).map(r => ({
        ...r,
        alert_reasons: tryParse(r.alert_reasons, []),
        top_factors:   tryParse(r.top_factors,   []),
        is_critical:   !!r.is_critical,
      }));
      res.json({ latest: parsed[0] || null, history: parsed });
    }
  );
});

// =============================================================================
// ROUTE: GET /api/risk/scores/caregiver/:caregiverId
// =============================================================================
app.get('/api/risk/scores/caregiver/:caregiverId', (req, res) => {
  db.query(
    `SELECT u.id AS elder_id, u.name AS elder_name,
            rs.risk_score, rs.risk_level, rs.is_critical,
            rs.alert_message, rs.alert_reasons, rs.top_factors, rs.assessed_at
     FROM users u
     JOIN connections c ON c.elder_id=u.id AND c.requester_id=? AND c.status='approved'
     LEFT JOIN ai_risk_scores rs
       ON rs.id = (
         SELECT id FROM ai_risk_scores
         WHERE elder_id=u.id ORDER BY assessed_at DESC LIMIT 1
       )
     ORDER BY rs.risk_score DESC, u.name`,
    [req.params.caregiverId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });
      res.json((rows || []).map(r => ({
        ...r,
        alert_reasons: tryParse(r.alert_reasons, []),
        top_factors:   tryParse(r.top_factors,   []),
        is_critical:   !!r.is_critical,
        risk_score:    r.risk_score || 0,
        risk_level:    r.risk_level || 'unknown',
      })));
    }
  );
});

// =============================================================================
// MySQL migration — auto-create ai_risk_scores table on server start
// =============================================================================
db.query(`
  CREATE TABLE IF NOT EXISTS ai_risk_scores (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    elder_id        INT          NOT NULL,
    risk_score      FLOAT        NOT NULL DEFAULT 0,
    risk_level      VARCHAR(10)  NOT NULL DEFAULT 'low',
    is_critical     TINYINT(1)   NOT NULL DEFAULT 0,
    alert_message   TEXT,
    alert_reasons   JSON,
    top_factors     JSON,
    trigger_source  VARCHAR(30)  DEFAULT 'cron',
    assessed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_elder_id (elder_id),
    INDEX idx_assessed_at (assessed_at),
    INDEX idx_is_critical (is_critical)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`, (err) => {
  if (err) console.log('[risk] Table creation warning:', err.message);
  else console.log('[risk] ai_risk_scores table ready');
});
// =============================================================================
// DOCTOR ROUTES — paste this entire block into index.js
// Creates tables: chat_messages, medical_conditions, care_plans
// =============================================================================

// ── Auto-create tables on startup ────────────────────────────────────────────
db.query(`CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  elder_id INT NOT NULL, sender_id INT NOT NULL, receiver_id INT NOT NULL,
  sender_role ENUM('doctor','caregiver') NOT NULL,
  message TEXT NOT NULL, is_read TINYINT(1) DEFAULT 0,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_elder(elder_id), INDEX idx_recv(receiver_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, err => {
  if (err && !err.message.includes('already')) console.log('[chat_messages]:', err.message);
  else console.log('[chat_messages] table ready');
});

db.query(`CREATE TABLE IF NOT EXISTS medical_conditions (
  id INT AUTO_INCREMENT PRIMARY KEY, elder_id INT NOT NULL,
  \`condition\` VARCHAR(255) NOT NULL, diagnosed_at VARCHAR(50),
  notes TEXT, added_by INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_elder(elder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, err => {
  if (err && !err.message.includes('already')) console.log('[medical_conditions]:', err.message);
  else console.log('[medical_conditions] table ready');
});

db.query(`CREATE TABLE IF NOT EXISTS care_plans (
  id INT AUTO_INCREMENT PRIMARY KEY, elder_id INT NOT NULL, doctor_id INT NOT NULL,
  title VARCHAR(255) NOT NULL, notes TEXT,
  priority ENUM('low','medium','high','critical') DEFAULT 'medium',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_elder(elder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, err => {
  if (err && !err.message.includes('already')) console.log('[care_plans]:', err.message);
});

// =============================================================================
// GET /api/doctor/patients/:doctorId
// All elderly patients connected to this doctor, with latest vitals/risk/mood
// =============================================================================
app.get('/api/doctor/patients/:doctorId', async (req, res) => {
  const doctorId = parseInt(req.params.doctorId);
  if (!doctorId) return res.status(400).json({ message: 'Invalid doctorId' });
  try {
    const patients = await dbQuery(
      `SELECT u.id, u.name, u.dob, u.phone, u.gender, u.emergency_contact, c.relationship,
         (SELECT COUNT(*) FROM alerts a WHERE a.user_id=u.id AND a.is_read=0) AS unread_alerts,
         (SELECT COUNT(*) FROM health_risks hr WHERE hr.elder_id=u.id AND hr.resolved=0) AS active_risks,
         (SELECT COUNT(*) FROM health_risks hr2 WHERE hr2.elder_id=u.id AND hr2.severity='critical'
            AND hr2.detected_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)) AS critical_flags
       FROM connections c JOIN users u ON c.elder_id=u.id
       WHERE c.requester_id=? AND c.status='approved'
       ORDER BY unread_alerts DESC, u.name ASC`,
      [doctorId]
    );
    await Promise.all(patients.map(async p => {
      const [vitals, risk, mood] = await Promise.all([
        dbQuery(`SELECT log_type, value, unit, logged_at FROM health_logs h1
          WHERE user_id=? AND logged_at=(SELECT MAX(logged_at) FROM health_logs h2
          WHERE h2.user_id=h1.user_id AND h2.log_type=h1.log_type)`, [p.id]),
        dbQuery(`SELECT risk_level, risk_score, is_critical FROM ai_risk_scores
          WHERE elder_id=? ORDER BY assessed_at DESC LIMIT 1`, [p.id]).catch(()=>[]),
        dbQuery(`SELECT mood, sentiment_label FROM mood_logs
          WHERE user_id=? ORDER BY logged_at DESC LIMIT 1`, [p.id]).catch(()=>[]),
      ]);
      p.latest_vitals = vitals;
      p.latest_risk   = risk[0]  || null;
      p.latest_mood   = mood[0]  || null;
    }));
    res.json(patients);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// =============================================================================
// GET /api/doctor/patient/:elderId/full
// =============================================================================
app.get('/api/doctor/patient/:elderId/full', async (req, res) => {
  const { elderId } = req.params;
  try {
    const [pat] = await dbQuery(
      `SELECT id, name, dob, phone, gender, emergency_contact FROM users WHERE id=?`, [elderId]
    );
    if (!pat) return res.status(404).json({ message: 'Not found' });

    const [vitals, meds, logs, risks, moods, activity, cg, riskScore, conditions, plans] =
      await Promise.all([
        dbQuery(`SELECT log_type, value, unit, logged_at FROM health_logs h1
          WHERE user_id=? AND logged_at=(SELECT MAX(h2.logged_at) FROM health_logs h2
          WHERE h2.user_id=h1.user_id AND h2.log_type=h1.log_type)`, [elderId]),
        dbQuery(`SELECT * FROM medications WHERE user_id=? ORDER BY time`, [elderId]),
        dbQuery(`SELECT log_type, value, unit, notes, logged_at FROM health_logs
          WHERE user_id=? ORDER BY logged_at DESC LIMIT 30`, [elderId]),
        dbQuery(`SELECT risk_type, severity, message, detected_at FROM health_risks
          WHERE elder_id=? AND resolved=0 ORDER BY detected_at DESC LIMIT 20`, [elderId]),
        dbQuery(`SELECT mood, notes, sentiment_label, concern_score, logged_at FROM mood_logs
          WHERE user_id=? ORDER BY logged_at DESC LIMIT 14`, [elderId]),
        dbQuery(`SELECT activity_type, description, logged_at FROM activity_logs
          WHERE elder_id=? ORDER BY logged_at DESC LIMIT 20`, [elderId]),
        dbQuery(`SELECT u.id, u.name, u.phone, c.relationship FROM connections c
          JOIN users u ON c.requester_id=u.id
          WHERE c.elder_id=? AND c.status='approved' AND u.role='caregiver' LIMIT 1`,
          [elderId]).catch(()=>[]),
        dbQuery(`SELECT risk_level, risk_score, is_critical, alert_message, assessed_at
          FROM ai_risk_scores WHERE elder_id=? ORDER BY assessed_at DESC LIMIT 1`,
          [elderId]).catch(()=>[]),
        dbQuery(`SELECT id, \`condition\`, diagnosed_at, notes FROM medical_conditions
          WHERE elder_id=? ORDER BY created_at DESC`, [elderId]).catch(()=>[]),
        dbQuery(`SELECT cp.*, u.name AS doctor_name FROM care_plans cp
          JOIN users u ON cp.doctor_id=u.id
          WHERE cp.elder_id=? ORDER BY cp.created_at DESC LIMIT 10`,
          [elderId]).catch(()=>[]),
      ]);

    res.json({
      patient: pat, latest_vitals: vitals, medications: meds, recent_health_logs: logs,
      active_risks: risks, mood_history: moods, activity_feed: activity,
      caregiver: cg[0]||null, latest_risk_score: riskScore[0]||null,
      medical_conditions: conditions, care_plans: plans,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// =============================================================================
// POST /api/doctor/add-medication
// =============================================================================
// REPLACE WITH:
// =============================================================================
// PASTE THIS INTO index.js
// FIND the three helper functions block and the POST /api/doctor/add-medication route
// REPLACE both with this entire block
// =============================================================================

// ── Helper: find the caregiver connected to an elder ─────────────────────────
async function getCaregiverForElder(elderId) {
  const cg = await dbQuery(
    `SELECT u.id, u.expo_push_token, u.name
     FROM connections c
     JOIN users u ON c.requester_id = u.id
     WHERE c.elder_id = ? AND c.status = 'approved' AND u.role = 'caregiver'
     LIMIT 1`,
    [elderId]
  ).catch(() => []);
  return cg[0] || null;
}

// ── Helper: get a user's name by id ──────────────────────────────────────────
async function getNameById(id) {
  if (!id) return null;
  const rows = await dbQuery(
    `SELECT name FROM users WHERE id = ?`, [id]
  ).catch(() => []);
  return rows[0]?.name || null;
}

// ── Helper: insert alert + push notification to caregiver ────────────────────
async function alertCaregiver(elderId, caregiver, message, priority = 'medium') {
  if (!caregiver) return;
  await dbQuery(
    `INSERT INTO alerts
       (user_id, caregiver_id, alert_type, message, is_read, priority, created_at)
     VALUES (?, ?, 'medication_updated', ?, 0, ?, NOW())`,
    [elderId, caregiver.id, message, priority]
  ).catch(err => console.log('[alertCaregiver] DB error:', err.message));

  if (caregiver.expo_push_token) {
    await sendPushNotification(
      caregiver.expo_push_token,
      '💊 New Prescription',
      message,
      { screen: 'Alerts', elderId }
    );
  }
}

// =============================================================================
// POST /api/doctor/add-medication
// REPLACE the existing route entirely with this version
// =============================================================================
app.post('/api/doctor/add-medication', async (req, res) => {
  const { elderId, doctorId, name, dosage, frequency, time, notes } = req.body;
  if (!elderId || !name) return res.status(400).json({ message: 'elderId and name required' });
  try {
    // 1. Insert medication record
    const result = await dbQuery(
      `INSERT INTO medications (user_id, name, dosage, frequency, time, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [elderId, name, dosage || null, frequency || null, time || null, notes || null]
    );

    // 2. Insert reminder if time provided
    if (time) {
      await dbQuery(
        `INSERT INTO medication_reminder (medication_id, reminder_time, is_active)
         VALUES (?, ?, 1)`,
        [result.insertId, time]
      );
    }

    // 3. Look up doctor name, elder name, and connected caregiver in parallel
    const [cg, drName, elName] = await Promise.all([
      getCaregiverForElder(elderId),
      getNameById(doctorId),
      getNameById(elderId),
    ]);

    // 4. Build a readable prescription summary
    const medLabel = [name, dosage, frequency].filter(Boolean).join(', ');
    const message = `Dr. ${drName || 'Doctor'} prescribed ${medLabel} for ${elName || 'patient'}. Please add this to their daily medication schedule.`;

    // 5. Alert caregiver (DB alert + push notification)
    await alertCaregiver(elderId, cg, message, 'medium');

    // 6. Log activity
    logActivity(
      elderId,
      'medication_updated',
      `Dr. ${drName || 'Doctor'} prescribed "${name}"${dosage ? ` ${dosage}` : ''}`
    );

    res.json({ message: 'Medication added', id: result.insertId });
  } catch (err) {
    console.error('[add-medication]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// PUT /api/doctor/update-medication/:medId
// =============================================================================
// PUT /api/doctor/update-medication/:medId
// REPLACE the existing version with this — adds caregiver notification
app.put('/api/doctor/update-medication/:medId', async (req, res) => {
  const { name, dosage, frequency, time, notes, elderId, doctorId } = req.body;
  if (!elderId) return res.status(400).json({ message: 'elderId required' });
  try {
    // 1. Update the medication
    await dbQuery(
      `UPDATE medications SET name=?, dosage=?, frequency=?, time=?, notes=? WHERE id=?`,
      [name, dosage||null, frequency||null, time||null, notes||null, req.params.medId]
    );
    if (time) await dbQuery(
      `UPDATE medication_reminder SET reminder_time=? WHERE medication_id=?`,
      [time, req.params.medId]
    );

    // 2. Look up doctor name, elder name, caregiver
    const [cg, drName, elName] = await Promise.all([
      getCaregiverForElder(elderId),
      getNameById(doctorId),
      getNameById(elderId),
    ]);

    // 3. Build change summary
    const parts = [];
    if (dosage)    parts.push(`dosage: ${dosage}`);
    if (frequency) parts.push(`frequency: ${frequency}`);
    if (notes)     parts.push(`instructions: ${notes}`);
    const changeStr = parts.length ? parts.join(', ') : 'updated';

    const message = `Dr. ${drName || 'Doctor'} updated "${name}" for ${elName || 'patient'} — ${changeStr}. Please review the schedule.`;

    // 4. Alert caregiver (shows in Prescription tab)
    await alertCaregiver(elderId, cg, message, 'medium');

    // 5. Log activity
    logActivity(elderId, 'medication_updated',
      `Dr. ${drName || 'Doctor'} updated "${name}" — ${changeStr}`
    );

    res.json({ message: 'Updated and caregiver notified' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// =============================================================================
// POST /api/doctor/care-plan
// =============================================================================
app.post('/api/doctor/care-plan', async (req, res) => {
  const { elderId, doctorId, title, notes, priority } = req.body;
  if (!elderId || !doctorId || !title) return res.status(400).json({ message: 'Missing fields' });
  try {
    const r = await dbQuery(
      `INSERT INTO care_plans (elder_id, doctor_id, title, notes, priority) VALUES (?,?,?,?,?)`,
      [elderId, doctorId, title, notes||null, priority||'medium']
    );
    // Notify caregiver
    const cg = await dbQuery(
      `SELECT requester_id FROM connections WHERE elder_id=? AND status='approved'
       AND (SELECT role FROM users WHERE id=requester_id)='caregiver' LIMIT 1`, [elderId]
    ).catch(()=>[]);
    if (cg[0]) await dbQuery(
      `INSERT INTO alerts (user_id,caregiver_id,alert_type,message,is_read,priority,created_at)
       VALUES (?,?,'care_plan',?,0,?,NOW())`,
      [elderId, cg[0].requester_id, `📋 Doctor added: "${title}"`, priority||'medium']
    );
    res.json({ message: 'Saved', id: r.insertId });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// =============================================================================
// POST/DELETE /api/doctor/medical-condition
// =============================================================================
app.post('/api/doctor/medical-condition', async (req, res) => {
  const { elderId, doctorId, condition, diagnosedAt, notes } = req.body;
  if (!elderId || !condition) return res.status(400).json({ message: 'Missing fields' });
  try {
    const r = await dbQuery(
      `INSERT INTO medical_conditions (elder_id, \`condition\`, diagnosed_at, notes, added_by)
       VALUES (?,?,?,?,?)`, [elderId, condition, diagnosedAt||null, notes||null, doctorId||null]
    );
    res.json({ message: 'Added', id: r.insertId });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.delete('/api/doctor/medical-condition/:id', async (req, res) => {
  try {
    await dbQuery(`DELETE FROM medical_conditions WHERE id=?`, [req.params.id]);
    res.json({ message: 'Removed' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// =============================================================================
// CHAT ROUTES
// =============================================================================
app.get('/api/chat/:elderId/:userId', async (req, res) => {
  const { elderId, userId } = req.params;
  try {
    const msgs = await dbQuery(
      `SELECT cm.*, u.name AS sender_name FROM chat_messages cm
       JOIN users u ON cm.sender_id=u.id
       WHERE cm.elder_id=? AND (cm.sender_id=? OR cm.receiver_id=?)
       ORDER BY cm.sent_at ASC LIMIT 100`,
      [elderId, userId, userId]
    );
    await dbQuery(
      `UPDATE chat_messages SET is_read=1 WHERE elder_id=? AND receiver_id=? AND is_read=0`,
      [elderId, userId]
    );
    res.json(msgs);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/chat/send', async (req, res) => {
  const { elderId, senderId, receiverId, senderRole, message } = req.body;
  if (!elderId || !senderId || !receiverId || !message)
    return res.status(400).json({ message: 'Missing fields' });
  try {
    const r = await dbQuery(
      `INSERT INTO chat_messages (elder_id, sender_id, receiver_id, sender_role, message)
       VALUES (?,?,?,?,?)`, [elderId, senderId, receiverId, senderRole, message]
    );
    const [recv] = await dbQuery(`SELECT expo_push_token FROM users WHERE id=?`, [receiverId]);
    const [sndr] = await dbQuery(`SELECT name FROM users WHERE id=?`, [senderId]);
    if (recv?.expo_push_token) sendPushNotification(
      recv.expo_push_token, `💬 ${sndr?.name||'Message'}`,
      message.length > 80 ? message.slice(0,80)+'…' : message,
      { screen:'PatientDetail', elderId }
    );
    res.json({ message:'Sent', id:r.insertId });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/api/chat/unread/:userId', async (req, res) => {
  try {
    const [r] = await dbQuery(
      `SELECT COUNT(*) AS cnt FROM chat_messages WHERE receiver_id=? AND is_read=0`,
      [req.params.userId]
    );
    res.json({ unread: r?.cnt || 0 });
  } catch (err) { res.status(500).json({ message: err.message }); }
});


// =============================================================================
// GET /api/doctor/alerts/:doctorId — unread alerts from all connected patients
// =============================================================================
app.get('/api/doctor/alerts/:doctorId', async (req, res) => {
  try {
    const alerts = await dbQuery(
      `SELECT a.*, u.name AS elder_name FROM alerts a
       JOIN users u ON a.user_id=u.id
       JOIN connections c ON c.elder_id=u.id AND c.requester_id=? AND c.status='approved'
       WHERE a.is_read=0
       ORDER BY FIELD(a.priority,'critical','high','medium','low'), a.created_at DESC
       LIMIT 50`, [req.params.doctorId]
    );
    res.json(alerts);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// =============================================================================
// CARE PLAN — AI Personalized Care Plan via T5 model (port 8002)
// =============================================================================
app.post('/api/careplan/generate', async (req, res) => {
  const { elderId } = req.body;
  if (!elderId) return res.status(400).json({ message: 'elderId required' });

  try {
    // 1. Get elder details
    const [elder] = await dbQuery(
      `SELECT name, dob, gender FROM users WHERE id = ?`, [elderId]
    );
    if (!elder) return res.status(404).json({ message: 'Elder not found' });

    // 2. Calculate age
    const age = elder.dob
      ? Math.floor((new Date() - new Date(elder.dob)) / (365.25 * 24 * 60 * 60 * 1000))
      : 70;

    // 3. Get BMI-based weight category
    const [weightRow] = await dbQuery(
      `SELECT value FROM health_logs WHERE user_id=? AND log_type='weight'
       ORDER BY logged_at DESC LIMIT 1`, [elderId]
    ).catch(() => []);
    const [heightRow] = await dbQuery(
      `SELECT value FROM health_logs WHERE user_id=? AND log_type='height'
       ORDER BY logged_at DESC LIMIT 1`, [elderId]
    ).catch(() => []);

    const weightKg  = weightRow  ? parseFloat(weightRow.value)  : 70;
    const heightCm  = heightRow  ? parseFloat(heightRow.value)  : 170;
    const bmi       = weightKg / ((heightCm / 100) ** 2);
    const weight    = bmi >= 30 ? 'obese'
                    : bmi >= 25 ? 'overweight'
                    : bmi >= 18.5 ? 'normal weight'
                    : 'underweight';

    // 4. Get latest vitals
    const vitals = await dbQuery(
      `SELECT log_type, value FROM health_logs h1
       WHERE user_id = ?
         AND logged_at = (SELECT MAX(logged_at) FROM health_logs h2
                          WHERE h2.user_id = h1.user_id AND h2.log_type = h1.log_type)`,
      [elderId]
    ).catch(() => []);

    const vmap  = {};
    vitals.forEach(v => { vmap[v.log_type] = v.value; });
    const bp    = vmap['blood_pressure'] || '120/80';
    const sugar = vmap['blood_sugar']    || '95';
    const hr    = vmap['heart_rate']     || '72';
    const temp  = vmap['temperature']    || '98.4';

    // 5. Get medical conditions
    const condRows = await dbQuery(
      `SELECT \`condition\` FROM medical_conditions WHERE elder_id = ?`, [elderId]
    ).catch(() => []);
    const conditions = condRows.length
      ? condRows.map(c => c.condition).join(', ')
      : 'general health';

    // 6. Call Python T5 service
    const pyRes = await fetch('http://localhost:8002/api/careplan/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        age, gender: elder.gender || 'male',
        weight, conditions, bp, sugar, hr, temp,
      }),
    });

    const result = await pyRes.json();
    if (!result.success) throw new Error(result.error || 'Generation failed');

    // 7. Log activity
    // 7. Save generated plan to care_plans table
    await dbQuery(
      `INSERT INTO care_plans (elder_id, doctor_id, title, notes, priority, created_at)
       VALUES (?, NULL, ?, ?, 'medium', NOW())`,
      [
        elderId,
        `AI Care Plan — ${conditions}`,
        `DIET: ${result.diet}\n\nEXERCISE: ${result.exercise}\n\nCAUTION: ${result.caution}`,
      ]
    ).catch(err => console.log('[careplan] Save to DB warning:', err.message));

    // 8. Log activity
    logActivity(elderId, 'care_plan_generated',
      `Care plan generated for: ${conditions}`);

    res.json({
      success:    true,
      care_plan:  result.raw,
      diet:       result.diet,
      exercise:   result.exercise,
      caution:    result.caution,
      patient: {
        age, gender: elder.gender, weight, conditions,
        vitals: { bp, sugar, hr, temp },
      },
    });

  } catch (err) {
    console.error('[careplan]', err.message);
    res.status(500).json({ message: 'Care plan error: ' + err.message });
  }
});

// GET care plan for a specific elder (used by caregiver screen)
app.get('/api/careplan/elder/:elderId', async (req, res) => {
  try {
    // Reuse the POST logic by calling it internally
    const mockReq = { body: { elderId: req.params.elderId } };
    const mockRes = {
      status: (code) => ({ json: (data) => res.status(code).json(data) }),
      json: (data) => res.json(data),
    };
    // Just call the generate endpoint
    const response = await fetch(
      `http://localhost:3000/api/careplan/generate`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ elderId: req.params.elderId }),
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// =============================================================================
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://10.100.140.28:${PORT}`);
});