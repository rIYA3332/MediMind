const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const cron = require('node-cron'); // npm install node-cron

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
// PUSH NOTIFICATIONS via Expo
// npm install node-fetch  (or use built-in fetch if Node 18+)
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
    if (result?.data?.status === 'error') {
      console.log('Push error:', result.data.message);
    }
  } catch (err) {
    console.log('Push notification failed:', err.message);
  }
}

// Send push to caregiver
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
      const vals = caregivers.map(c => [elderId, c.requester_id, alertType, message, false, priority, new Date()]);
      db.query(
        `INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, priority, created_at) VALUES ?`,
        [vals],
        (err2) => { if (err2) console.log('Alert error:', err2.message); }
      );
      // Also push-notify each caregiver
      caregivers.forEach(c => {
        sendCaregiverPush(c.requester_id, alertType === 'overdue' ? '⚠️ Overdue Task' : '📊 Health Update', message);
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
        const readings = logs.map(l => { const p = l.value.split('/'); if (p.length !== 2) return null; const s = parseInt(p[0]), d = parseInt(p[1]); return isNaN(s)||isNaN(d)?null:{s,d}; }).filter(Boolean);
        if (readings.length < 3) return;
        const critHigh = readings.filter(r=>r.s>180||r.d>120).length;
        const high     = readings.filter(r=>r.s>140||r.d>90).length;
        const low      = readings.filter(r=>r.s<90||r.d<60).length;
        if (critHigh>=2){ riskDetected=true; severity='critical'; riskType='critical_high_bp';    priority='critical'; riskMessage=`🚨 CRITICAL BP: Blood pressure dangerously high (${value} ${unit}). SEEK IMMEDIATE MEDICAL ATTENTION.`; }
        else if(high>=3){ riskDetected=true; severity='danger';   riskType='high_blood_pressure'; priority='high';     riskMessage=`⚠️ HIGH BP: ${high} elevated readings in 3 days. Current: ${value} ${unit}. Please consult a doctor.`; }
        else if(low>=3) { riskDetected=true; severity='warning';  riskType='low_blood_pressure';  priority='high';     riskMessage=`⚠️ LOW BP: ${low} low readings in 3 days. Current: ${value} ${unit}. Monitor closely.`; }
      } else if (logType === 'blood_sugar') {
        const readings = logs.map(l=>parseFloat(l.value)).filter(r=>!isNaN(r));
        if (readings.length < 3) return;
        const critLow=readings.filter(r=>r<54).length, low=readings.filter(r=>r<70).length, high=readings.filter(r=>r>180).length;
        if (critLow>=2){ riskDetected=true; severity='critical'; riskType='critical_low_sugar'; priority='critical'; riskMessage=`🚨 CRITICAL SUGAR: Blood sugar dangerously low (${value} ${unit}). EMERGENCY ATTENTION NEEDED.`; }
        else if(low>=3){ riskDetected=true; severity='danger';   riskType='low_blood_sugar';    priority='high';     riskMessage=`⚠️ LOW SUGAR: ${low} low readings in 3 days. Current: ${value} ${unit}.`; }
        else if(high>=3){ riskDetected=true; severity='warning'; riskType='high_blood_sugar';   priority='medium';   riskMessage=`⚠️ HIGH SUGAR: ${high} elevated readings in 3 days. Current: ${value} ${unit}.`; }
      } else if (logType === 'heart_rate') {
        const readings = logs.map(l=>parseFloat(l.value)).filter(r=>!isNaN(r));
        if (readings.length < 3) return;
        const critHigh=readings.filter(r=>r>130).length, high=readings.filter(r=>r>100).length, low=readings.filter(r=>r<60).length;
        if (critHigh>=2){ riskDetected=true; severity='critical'; riskType='critical_high_hr'; priority='critical'; riskMessage=`🚨 CRITICAL HEART RATE: ${value} ${unit} — dangerously high. SEEK IMMEDIATE HELP.`; }
        else if(high>=3){ riskDetected=true; severity='danger';   riskType='high_heart_rate';  priority='high';     riskMessage=`⚠️ HIGH HEART RATE: ${high} elevated readings in 3 days. Current: ${value} ${unit}.`; }
        else if(low>=3) { riskDetected=true; severity='warning';  riskType='low_heart_rate';   priority='medium';   riskMessage=`⚠️ LOW HEART RATE: ${low} low readings in 3 days. Current: ${value} ${unit}.`; }
      } else if (logType === 'temperature') {
        const readings = logs.map(l=>parseFloat(l.value)).filter(r=>!isNaN(r));
        if (readings.length < 3) return;
        const critHigh=readings.filter(r=>r>=103).length, low=readings.filter(r=>r<96).length;
        if (critHigh>=2){ riskDetected=true; severity='critical'; riskType='high_fever';      priority='critical'; riskMessage=`🚨 HIGH FEVER: Temperature ${value}${unit}. MEDICAL ATTENTION REQUIRED NOW.`; }
        else if(low>=2) { riskDetected=true; severity='danger';   riskType='low_temperature'; priority='high';     riskMessage=`⚠️ LOW TEMP: ${low} low temperature readings. Current: ${value}${unit}.`; }
      }

      if (riskDetected) {
        db.query(`INSERT INTO health_risks (elder_id,risk_type,log_type,severity,message,readings_count) VALUES (?,?,?,?,?,?)`,
          [userId, riskType, logType, severity, riskMessage, logs.length]);
        notifyCaregivers(userId, 'vital', riskMessage, priority);
      }
    }
  );
}

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function isScheduledToday(scheduledDays) {
  if (!scheduledDays || !scheduledDays.length) return true;
  const today = DAY_NAMES[new Date().getDay()];
  return scheduledDays.includes('daily') ||
         scheduledDays.includes('everyday') ||
         scheduledDays.includes(today) ||
         scheduledDays.includes(today.toLowerCase());
}

function toScheduleShape(row) {
  const m = parseMeta(row.notes) || {};
  return {
    id:              row.id,
    elder_id:        row.user_id,
    elder_name:      row.elder_name || '',
    type:            row.frequency  || 'medicine',
    title:           row.name,
    description:     m.desc         || null,
    dosage:          row.dosage     || null,
    scheduled_time:  row.time,
    scheduled_days:  m.days         || ['daily'],
    start_date:      m.startDate    || new Date().toISOString().split('T')[0],
    end_date:        m.endDate      || null,
    repeat_interval: m.interval     || 30,
    max_reminders:   m.maxRem       || 3,
    is_active:       true,
  };
}

// =============================================================================
// CRON JOB — runs every minute
// Flow:
//   1. Find schedules due now that elder hasn't responded to yet
//   2. Check how many times we've already reminded (reminder_logs count)
//   3. If under max_reminders → send push + log attempt
//   4. If AT max_reminders and still no response → mark OVERDUE
//      → insert medication_intake with status='missed', is_overdue=1
//      → alert + push caregiver immediately
// =============================================================================
cron.schedule('* * * * *', () => {
  const todayISO  = new Date().toISOString().split('T')[0];
  const nowTime   = new Date().toTimeString().slice(0, 5); // HH:MM

  // Get all active schedules for today that haven't been responded to
  db.query(
    `SELECT
       m.id          AS medId,
       m.user_id     AS elderId,
       m.name        AS title,
       m.frequency   AS type,
       m.notes,
       m.time        AS scheduledTime,
       u.expo_push_token,
       u.name        AS elderName,
       -- how many reminder attempts sent today
       (SELECT COUNT(*) FROM reminder_logs rl
        WHERE rl.medication_id = m.id
          AND rl.user_id = m.user_id
          AND rl.scheduled_date = ?) AS attemptCount,
       -- elder's response today (if any)
       (SELECT status FROM medication_intake mi
        WHERE mi.medication_id = m.id
          AND mi.user_id = m.user_id
          AND DATE(mi.taken_at) = ?
        LIMIT 1) AS intakeStatus
     FROM medications m
     JOIN medication_reminder mr ON mr.medication_id = m.id AND mr.is_active = true
     JOIN users u ON u.id = m.user_id
     WHERE TIME(mr.reminder_time) <= ?
       AND m.notes IS NOT NULL`,
    [todayISO, todayISO, nowTime],
    (err, rows) => {
      if (err || !rows) return;

      rows.forEach(row => {
        const meta = parseMeta(row.notes) || {};

        // Skip if not a schedule entry (plain medication without meta)
        if (!meta || !meta.days || !Array.isArray(meta.days)) return;
        // Skip if schedule hasn't started yet
        if (meta.startDate && todayISO < meta.startDate) return;
        // Skip if not scheduled today
        if (!isScheduledToday(meta.days || ['daily'])) return;
        // Skip if end date passed
        if (meta.endDate && todayISO > meta.endDate) return;
        // Skip if elder already responded (taken or skipped — NOT missed+overdue)
        if (row.intakeStatus === 'taken') return;

        const maxReminders  = meta.maxRem  || 3;
        const intervalMins  = meta.interval || 30;
        const attemptCount  = row.attemptCount || 0;

        // ── Check if enough time has passed since last reminder ──
        // (avoid spamming — only remind every `intervalMins` minutes)
        db.query(
          `SELECT sent_at FROM reminder_logs
           WHERE medication_id=? AND user_id=? AND scheduled_date=?
           ORDER BY sent_at DESC LIMIT 1`,
          [row.medId, row.elderId, todayISO],
          (err2, lastLog) => {
            if (err2) return;

            const now = new Date();
            if (lastLog && lastLog.length) {
              const lastSent    = new Date(lastLog[0].sent_at);
              const diffMins    = (now - lastSent) / 60000;
              if (diffMins < intervalMins) return; // too soon to remind again
            }

            // ── OVERDUE: already sent max reminders, still no response ──
            if (attemptCount >= maxReminders) {
              // Only mark overdue once (check if already marked)
              db.query(
                `SELECT id FROM medication_intake
                 WHERE medication_id=? AND user_id=? AND DATE(taken_at)=? AND is_overdue=1`,
                [row.medId, row.elderId, todayISO],
                (err3, already) => {
                  if (err3 || (already && already.length)) return; // already marked

                  // Insert overdue record
                  db.query(
                    `INSERT INTO medication_intake (medication_id, user_id, taken_at, status, is_overdue)
                     VALUES (?, ?, NOW(), 'missed', 1)`,
                    [row.medId, row.elderId],
                    () => {}
                  );

                  // Log activity
                  logActivity(row.elderId, 'medication_missed',
                    `⚠️ OVERDUE: "${row.title}" (${row.type}) — no response after ${attemptCount} reminders`);

                  // Alert caregivers with HIGH priority
                  const overdueMsg = `🚨 OVERDUE: "${row.title}" (${row.type}) — ${row.elderName} did not respond after ${attemptCount} reminders.`;
                  notifyCaregivers(row.elderId, 'overdue', overdueMsg, 'high');

                  // Push notify elder too — final notice
                  if (row.expo_push_token) {
                    sendPushNotification(
                      row.expo_push_token,
                      '⚠️ Task Overdue',
                      `"${row.title}" has been marked overdue. Please open the app.`,
                      { screen: 'TodayReminders', scheduleId: row.medId }
                    );
                  }

                  console.log(`[OVERDUE] Elder ${row.elderId} — "${row.title}"`);
                }
              );
              return;
            }

            // ── REMIND: send push notification to elder ──
            const attemptNum = attemptCount + 1;
            const isFirst    = attemptNum === 1;

            // Log this reminder attempt
            db.query(
              `INSERT INTO reminder_logs (medication_id, user_id, scheduled_date, attempt_number, status)
               VALUES (?, ?, ?, ?, 'sent')`,
              [row.medId, row.elderId, todayISO, attemptNum],
              () => {}
            );

            // Push to elder
            if (row.expo_push_token) {
              const title = isFirst
                ? `⏰ Time for: ${row.title}`
                : `🔔 Reminder ${attemptNum}/${maxReminders}: ${row.title}`;
              const body = row.type === 'medicine'
                ? `Please take your medicine and mark it as done.`
                : `Please complete this task and mark it as done.`;

              sendPushNotification(
                row.expo_push_token,
                title,
                body,
                { screen: 'TodayReminders', scheduleId: row.medId }
              );
            }

            // Also notify caregiver on FIRST reminder (low priority — just FYI)
            if (isFirst && meta.cgId) {
              db.query(
                `INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, priority, created_at)
                 VALUES (?, ?, 'reminder_sent', ?, false, 'low', NOW())`,
                [row.elderId, meta.cgId,
                 `⏰ Reminder sent to ${row.elderName}: "${row.title}" at ${row.scheduledTime}`],
                () => {}
              );
            }

            // Caregiver notified on subsequent reminders (medium priority)
            if (!isFirst && meta.cgId) {
              db.query(
                `INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, priority, created_at)
                 VALUES (?, ?, 'reminder_sent', ?, false, 'medium', NOW())`,
                [row.elderId, meta.cgId,
                 `🔔 Re-reminder ${attemptNum}/${maxReminders} sent to ${row.elderName}: "${row.title}" — no response yet`],
                () => {}
              );
              sendCaregiverPush(meta.cgId,
                `🔔 No response yet`,
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
      `INSERT INTO users (name,email,password,role,phone,registration_code,dob,gender,emergency_contact) VALUES (?,?,?,?,?,?,?,?,?)`,
      [name,email,hashedPassword,role,phone,regCode,dob,gender,(role==='elderly'?emergency:null)],
      (err, result) => {
        if (err) return res.status(400).json({ message: 'Registration failed: '+err.message });
        res.json({ message:'Success', registration_code:regCode, userId:result.insertId });
      }
    );
  } catch { res.status(500).json({ message:'Server Error' }); }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.query('SELECT * FROM users WHERE email=?', [email], async (err, results) => {
    if (err) return res.status(500).json({ message:'Server error' });
    if (!results.length) return res.status(401).json({ message:'Invalid credentials' });
    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message:'Invalid credentials' });
    if (user.role==='caregiver'||user.role==='doctor') {
      db.query(`SELECT COUNT(*) as count FROM connections WHERE requester_id=? AND status='approved'`,[user.id],(connErr,connResults)=>{
        const hasConnection = connResults&&connResults[0]&&connResults[0].count>0;
        res.json({ id:user.id,role:user.role,name:user.name,email:user.email,code:user.registration_code,hasConnection });
      });
    } else {
      res.json({ id:user.id,role:user.role,name:user.name,email:user.email,code:user.registration_code });
    }
  });
});

app.post('/api/auth/connect', (req, res) => {
  const { requesterId, targetCode, relationship } = req.body;
  db.query('SELECT id,name FROM users WHERE registration_code=?',[targetCode],(err,results)=>{
    if (err) return res.status(500).json({ message:'Server error' });
    if (!results.length) return res.status(404).json({ message:'Invalid Code' });
    const elderId = results[0].id;
    if (elderId==requesterId) return res.status(400).json({ message:'Cannot connect to yourself' });
    db.query('SELECT status FROM connections WHERE elder_id=? AND requester_id=?',[elderId,requesterId],(err,cr)=>{
      if (cr&&cr.length>0) return res.status(400).json({ message:'Already connected or pending' });
      db.query(`INSERT INTO connections (elder_id,requester_id,relationship,status) VALUES (?,?,?,'pending')`,[elderId,requesterId,relationship],(err2)=>{
        if (err2) return res.status(400).json({ message:'Failed to send request' });
        res.json({ message:'Request sent successfully!', elderName:results[0].name });
      });
    });
  });
});

app.get('/api/auth/pending/:elderId', (req, res) => {
  db.query(`SELECT c.id as connectionId,u.name,u.role,c.relationship FROM connections c JOIN users u ON c.requester_id=u.id WHERE c.elder_id=? AND c.status='pending'`,[req.params.elderId],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

app.post('/api/auth/approve-connection', (req, res) => {
  db.query('UPDATE connections SET status="approved" WHERE id=?',[req.body.connectionId],(err)=>{
    if (err) return res.status(500).json({ message:'Approval failed' });
    res.json({ message:'Approved' });
  });
});

app.post('/api/auth/reject-connection', (req, res) => {
  db.query('DELETE FROM connections WHERE id=?',[req.body.connectionId],(err)=>{
    if (err) return res.status(500).json({ message:'Failed' });
    res.json({ message:'Request removed' });
  });
});

app.get('/api/connections/:caregiverId', (req, res) => {
  db.query(`SELECT u.id,u.name,u.dob,u.phone,u.emergency_contact,c.relationship FROM connections c JOIN users u ON c.elder_id=u.id WHERE c.requester_id=? AND c.status='approved'`,[req.params.caregiverId],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

// =============================================================================
// PUSH TOKEN — elder saves their Expo push token on app launch
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

  // Only require dosage/frequency for medicine
  if (type === 'medicine' && (!dosage || !frequency)) {
    return res.status(400).json({ message: 'Dosage and frequency required for medicine' });
  }

  db.query(
    `INSERT INTO medications (user_id, name, type, dosage, frequency, time, notes, date, recurrence, end_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [elderId, name, type, dosage || null, frequency || null, time || null, notes || null, date || null, recurrence || 'none', end_date || null],
    (err, result) => {
      if (err) return res.status(400).json({ message:'Failed to add schedule: '+err.message });

      // Add to reminder table if time is provided (for all types that can have reminders)
      if (time) {
        db.query(
          `INSERT INTO medication_reminder (medication_id, reminder_time, is_active)
           VALUES (?, ?, true)`,
          [result.insertId, time],
          () => {}
        );
      }

      res.json({ message: 'Schedule added successfully', scheduleId: result.insertId });
    }
  );
});

app.get('/api/medications/:userId', (req, res) => {
  db.query('SELECT * FROM medications WHERE user_id=? ORDER BY time', [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message:'Error fetching schedules' });

    res.json(results || []);
  });
});

app.put('/api/medications/:id', (req, res) => {
  const { name, type, dosage, frequency, time, notes, date, recurrence, end_date } = req.body;

  // Only enforce medicine requirements
  if (type === 'medicine' && (!dosage || !frequency)) {
    return res.status(400).json({ message: 'Dosage and frequency required for medicine' });
  }

  db.query(
    `UPDATE medications SET name=?, type=?, dosage=?, frequency=?, time=?, notes=?, date=?, recurrence=?, end_date=? WHERE id=?`,
    [name, type, dosage || null, frequency || null, time || null, notes || null, date || null, recurrence || 'none', end_date || null, req.params.id],
    (err) => {
      if (err) return res.status(400).json({ message:'Failed to update schedule' });

      if (time) {
        db.query(`UPDATE medication_reminder SET reminder_time=? WHERE medication_id=?`, [time, req.params.id], ()=>{});
      }

      res.json({ message:'Schedule updated' });
    }
  );
});

app.delete('/api/medications/:id', (req, res) => {
  db.query(`UPDATE medication_reminder SET is_active=false WHERE medication_id=?`,[req.params.id],()=>{});
  db.query('DELETE FROM medications WHERE id=?',[req.params.id],(err)=>{
    if (err) return res.status(500).json({ message:'Failed' });
    res.json({ message:'Deleted' });
  });
});

app.post('/api/medications/mark-taken', (req, res) => {
  const { medicationId, userId, status } = req.body;
  db.query(
    `INSERT INTO medication_intake (medication_id,user_id,taken_at,status) VALUES (?,?,NOW(),?)`,
    [medicationId, userId, status],
    (err, result) => {
      if (err) return res.status(400).json({ message:'Failed' });
      db.query('SELECT name FROM medications WHERE id=?',[medicationId],(err2,rows)=>{
        const medName = rows&&rows[0]?rows[0].name:'Unknown';
        logActivity(userId, status==='taken'?'medication_taken':'medication_missed',
          `${status==='taken'?'Took':'Missed'} ${medName}`);
      });
      res.json({ message:'Medication logged', logId:result.insertId });
    }
  );
});

app.get('/api/medication-logs/:userId', (req, res) => {
  db.query(
    `SELECT mi.*,m.name,m.dosage,m.time FROM medication_intake mi
     JOIN medications m ON mi.medication_id=m.id
     WHERE mi.user_id=? ORDER BY mi.taken_at DESC LIMIT 100`,
    [req.params.userId],(err,results)=>{
      if (err) return res.status(500).json({ message:'Error' });
      res.json(results||[]);
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
    [req.params.userId],(err,results)=>{
      if (err) return res.status(500).json({ message:'Error' });
      res.json(results||[]);
    }
  );
});

// =============================================================================
// HEALTH LOGS
// =============================================================================
app.post('/api/health-logs', (req, res) => {
  const { userId, logType, value, unit, notes } = req.body;
  if (!userId||!logType||!value||!unit) return res.status(400).json({ message:'Missing required fields' });
  db.query(`INSERT INTO health_logs (user_id,log_type,value,unit,notes) VALUES (?,?,?,?,?)`,[userId,logType,value,unit,notes||null],(err,result)=>{
    if (err) return res.status(400).json({ message:'Failed: '+err.message });
    const label = logType.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase());
    logActivity(userId,'health_log',`Logged ${label}: ${value} ${unit}`);
    notifyCaregivers(userId,'health_log',`📊 New health log: ${label} — ${value} ${unit}${notes?` (${notes})`:''}`, 'low');
    checkHealthRisks(userId,logType,value,unit);
    res.json({ message:'Health data logged', logId:result.insertId });
  });
});

app.get('/api/health-logs/:userId', (req, res) => {
  db.query('SELECT * FROM health_logs WHERE user_id=? ORDER BY logged_at DESC LIMIT 50',[req.params.userId],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

app.get('/api/health-logs/latest/:userId', (req, res) => {
  db.query(`SELECT log_type,value,unit,logged_at FROM health_logs h1 WHERE user_id=? AND logged_at=(SELECT MAX(logged_at) FROM health_logs h2 WHERE h2.user_id=h1.user_id AND h2.log_type=h1.log_type)`,[req.params.userId],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

app.get('/api/health-summary/:userId', (req, res) => {
  db.query(`SELECT log_type,COUNT(*) as total_logs,MAX(logged_at) as last_logged,AVG(CASE WHEN log_type IN ('blood_sugar','heart_rate','weight','temperature') THEN CAST(value AS DECIMAL(10,2)) ELSE NULL END) as avg_value FROM health_logs WHERE user_id=? AND logged_at>=DATE_SUB(NOW(),INTERVAL 7 DAY) GROUP BY log_type`,[req.params.userId],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

app.get('/api/health-trends/:userId/:logType', (req, res) => {
  db.query(`SELECT value,unit,logged_at FROM health_logs WHERE user_id=? AND log_type=? AND logged_at>=DATE_SUB(NOW(),INTERVAL ? DAY) ORDER BY logged_at ASC`,[req.params.userId,req.params.logType,req.query.days||7],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

// =============================================================================
// MOOD
// =============================================================================
app.post('/api/mood', (req, res) => {
  const { userId, mood, notes } = req.body;
  db.query(`INSERT INTO mood_logs (user_id,mood,notes) VALUES (?,?,?)`,[userId,mood,notes||null],(err)=>{
    if (err) return res.status(400).json({ message:'Failed' });
    logActivity(userId,'mood_log',`Mood recorded: ${mood}`);
    const concerning=['sad','anxious','lonely'];
    const priority=concerning.includes(mood)?'high':'low';
    notifyCaregivers(userId,'mood',`${concerning.includes(mood)?'⚠️':'😊'} Mood check-in: ${mood.charAt(0).toUpperCase()+mood.slice(1)}${notes?` — "${notes}"`:''}`,priority);
    res.json({ message:'Mood logged successfully' });
  });
});

app.get('/api/mood/:userId', (req, res) => {
  db.query('SELECT * FROM mood_logs WHERE user_id=? ORDER BY logged_at DESC',[req.params.userId],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

// =============================================================================
// ALERTS
// =============================================================================
app.get('/api/alerts/caregiver/:caregiverId', (req, res) => {
  db.query(`SELECT a.*,u.name as elder_name FROM alerts a JOIN users u ON a.user_id=u.id WHERE a.caregiver_id=? AND a.is_read=false ORDER BY FIELD(a.priority,'critical','high','medium','low'),a.created_at DESC`,[req.params.caregiverId],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

app.get('/api/alerts/caregiver/:caregiverId/all', (req, res) => {
  db.query(`SELECT a.*,u.name as elder_name FROM alerts a JOIN users u ON a.user_id=u.id WHERE a.caregiver_id=? ORDER BY a.created_at DESC LIMIT ?`,[req.params.caregiverId,parseInt(req.query.limit)||50],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

app.get('/api/alerts/elder/:elderId', (req, res) => {
  db.query(`SELECT * FROM alerts WHERE user_id=? AND is_read=false ORDER BY FIELD(priority,'critical','high','medium','low'),created_at DESC LIMIT 50`,[req.params.elderId],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

app.put('/api/alerts/:id/read', (req, res) => {
  db.query('UPDATE alerts SET is_read=true WHERE id=?',[req.params.id],(err)=>{
    if (err) return res.status(400).json({ message:'Failed' });
    res.json({ message:'Alert marked as read' });
  });
});

app.put('/api/alerts/caregiver/:caregiverId/read-all', (req, res) => {
  db.query('UPDATE alerts SET is_read=true WHERE caregiver_id=?',[req.params.caregiverId],(err)=>{
    if (err) return res.status(400).json({ message:'Failed' });
    res.json({ message:'All alerts marked as read' });
  });
});

// =============================================================================
// OVERDUE — dedicated endpoints for caregiver overdue dashboard
// =============================================================================

// Get all overdue items for a specific elder today
app.get('/api/overdue/:elderId', (req, res) => {
  db.query(
    `SELECT mi.*, m.name AS title, m.frequency AS type, m.time AS scheduled_time, m.dosage
     FROM medication_intake mi
     JOIN medications m ON mi.medication_id = m.id
     WHERE mi.user_id = ? AND mi.is_overdue = 1
     AND DATE(mi.taken_at) = CURDATE()
     ORDER BY mi.taken_at DESC`,
    [req.params.elderId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

// Get overdue items across ALL elders for a caregiver
app.get('/api/overdue/caregiver/:caregiverId', (req, res) => {
  db.query(
    `SELECT mi.*, m.name AS title, m.frequency AS type, m.time AS scheduled_time,
            m.dosage, u.name AS elder_name, u.id AS elder_id
     FROM medication_intake mi
     JOIN medications m ON mi.medication_id = m.id
     JOIN users u ON mi.user_id = u.id
     JOIN connections c ON c.elder_id = u.id AND c.requester_id = ? AND c.status = 'approved'
     WHERE mi.is_overdue = 1
     AND DATE(mi.taken_at) = CURDATE()
     ORDER BY mi.taken_at DESC`,
    [req.params.caregiverId],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    }
  );
});

// Get reminder attempt count for a schedule today (so TodayRemindersScreen can show "Reminded 2x")
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
// HEALTH RISKS
// =============================================================================
app.get('/api/health-risks/:elderId', (req, res) => {
  db.query(`SELECT * FROM health_risks WHERE elder_id=? AND resolved=false ORDER BY detected_at DESC`,[req.params.elderId],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

// =============================================================================
// ACTIVITY LOGS
// =============================================================================
app.get('/api/activity/:elderId', (req, res) => {
  db.query(`SELECT * FROM activity_logs WHERE elder_id=? AND logged_at>=DATE_SUB(NOW(),INTERVAL ? DAY) ORDER BY logged_at DESC`,[req.params.elderId,parseInt(req.query.days)||7],(err,results)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json(results||[]);
  });
});

// =============================================================================
// ELDER SUMMARY
// =============================================================================
app.get('/api/elder-summary/:elderId', (req, res) => {
  const elderId = req.params.elderId;
  const result = { todayHealthLogs:0, todayMood:null, todayMedsTaken:0, todayMedsTotal:0, latestVitals:[], activeRisksCount:0, unreadAlertsCount:0, overdueCount:0 };
  let pending = 7;
  const done = () => { if (--pending===0) res.json(result); };

  db.query(`SELECT COUNT(*) as count FROM health_logs WHERE user_id=? AND DATE(logged_at)=CURDATE()`,[elderId],(err,rows)=>{ if(!err&&rows&&rows[0]) result.todayHealthLogs=rows[0].count||0; done(); });
  db.query(`SELECT mood,logged_at FROM mood_logs WHERE user_id=? AND DATE(logged_at)=CURDATE() ORDER BY logged_at DESC LIMIT 1`,[elderId],(err,rows)=>{ if(!err&&rows&&rows.length) result.todayMood=rows[0]; done(); });
  db.query(
    `SELECT COUNT(DISTINCT m.id) as total,
       SUM(CASE WHEN mi.status='taken' AND DATE(mi.taken_at)=CURDATE() THEN 1 ELSE 0 END) as taken
     FROM medications m LEFT JOIN medication_intake mi ON mi.medication_id=m.id WHERE m.user_id=?`,
    [elderId],(err,rows)=>{ if(!err&&rows&&rows[0]){ result.todayMedsTotal=rows[0].total||0; result.todayMedsTaken=rows[0].taken||0; } done(); }
  );
  db.query(`SELECT h1.log_type,h1.value,h1.unit,h1.logged_at FROM health_logs h1 WHERE h1.user_id=? AND h1.logged_at=(SELECT MAX(h2.logged_at) FROM health_logs h2 WHERE h2.user_id=h1.user_id AND h2.log_type=h1.log_type) ORDER BY h1.logged_at DESC`,[elderId],(err,rows)=>{ if(!err&&rows) result.latestVitals=rows; done(); });
  db.query(`SELECT COUNT(*) as count FROM health_risks WHERE elder_id=? AND resolved=false`,[elderId],(err,rows)=>{ if(!err&&rows&&rows[0]) result.activeRisksCount=rows[0].count||0; done(); });
  db.query(`SELECT COUNT(*) as count FROM alerts WHERE user_id=? AND is_read=false`,[elderId],(err,rows)=>{ if(!err&&rows&&rows[0]) result.unreadAlertsCount=rows[0].count||0; done(); });
  db.query(`SELECT COUNT(*) as count FROM medication_intake WHERE user_id=? AND is_overdue=1 AND DATE(taken_at)=CURDATE()`,[elderId],(err,rows)=>{ if(!err&&rows&&rows[0]) result.overdueCount=rows[0].count||0; done(); });
});

// =============================================================================
// REPORTS
// =============================================================================
app.get('/api/reports/weekly/:userId', (req, res) => {
  const userId = req.params.userId;
  let startDate, endDate, intervalDays;
  if (req.query.startDate&&req.query.endDate) {
    startDate=req.query.startDate; endDate=req.query.endDate;
    intervalDays=Math.ceil((new Date(endDate)-new Date(startDate))/(1000*60*60*24))+1;
  } else {
    intervalDays=parseInt(req.query.days)||7;
    const endD=new Date(),startD=new Date();
    startD.setDate(endD.getDate()-(intervalDays-1));
    startDate=startD.toISOString().split('T')[0]; endDate=endD.toISOString().split('T')[0];
  }

  const queries = [
    [`SELECT COUNT(*) as total,SUM(CASE WHEN status='taken' THEN 1 ELSE 0 END) as taken, SUM(CASE WHEN is_overdue=1 THEN 1 ELSE 0 END) as overdue FROM medication_intake WHERE user_id=? AND DATE(taken_at) BETWEEN ? AND ?`,[userId,startDate,endDate]],
    [`SELECT log_type,COUNT(*) as count,AVG(CASE WHEN log_type IN('blood_sugar','heart_rate','weight','temperature') THEN CAST(value AS DECIMAL(10,2)) ELSE NULL END) as avg_value,MAX(value) as max_value,MIN(value) as min_value FROM health_logs WHERE user_id=? AND DATE(logged_at) BETWEEN ? AND ? GROUP BY log_type`,[userId,startDate,endDate]],
    [`SELECT mood,COUNT(*) as count FROM mood_logs WHERE user_id=? AND DATE(logged_at) BETWEEN ? AND ? GROUP BY mood`,[userId,startDate,endDate]],
    [`SELECT COUNT(*) as alert_count FROM alerts WHERE user_id=? AND DATE(created_at) BETWEEN ? AND ?`,[userId,startDate,endDate]],
    [`SELECT risk_type,severity,message,detected_at FROM health_risks WHERE elder_id=? AND DATE(detected_at) BETWEEN ? AND ? ORDER BY detected_at DESC`,[userId,startDate,endDate]],
    [`SELECT activity_type,COUNT(*) as count,DATE(logged_at) as day FROM activity_logs WHERE elder_id=? AND DATE(logged_at) BETWEEN ? AND ? GROUP BY activity_type,DATE(logged_at) ORDER BY day DESC`,[userId,startDate,endDate]],
  ];

  let results=new Array(queries.length).fill(null), done=0;
  queries.forEach(([sql,params],i)=>{
    db.query(sql,params,(err,rows)=>{
      if(!err) results[i]=rows;
      if(++done===queries.length){
        const reportData={
          medications:(results[0]&&results[0][0])||{total:0,taken:0,overdue:0},
          healthLogs:results[1]||[], mood:results[2]||[],
          alerts:(results[3]&&results[3][0])||{alert_count:0},
          risks:results[4]||[], activity:results[5]||[],
          dateRange:{startDate,endDate,days:intervalDays},
        };
        const moodJson=JSON.stringify((results[2]||[]).reduce((a,m)=>{a[m.mood]=m.count;return a;},{}));
        const healthJson=JSON.stringify((results[1]||[]).reduce((a,h)=>{a[h.log_type]={count:h.count,avg:h.avg_value};return a;},{}));
        db.query(`INSERT INTO weekly_reports (elder_id,week_start,week_end,medications_total,medications_taken,health_logs_count,mood_summary,health_summary,alerts_count,generated_at) VALUES (?,?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE medications_total=VALUES(medications_total),medications_taken=VALUES(medications_taken),health_logs_count=VALUES(health_logs_count),mood_summary=VALUES(mood_summary),health_summary=VALUES(health_summary),alerts_count=VALUES(alerts_count),generated_at=NOW()`,
          [userId,startDate,endDate,reportData.medications.total||0,reportData.medications.taken||0,(results[1]||[]).reduce((a,h)=>a+h.count,0),moodJson,healthJson,reportData.alerts.alert_count||0],
          (saveErr)=>{if(saveErr) console.log('Report save error:',saveErr.message);});
        res.json(reportData);
      }
    });
  });
});

// =============================================================================
// SCHEDULES
// =============================================================================
app.post('/api/schedules', (req, res) => {
  const { elderId, caregiverId, type, title, description, dosage,
          scheduledTime, scheduledDays, startDate, endDate,
          repeatInterval, maxReminders } = req.body;

  if (!elderId||!caregiverId||!type||!title||!scheduledTime||!scheduledDays||!startDate)
    return res.status(400).json({ message:'Missing required fields' });

  db.query(`SELECT id FROM connections WHERE requester_id=? AND elder_id=? AND status='approved'`,[caregiverId,elderId],(err,rows)=>{
    if (err||!rows||!rows.length) return res.status(403).json({ message:'Not authorised for this elder' });

    const notesBlob = JSON.stringify({
      desc:      description || null,
      days:      scheduledDays,
      startDate: startDate,
      endDate:   endDate || null,
      interval:  repeatInterval || 30,
      maxRem:    maxReminders  || 3,
      cgId:      caregiverId,
    });

    db.query(
      `INSERT INTO medications (user_id,name,dosage,frequency,time,notes) VALUES (?,?,?,?,?,?)`,
      [elderId, title, dosage||null, type, scheduledTime, notesBlob],
      (err2, result) => {
        if (err2) return res.status(400).json({ message:'DB error: '+err2.message });
        const medId = result.insertId;

        db.query(`INSERT INTO medication_reminder (medication_id,reminder_time,is_active) VALUES (?,?,true)`,[medId,scheduledTime],()=>{});
        db.query(
          `INSERT INTO alerts (user_id,caregiver_id,alert_type,message,is_read,priority,created_at) VALUES (?,?,'schedule',?,false,'medium',NOW())`,
          [elderId, caregiverId, `📅 New ${type} scheduled: "${title}" — starts ${startDate}`],
          ()=>{}
        );

        // Push notify elder about the new schedule
        db.query('SELECT expo_push_token FROM users WHERE id=?', [elderId], async (_, uRows) => {
          if (uRows && uRows[0] && uRows[0].expo_push_token) {
            await sendPushNotification(
              uRows[0].expo_push_token,
              '📅 New Schedule Added',
              `Your caregiver scheduled "${title}" for you starting ${startDate}`,
              { screen: 'TodayReminders' }
            );
          }
        });

        res.json({ message:'Schedule created', scheduleId:medId });
      }
    );
  });
});

app.get('/api/schedules/caregiver/:caregiverId', (req, res) => {
  db.query(
    `SELECT m.*,u.name AS elder_name FROM medications m
     JOIN users u ON m.user_id=u.id
     JOIN connections c ON c.elder_id=u.id AND c.requester_id=? AND c.status='approved'
     ORDER BY u.name,m.time`,
    [req.params.caregiverId],
    (err, rows) => {
      if (err) return res.status(500).json({ message:'Error: '+err.message });
      const result = (rows||[])
        .filter(r=>{ const m=parseMeta(r.notes); return m && String(m.cgId)===String(req.params.caregiverId); })
        .map(r=>toScheduleShape(r));
      res.json(result);
    }
  );
});

app.get('/api/schedules/elder/:elderId', (req, res) => {
  db.query(`SELECT m.* FROM medications m WHERE m.user_id=? ORDER BY m.time`,[req.params.elderId],(err,rows)=>{
    if (err) return res.status(500).json({ message:'Error' });
    res.json((rows||[]).filter(r=>parseMeta(r.notes)).map(r=>toScheduleShape(r)));
  });
});

// GET today's schedule — now includes reminded_count from reminder_logs
app.get('/api/schedules/today/:elderId', (req, res) => {
  const todayISO = new Date().toISOString().split('T')[0];

  db.query(
    `SELECT m.*,
       mi.id        AS log_id,
       mi.status    AS intake_status,
       mi.is_overdue,
       (SELECT COUNT(*) FROM reminder_logs rl
        WHERE rl.medication_id=m.id AND rl.user_id=m.user_id
          AND rl.scheduled_date=?) AS reminded_count
     FROM medications m
     LEFT JOIN medication_intake mi
       ON mi.medication_id=m.id AND mi.user_id=m.user_id AND DATE(mi.taken_at)=CURDATE()
     WHERE m.user_id=? ORDER BY m.time`,
    [todayISO, req.params.elderId],
    (err, rows) => {
      if (err) return res.status(500).json({ message:'Error' });

      const schedRows = (rows||[]).filter(r=>{
        const meta=parseMeta(r.notes);
        if (!meta) return false;
        if (meta.startDate && todayISO<meta.startDate) return false;
        if (meta.endDate   && todayISO>meta.endDate)   return false;
        return isScheduledToday(meta.days);
      });

      if (!schedRows.length) return res.json([]);

      const output = schedRows.map(r=>{
        const meta=parseMeta(r.notes)||{};
        let log_status = null;
        if (r.is_overdue)                                     log_status='overdue';
        else if (r.intake_status==='taken')                   log_status='done';
        else if (r.intake_status==='missed' && !r.is_overdue) log_status='skipped';
        return {
          id:              r.id,
          type:            r.frequency || 'medicine',
          title:           r.name,
          description:     meta.desc      || null,
          dosage:          r.dosage       || null,
          scheduled_time:  r.time,
          caregiver_name:  null,
          repeat_interval: meta.interval  || 30,
          max_reminders:   meta.maxRem    || 3,
          log_id:          r.log_id       || null,
          log_status,
          is_overdue:      r.is_overdue   || 0,
          reminded_count:  r.reminded_count || 0,
          _cgId:           meta.cgId,
        };
      });

      const cgIds=[...new Set(output.map(o=>o._cgId).filter(Boolean))];
      if (!cgIds.length){ output.forEach(o=>delete o._cgId); return res.json(output); }

      db.query(`SELECT id,name FROM users WHERE id IN (?)`,[cgIds],(_, cgRows)=>{
        const cgMap={};
        (cgRows||[]).forEach(u=>{ cgMap[u.id]=u.name; });
        output.forEach(o=>{ o.caregiver_name=cgMap[o._cgId]||'Caregiver'; delete o._cgId; });
        res.json(output);
      });
    }
  );
});

app.put('/api/schedules/:id', (req, res) => {
  const { title, description, dosage, scheduledTime, scheduledDays, endDate, isActive, repeatInterval, maxReminders } = req.body;
  db.query(`SELECT notes FROM medications WHERE id=?`,[req.params.id],(err,rows)=>{
    if (err||!rows||!rows.length) return res.status(404).json({ message:'Not found' });
    const existing=parseMeta(rows[0].notes)||{};
    const notesBlob=JSON.stringify({
      desc:      description!==undefined ? description||null : existing.desc,
      days:      scheduledDays           || existing.days    || ['daily'],
      startDate: existing.startDate      || new Date().toISOString().split('T')[0],
      endDate:   endDate!==undefined     ? endDate||null     : existing.endDate,
      interval:  repeatInterval          || existing.interval || 30,
      maxRem:    maxReminders            || existing.maxRem   || 3,
      cgId:      existing.cgId,
    });
    db.query(`UPDATE medications SET name=?,dosage=?,time=?,notes=? WHERE id=?`,[title,dosage||null,scheduledTime,notesBlob,req.params.id],(err2)=>{
      if (err2) return res.status(400).json({ message:'Failed: '+err2.message });
      db.query(`UPDATE medication_reminder SET reminder_time=? WHERE medication_id=?`,[scheduledTime,req.params.id],()=>{});
      res.json({ message:'Schedule updated' });
    });
  });
});

app.delete('/api/schedules/:id', (req, res) => {
  db.query(`UPDATE medication_reminder SET is_active=false WHERE medication_id=?`,[req.params.id],()=>{});
  db.query(`DELETE FROM medications WHERE id=?`,[req.params.id],(err)=>{
    if (err) return res.status(500).json({ message:'Failed' });
    res.json({ message:'Schedule removed' });
  });
});

// Elder responds — done or skipped
app.post('/api/schedules/respond', (req, res) => {
  const { scheduleId, elderId, status, responseNote, scheduledDate } = req.body;
  const intakeStatus = status==='done' ? 'taken' : 'missed';

  db.query(
    `SELECT id, is_overdue FROM medication_intake WHERE medication_id=? AND user_id=? AND DATE(taken_at)=CURDATE()`,
    [scheduleId, elderId],
    (err, existing) => {
      if (err) return res.status(500).json({ message:'Error' });

      const afterSave = (saveErr) => {
        if (saveErr) return res.status(400).json({ message:'Failed: '+saveErr.message });

        db.query('SELECT name,notes,frequency FROM medications WHERE id=?',[scheduleId],(_,rows)=>{
          if (!rows||!rows.length) return;
          const { name, notes, frequency } = rows[0];
          const meta=parseMeta(notes)||{};
          const type=frequency||'medicine';

          logActivity(elderId,
            status==='done'?'medication_taken':'medication_missed',
            `${status==='done'?'✅':'⏭'} "${name}" (${type}) marked as ${status}${responseNote?': '+responseNote:''}`
          );

          // Mark reminder_logs as responded
          const todayISO = new Date().toISOString().split('T')[0];
          db.query(
            `UPDATE reminder_logs SET status='responded' WHERE medication_id=? AND user_id=? AND scheduled_date=?`,
            [scheduleId, elderId, todayISO], () => {}
          );

          if (meta.cgId) {
            const wasOverdue = existing && existing[0] && existing[0].is_overdue;
            const priority   = status==='done' ? 'low' : wasOverdue ? 'high' : 'medium';
            const alertMsg   = wasOverdue && status==='done'
              ? `✅ "${name}" (${type}) — ${wasOverdue ? 'OVERDUE task now completed!' : 'marked done'}${responseNote?': '+responseNote:''}`
              : `${status==='done'?'✅':'⏭'} "${name}" (${type}) marked as ${status}${responseNote?': '+responseNote:''}`;

            db.query(
              `INSERT INTO alerts (user_id,caregiver_id,alert_type,message,is_read,priority,created_at) VALUES (?,?,'schedule_response',?,false,?,NOW())`,
              [elderId, meta.cgId, alertMsg, priority],
              ()=>{}
            );

            // Push caregiver
            sendCaregiverPush(meta.cgId,
              status==='done' ? '✅ Task Completed' : '⏭ Task Skipped',
              alertMsg
            );
          }
        });

        res.json({ message:'Response recorded' });
      };

      if (existing&&existing.length) {
        db.query(
          `UPDATE medication_intake SET status=?,notes=?,taken_at=NOW(),is_overdue=0 WHERE id=?`,
          [intakeStatus, responseNote||null, existing[0].id],
          (uErr) => afterSave(uErr)
        );
      } else {
        db.query(
          `INSERT INTO medication_intake (medication_id,user_id,taken_at,status,notes,is_overdue) VALUES (?,?,NOW(),?,?,0)`,
          [scheduleId, elderId, intakeStatus, responseNote||null],
          (iErr) => afterSave(iErr)
        );
      }
    }
  );
});

app.get('/api/schedules/compliance/:elderId', (req, res) => {
  const start=req.query.startDate||new Date(Date.now()-7*86400000).toISOString().split('T')[0];
  const end=req.query.endDate||new Date().toISOString().split('T')[0];
  db.query(
    `SELECT m.id,m.frequency AS type,m.name AS title,
       COUNT(mi.id)                                             AS total_logged,
       SUM(CASE WHEN mi.status='taken'  THEN 1 ELSE 0 END)     AS done_count,
       SUM(CASE WHEN mi.status='missed' THEN 1 ELSE 0 END)     AS skipped_count,
       SUM(CASE WHEN mi.is_overdue=1    THEN 1 ELSE 0 END)     AS overdue_count
     FROM medications m
     LEFT JOIN medication_intake mi ON mi.medication_id=m.id AND DATE(mi.taken_at) BETWEEN ? AND ?
     WHERE m.user_id=?
     GROUP BY m.id,m.frequency,m.name ORDER BY m.frequency,m.name`,
    [start,end,req.params.elderId],(err,rows)=>{
      if (err) return res.status(500).json({ message:'Error' });
      res.json(rows||[]);
    }
  );
});

app.get('/api/schedules/today-summary/:elderId', (req, res) => {
  const todayISO=new Date().toISOString().split('T')[0];
  db.query(
    `SELECT m.*,mi.status AS intake_status,mi.is_overdue FROM medications m
     LEFT JOIN medication_intake mi ON mi.medication_id=m.id AND mi.user_id=m.user_id AND DATE(mi.taken_at)=CURDATE()
     WHERE m.user_id=?`,
    [req.params.elderId],(err,rows)=>{
      if (err) return res.status(500).json({ message:'Error' });
      const schedRows=(rows||[]).filter(r=>{
        const meta=parseMeta(r.notes);
        if (!meta) return false;
        if (meta.startDate&&todayISO<meta.startDate) return false;
        if (meta.endDate&&todayISO>meta.endDate) return false;
        return isScheduledToday(meta.days);
      });
      const total   = schedRows.length;
      const done    = schedRows.filter(r=>r.intake_status==='taken').length;
      const skipped = schedRows.filter(r=>r.intake_status==='missed'&&!r.is_overdue).length;
      const overdue = schedRows.filter(r=>r.is_overdue).length;
      const pending = total-done-skipped-overdue;
      res.json({ total, done, skipped, overdue, pending });
    }
  );
});
// new
// =============================================================================
// MEDICATION ACTIVITY FEED
// =============================================================================

app.get('/api/medication-activity/:elderId', (req, res) => {
  const { elderId } = req.params;
  const days = parseInt(req.query.days) || 7;
  db.query(
    `SELECT
       'intake' AS source, mi.id, mi.medication_id,
       mi.user_id AS elder_id,
       mi.status, mi.is_overdue,
       mi.notes AS response_note,
       mi.taken_at AS event_time,
       m.name AS title, m.frequency AS type,
       m.time AS scheduled_time, m.dosage,
       NULL AS attempt_number
     FROM medication_intake mi
     JOIN medications m ON mi.medication_id = m.id
     WHERE mi.user_id = ?
       AND mi.taken_at >= DATE_SUB(NOW(), INTERVAL ? DAY)

     UNION ALL

     SELECT
       'reminder' AS source, rl.id, rl.medication_id,
       rl.user_id AS elder_id,
       rl.status, 0 AS is_overdue,
       NULL AS response_note,
       rl.sent_at AS event_time,
       m.name AS title, m.frequency AS type,
       m.time AS scheduled_time, m.dosage,
       rl.attempt_number
     FROM reminder_logs rl
     JOIN medications m ON rl.medication_id = m.id
     WHERE rl.user_id = ?
       AND rl.sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY)

     ORDER BY event_time DESC LIMIT 100`,
    [elderId, days, elderId, days],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });
      res.json(results || []);
    }
  );
});

app.get('/api/medication-activity/caregiver/:caregiverId', (req, res) => {
  const { caregiverId } = req.params;
  const days = parseInt(req.query.days) || 7;
  db.query(
    `SELECT
       'intake' AS source, mi.id, mi.medication_id,
       mi.user_id AS elder_id, u.name AS elder_name,
       mi.status, mi.is_overdue,
       mi.notes AS response_note,
       mi.taken_at AS event_time,
       m.name AS title, m.frequency AS type,
       m.time AS scheduled_time, m.dosage,
       NULL AS attempt_number
     FROM medication_intake mi
     JOIN medications m ON mi.medication_id = m.id
     JOIN users u ON mi.user_id = u.id
     JOIN connections c ON c.elder_id = u.id AND c.requester_id = ? AND c.status = 'approved'
     WHERE mi.taken_at >= DATE_SUB(NOW(), INTERVAL ? DAY)

     UNION ALL

     SELECT
       'reminder' AS source, rl.id, rl.medication_id,
       rl.user_id AS elder_id, u.name AS elder_name,
       rl.status, 0 AS is_overdue,
       NULL AS response_note,
       rl.sent_at AS event_time,
       m.name AS title, m.frequency AS type,
       m.time AS scheduled_time, m.dosage,
       rl.attempt_number
     FROM reminder_logs rl
     JOIN medications m ON rl.medication_id = m.id
     JOIN users u ON rl.user_id = u.id
     JOIN connections c ON c.elder_id = u.id AND c.requester_id = ? AND c.status = 'approved'
     WHERE rl.sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY)

     ORDER BY event_time DESC LIMIT 200`,
    [caregiverId, days, caregiverId, days],
    (err, results) => {
      if (err) return res.status(500).json({ message: 'Error: ' + err.message });
      res.json(results || []);
    }
  );
});

// =============================================================================
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => { console.log(`Server running on http://192.168.1.68:${PORT}`); });