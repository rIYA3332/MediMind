const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const cors = require('cors');

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

const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role, phone, dob, gender, emergency } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const regCode = (role === 'elderly') ? generateCode() : null;
    const sql = `INSERT INTO users (name, email, password, role, phone, registration_code, dob, gender, emergency_contact) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(sql, [name, email, hashedPassword, role, phone, regCode, dob, gender, (role === 'elderly' ? emergency : null)], (err, result) => {
      if (err) return res.status(400).json({ message: 'Registration failed: ' + err.message });
      res.json({ message: 'Success', registration_code: regCode, userId: result.insertId });
    });
  } catch (error) { res.status(500).json({ message: 'Server Error' }); }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!results.length) return res.status(401).json({ message: 'Invalid credentials' });
    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });
    if (user.role === 'caregiver' || user.role === 'doctor') {
      const connSql = `SELECT COUNT(*) as count FROM connections WHERE requester_id = ? AND status = 'approved'`;
      db.query(connSql, [user.id], (connErr, connResults) => {
        const hasConnection = connResults && connResults[0] && connResults[0].count > 0;
        res.json({ id: user.id, role: user.role, name: user.name, email: user.email, code: user.registration_code, hasConnection });
      });
    } else {
      res.json({ id: user.id, role: user.role, name: user.name, email: user.email, code: user.registration_code });
    }
  });
});

app.post('/api/auth/connect', (req, res) => {
  const { requesterId, targetCode, relationship } = req.body;
  db.query('SELECT id, name FROM users WHERE registration_code = ?', [targetCode], (err, results) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!results.length) return res.status(404).json({ message: 'Invalid Code' });
    const elderId = results[0].id;
    if (elderId == requesterId) return res.status(400).json({ message: "Cannot connect to yourself" });
    db.query('SELECT status FROM connections WHERE elder_id = ? AND requester_id = ?', [elderId, requesterId], (err, connResults) => {
      if (connResults && connResults.length > 0) return res.status(400).json({ message: 'Already connected or pending' });
      db.query('INSERT INTO connections (elder_id, requester_id, relationship, status) VALUES (?, ?, ?, "pending")',
        [elderId, requesterId, relationship], (err) => {
          if (err) return res.status(400).json({ message: 'Failed to send request' });
          res.json({ message: 'Request sent successfully!', elderName: results[0].name });
        });
    });
  });
});

app.get('/api/auth/pending/:elderId', (req, res) => {
  const sql = `SELECT c.id as connectionId, u.name, u.role, c.relationship FROM connections c JOIN users u ON c.requester_id = u.id WHERE c.elder_id = ? AND c.status = 'pending'`;
  db.query(sql, [req.params.elderId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json(results || []);
  });
});

app.post('/api/auth/approve-connection', (req, res) => {
  db.query('UPDATE connections SET status = "approved" WHERE id = ?', [req.body.connectionId], (err) => {
    if (err) return res.status(500).json({ message: 'Approval failed' });
    res.json({ message: 'Approved' });
  });
});

app.post('/api/auth/reject-connection', (req, res) => {
  db.query('DELETE FROM connections WHERE id = ?', [req.body.connectionId], (err) => {
    if (err) return res.status(500).json({ message: 'Failed' });
    res.json({ message: 'Request removed' });
  });
});

app.get('/api/connections/:caregiverId', (req, res) => {
  const sql = `SELECT u.id, u.name, u.dob, u.phone, u.emergency_contact, c.relationship FROM connections c JOIN users u ON c.elder_id = u.id WHERE c.requester_id = ? AND c.status = 'approved'`;
  db.query(sql, [req.params.caregiverId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json(results || []);
  });
});

app.post('/api/medications', (req, res) => {
  const { elderId, name, dosage, frequency, time, days, timing, notification, addedBy } = req.body;
  db.query(`INSERT INTO medications (user_id, name, dosage, frequency, time, days, timing, notification, added_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    [elderId, name, dosage, frequency, time, JSON.stringify(days), timing, notification, addedBy], (err, result) => {
      if (err) return res.status(400).json({ message: 'Failed to add medication' });
      res.json({ message: 'Medication added successfully', medicationId: result.insertId });
    });
});

app.get('/api/medications/:userId', (req, res) => {
  db.query('SELECT * FROM medications WHERE user_id = ? ORDER BY time', [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json((results || []).map(med => ({ ...med, days: JSON.parse(med.days || '[]') })));
  });
});

app.put('/api/medications/:id', (req, res) => {
  const { name, dosage, frequency, time, days, timing, notification } = req.body;
  db.query(`UPDATE medications SET name=?,dosage=?,frequency=?,time=?,days=?,timing=?,notification=? WHERE id=?`,
    [name, dosage, frequency, time, JSON.stringify(days), timing, notification, req.params.id], (err) => {
      if (err) return res.status(400).json({ message: 'Failed to update' });
      res.json({ message: 'Medication updated' });
    });
});

app.delete('/api/medications/:id', (req, res) => {
  db.query('DELETE FROM medications WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: 'Failed' });
    res.json({ message: 'Deleted' });
  });
});

app.post('/api/medications/mark-taken', (req, res) => {
  const { medicationId, userId, status } = req.body;
  db.query(`INSERT INTO medication_logs (medication_id, user_id, status, taken_at) VALUES (?,?,?,NOW())`,
    [medicationId, userId, status], (err, result) => {
      if (err) return res.status(400).json({ message: 'Failed' });
      db.query('SELECT name FROM medications WHERE id = ?', [medicationId], (err2, medResults) => {
        const medName = medResults && medResults[0] ? medResults[0].name : 'Unknown';
        logActivity(userId, status === 'taken' ? 'medication_taken' : 'medication_missed',
          `${status === 'taken' ? 'Took' : 'Missed'} ${medName}`);
      });
      res.json({ message: 'Medication logged', logId: result.insertId });
    });
});

app.get('/api/medication-logs/:userId', (req, res) => {
  const sql = `SELECT ml.*, m.name, m.dosage, m.time FROM medication_logs ml JOIN medications m ON ml.medication_id = m.id WHERE ml.user_id = ? ORDER BY ml.taken_at DESC LIMIT 100`;
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json(results || []);
  });
});

app.get('/api/medications/today/:userId', (req, res) => {
  const sql = `SELECT m.*, (SELECT COUNT(*) FROM medication_logs ml WHERE ml.medication_id = m.id AND ml.user_id = m.user_id AND DATE(ml.taken_at) = CURDATE() AND ml.status = 'taken') as taken_today FROM medications m WHERE m.user_id = ? ORDER BY m.time`;
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json((results || []).map(med => ({ ...med, days: JSON.parse(med.days || '[]') })));
  });
});

function logActivity(elderId, activityType, description) {
  db.query(`INSERT INTO activity_logs (elder_id, activity_type, description) VALUES (?,?,?)`,
    [elderId, activityType, description], (err) => {
      if (err) console.log('Activity log error:', err.message);
    });
}

function notifyCaregivers(elderId, alertType, message, priority = 'medium') {
  db.query(`SELECT requester_id FROM connections WHERE elder_id = ? AND status = 'approved'`,
    [elderId], (err, caregivers) => {
      if (err || !caregivers || caregivers.length === 0) return;
      const vals = caregivers.map(c => [elderId, c.requester_id, alertType, message, false, priority, new Date()]);
      db.query(`INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, priority, created_at) VALUES ?`,
        [vals], (err2) => { if (err2) console.log('Alert error:', err2.message); });
    });
}

function checkHealthRisks(userId, logType, value, unit) {
  db.query(`SELECT value FROM health_logs WHERE user_id = ? AND log_type = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL 3 DAY) ORDER BY logged_at DESC LIMIT 5`,
    [userId, logType], (err, logs) => {
      if (err || !logs || logs.length < 3) return;
      let riskDetected = false, riskMessage = '', severity = 'warning', riskType = '', priority = 'medium';

      if (logType === 'blood_pressure') {
        const readings = logs.map(l => { const p = l.value.split('/'); if (p.length !== 2) return null; const s = parseInt(p[0]), d = parseInt(p[1]); return isNaN(s) || isNaN(d) ? null : { s, d }; }).filter(Boolean);
        if (readings.length < 3) return;
        const critHigh = readings.filter(r => r.s > 180 || r.d > 120).length;
        const high = readings.filter(r => r.s > 140 || r.d > 90).length;
        const low = readings.filter(r => r.s < 90 || r.d < 60).length;
        if (critHigh >= 2) { riskDetected = true; severity = 'critical'; riskType = 'critical_high_bp'; priority = 'critical'; riskMessage = `🚨 CRITICAL BP: Blood pressure dangerously high (${value} ${unit}). SEEK IMMEDIATE MEDICAL ATTENTION.`; }
        else if (high >= 3) { riskDetected = true; severity = 'danger'; riskType = 'high_blood_pressure'; priority = 'high'; riskMessage = `⚠️ HIGH BP: ${high} elevated readings in 3 days. Current: ${value} ${unit}. Please consult a doctor.`; }
        else if (low >= 3) { riskDetected = true; severity = 'warning'; riskType = 'low_blood_pressure'; priority = 'high'; riskMessage = `⚠️ LOW BP: ${low} low readings in 3 days. Current: ${value} ${unit}. Monitor closely.`; }
      } else if (logType === 'blood_sugar') {
        const readings = logs.map(l => parseFloat(l.value)).filter(r => !isNaN(r));
        if (readings.length < 3) return;
        const critLow = readings.filter(r => r < 54).length;
        const low = readings.filter(r => r < 70).length;
        const high = readings.filter(r => r > 180).length;
        if (critLow >= 2) { riskDetected = true; severity = 'critical'; riskType = 'critical_low_sugar'; priority = 'critical'; riskMessage = `🚨 CRITICAL SUGAR: Blood sugar dangerously low (${value} ${unit}). EMERGENCY ATTENTION NEEDED.`; }
        else if (low >= 3) { riskDetected = true; severity = 'danger'; riskType = 'low_blood_sugar'; priority = 'high'; riskMessage = `⚠️ LOW SUGAR: ${low} low readings in 3 days. Current: ${value} ${unit}.`; }
        else if (high >= 3) { riskDetected = true; severity = 'warning'; riskType = 'high_blood_sugar'; priority = 'medium'; riskMessage = `⚠️ HIGH SUGAR: ${high} elevated readings in 3 days. Current: ${value} ${unit}.`; }
      } else if (logType === 'heart_rate') {
        const readings = logs.map(l => parseFloat(l.value)).filter(r => !isNaN(r));
        if (readings.length < 3) return;
        const critHigh = readings.filter(r => r > 130).length;
        const high = readings.filter(r => r > 100).length;
        const low = readings.filter(r => r < 60).length;
        if (critHigh >= 2) { riskDetected = true; severity = 'critical'; riskType = 'critical_high_hr'; priority = 'critical'; riskMessage = `🚨 CRITICAL HEART RATE: ${value} ${unit} — dangerously high. SEEK IMMEDIATE HELP.`; }
        else if (high >= 3) { riskDetected = true; severity = 'danger'; riskType = 'high_heart_rate'; priority = 'high'; riskMessage = `⚠️ HIGH HEART RATE: ${high} elevated readings in 3 days. Current: ${value} ${unit}.`; }
        else if (low >= 3) { riskDetected = true; severity = 'warning'; riskType = 'low_heart_rate'; priority = 'medium'; riskMessage = `⚠️ LOW HEART RATE: ${low} low readings in 3 days. Current: ${value} ${unit}.`; }
      } else if (logType === 'temperature') {
        const readings = logs.map(l => parseFloat(l.value)).filter(r => !isNaN(r));
        if (readings.length < 3) return;
        const critHigh = readings.filter(r => r >= 103).length;
        const low = readings.filter(r => r < 96).length;
        if (critHigh >= 2) { riskDetected = true; severity = 'critical'; riskType = 'high_fever'; priority = 'critical'; riskMessage = `🚨 HIGH FEVER: Temperature ${value}${unit}. MEDICAL ATTENTION REQUIRED NOW.`; }
        else if (low >= 2) { riskDetected = true; severity = 'danger'; riskType = 'low_temperature'; priority = 'high'; riskMessage = `⚠️ LOW TEMP: ${low} low temperature readings. Current: ${value}${unit}.`; }
      }

      if (riskDetected) {
        db.query(`INSERT INTO health_risks (elder_id, risk_type, log_type, severity, message, readings_count) VALUES (?,?,?,?,?,?)`,
          [userId, riskType, logType, severity, riskMessage, logs.length]);
        notifyCaregivers(userId, 'vital', riskMessage, priority);
      }
    });
}

app.post('/api/health-logs', (req, res) => {
  const { userId, logType, value, unit, notes } = req.body;
  if (!userId || !logType || !value || !unit) return res.status(400).json({ message: 'Missing required fields' });
  db.query(`INSERT INTO health_logs (user_id, log_type, value, unit, notes) VALUES (?,?,?,?,?)`,
    [userId, logType, value, unit, notes || null], (err, result) => {
      if (err) return res.status(400).json({ message: 'Failed: ' + err.message });
      const label = logType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      logActivity(userId, 'health_log', `Logged ${label}: ${value} ${unit}`);
      notifyCaregivers(userId, 'health_log', `📊 New health log: ${label} — ${value} ${unit}${notes ? ` (${notes})` : ''}`, 'low');
      checkHealthRisks(userId, logType, value, unit);
      res.json({ message: 'Health data logged', logId: result.insertId });
    });
});

app.get('/api/health-logs/:userId', (req, res) => {
  db.query('SELECT * FROM health_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 50',
    [req.params.userId], (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    });
});

app.get('/api/health-logs/latest/:userId', (req, res) => {
  const sql = `SELECT log_type, value, unit, logged_at FROM health_logs h1 WHERE user_id = ? AND logged_at = (SELECT MAX(logged_at) FROM health_logs h2 WHERE h2.user_id = h1.user_id AND h2.log_type = h1.log_type)`;
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json(results || []);
  });
});

app.get('/api/health-summary/:userId', (req, res) => {
  const sql = `SELECT log_type, COUNT(*) as total_logs, MAX(logged_at) as last_logged, AVG(CASE WHEN log_type IN ('blood_sugar','heart_rate','weight','temperature') THEN CAST(value AS DECIMAL(10,2)) ELSE NULL END) as avg_value FROM health_logs WHERE user_id = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY log_type`;
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json(results || []);
  });
});

app.get('/api/health-trends/:userId/:logType', (req, res) => {
  db.query(`SELECT value, unit, logged_at FROM health_logs WHERE user_id = ? AND log_type = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY logged_at ASC`,
    [req.params.userId, req.params.logType, req.query.days || 7], (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    });
});

app.post('/api/mood', (req, res) => {
  const { userId, mood, notes } = req.body;
  db.query(`INSERT INTO mood_logs (user_id, mood, notes) VALUES (?,?,?)`, [userId, mood, notes || null], (err) => {
    if (err) return res.status(400).json({ message: 'Failed' });
    logActivity(userId, 'mood_log', `Mood recorded: ${mood}`);
    const concerning = ['sad', 'anxious', 'lonely'];
    const priority = concerning.includes(mood) ? 'high' : 'low';
    notifyCaregivers(userId, 'mood', `${concerning.includes(mood) ? '⚠️' : '😊'} Mood check-in: ${mood.charAt(0).toUpperCase() + mood.slice(1)}${notes ? ` — "${notes}"` : ''}`, priority);
    res.json({ message: 'Mood logged successfully' });
  });
});

app.get('/api/mood/:userId', (req, res) => {
  db.query(`SELECT * FROM mood_logs WHERE user_id = ? ORDER BY logged_at DESC`, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json(results || []);
  });
});

app.get('/api/alerts/caregiver/:caregiverId', (req, res) => {
  const sql = `SELECT a.*, u.name as elder_name FROM alerts a JOIN users u ON a.user_id = u.id WHERE a.caregiver_id = ? AND a.is_read = false ORDER BY FIELD(a.priority,'critical','high','medium','low'), a.created_at DESC`;
  db.query(sql, [req.params.caregiverId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json(results || []);
  });
});

app.get('/api/alerts/caregiver/:caregiverId/all', (req, res) => {
  const sql = `SELECT a.*, u.name as elder_name FROM alerts a JOIN users u ON a.user_id = u.id WHERE a.caregiver_id = ? ORDER BY a.created_at DESC LIMIT ?`;
  db.query(sql, [req.params.caregiverId, parseInt(req.query.limit) || 50], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error' });
    res.json(results || []);
  });
});

app.put('/api/alerts/:id/read', (req, res) => {
  db.query('UPDATE alerts SET is_read = true WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(400).json({ message: 'Failed' });
    res.json({ message: 'Alert marked as read' });
  });
});

app.put('/api/alerts/caregiver/:caregiverId/read-all', (req, res) => {
  db.query('UPDATE alerts SET is_read = true WHERE caregiver_id = ?', [req.params.caregiverId], (err) => {
    if (err) return res.status(400).json({ message: 'Failed' });
    res.json({ message: 'All alerts marked as read' });
  });
});

app.get('/api/health-risks/:elderId', (req, res) => {
  db.query(`SELECT * FROM health_risks WHERE elder_id = ? AND resolved = false ORDER BY detected_at DESC`,
    [req.params.elderId], (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    });
});

app.get('/api/activity/:elderId', (req, res) => {
  db.query(`SELECT * FROM activity_logs WHERE elder_id = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ORDER BY logged_at DESC`,
    [req.params.elderId, parseInt(req.query.days) || 7], (err, results) => {
      if (err) return res.status(500).json({ message: 'Error' });
      res.json(results || []);
    });
});

app.get('/api/elder-summary/:elderId', (req, res) => {
  const elderId = req.params.elderId;
  const result = { todayHealthLogs: 0, todayMood: null, todayMedsTaken: 0, todayMedsTotal: 0, latestVitals: [], activeRisksCount: 0, unreadAlertsCount: 0 };
  let pending = 6;
  const done = () => { if (--pending === 0) res.json(result); };

  db.query(`SELECT COUNT(*) as count FROM health_logs WHERE user_id = ? AND DATE(logged_at) = CURDATE()`, [elderId], (err, rows) => { if (!err && rows && rows[0]) result.todayHealthLogs = rows[0].count || 0; done(); });
  db.query(`SELECT mood, logged_at FROM mood_logs WHERE user_id = ? AND DATE(logged_at) = CURDATE() ORDER BY logged_at DESC LIMIT 1`, [elderId], (err, rows) => { if (!err && rows && rows.length > 0) result.todayMood = rows[0]; done(); });
  db.query(`SELECT COUNT(DISTINCT m.id) as total, SUM(CASE WHEN ml.status = 'taken' AND DATE(ml.taken_at) = CURDATE() THEN 1 ELSE 0 END) as taken FROM medications m LEFT JOIN medication_logs ml ON ml.medication_id = m.id WHERE m.user_id = ?`, [elderId], (err, rows) => { if (!err && rows && rows[0]) { result.todayMedsTotal = rows[0].total || 0; result.todayMedsTaken = rows[0].taken || 0; } done(); });
  db.query(`SELECT h1.log_type, h1.value, h1.unit, h1.logged_at FROM health_logs h1 WHERE h1.user_id = ? AND h1.logged_at = (SELECT MAX(h2.logged_at) FROM health_logs h2 WHERE h2.user_id = h1.user_id AND h2.log_type = h1.log_type) ORDER BY h1.logged_at DESC`, [elderId], (err, rows) => { if (!err && rows) result.latestVitals = rows; done(); });
  db.query(`SELECT COUNT(*) as count FROM health_risks WHERE elder_id = ? AND resolved = false`, [elderId], (err, rows) => { if (!err && rows && rows[0]) result.activeRisksCount = rows[0].count || 0; done(); });
  db.query(`SELECT COUNT(*) as count FROM alerts WHERE user_id = ? AND is_read = false`, [elderId], (err, rows) => { if (!err && rows && rows[0]) result.unreadAlertsCount = rows[0].count || 0; done(); });
});

app.get('/api/reports/weekly/:userId', (req, res) => {
  const userId = req.params.userId;
  let startDate, endDate, intervalDays;

  if (req.query.startDate && req.query.endDate) {
    startDate = req.query.startDate;
    endDate = req.query.endDate;
    intervalDays = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
  } else {
    intervalDays = parseInt(req.query.days) || 7;
    const endD = new Date();
    const startD = new Date();
    startD.setDate(endD.getDate() - (intervalDays - 1));
    startDate = startD.toISOString().split('T')[0];
    endDate = endD.toISOString().split('T')[0];
  }

  const queries = [
    [`SELECT COUNT(*) as total, SUM(CASE WHEN status='taken' THEN 1 ELSE 0 END) as taken FROM medication_logs WHERE user_id=? AND DATE(taken_at) BETWEEN ? AND ?`, [userId, startDate, endDate]],
    [`SELECT log_type,COUNT(*) as count,AVG(CASE WHEN log_type IN('blood_sugar','heart_rate','weight','temperature') THEN CAST(value AS DECIMAL(10,2)) ELSE NULL END) as avg_value,MAX(value) as max_value,MIN(value) as min_value FROM health_logs WHERE user_id=? AND DATE(logged_at) BETWEEN ? AND ? GROUP BY log_type`, [userId, startDate, endDate]],
    [`SELECT mood,COUNT(*) as count FROM mood_logs WHERE user_id=? AND DATE(logged_at) BETWEEN ? AND ? GROUP BY mood`, [userId, startDate, endDate]],
    [`SELECT COUNT(*) as alert_count FROM alerts WHERE user_id=? AND DATE(created_at) BETWEEN ? AND ?`, [userId, startDate, endDate]],
    [`SELECT risk_type,severity,message,detected_at FROM health_risks WHERE elder_id=? AND DATE(detected_at) BETWEEN ? AND ? ORDER BY detected_at DESC`, [userId, startDate, endDate]],
    [`SELECT activity_type,COUNT(*) as count,DATE(logged_at) as day FROM activity_logs WHERE elder_id=? AND DATE(logged_at) BETWEEN ? AND ? GROUP BY activity_type,DATE(logged_at) ORDER BY day DESC`, [userId, startDate, endDate]],
  ];

  let results = new Array(queries.length).fill(null);
  let done = 0;
  queries.forEach(([sql, params], i) => {
    db.query(sql, params, (err, rows) => {
      if (!err) results[i] = rows;
      if (++done === queries.length) {
        const reportData = {
          medications: (results[0] && results[0][0]) || { total: 0, taken: 0 },
          healthLogs: results[1] || [],
          mood: results[2] || [],
          alerts: (results[3] && results[3][0]) || { alert_count: 0 },
          risks: results[4] || [],
          activity: results[5] || [],
          dateRange: { startDate, endDate, days: intervalDays },
        };
        const moodJson = JSON.stringify((results[2] || []).reduce((a, m) => { a[m.mood] = m.count; return a; }, {}));
        const healthJson = JSON.stringify((results[1] || []).reduce((a, h) => { a[h.log_type] = { count: h.count, avg: h.avg_value }; return a; }, {}));
        db.query(`INSERT INTO weekly_reports (elder_id,week_start,week_end,medications_total,medications_taken,health_logs_count,mood_summary,health_summary,alerts_count,generated_at) VALUES (?,?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE medications_total=VALUES(medications_total),medications_taken=VALUES(medications_taken),health_logs_count=VALUES(health_logs_count),mood_summary=VALUES(mood_summary),health_summary=VALUES(health_summary),alerts_count=VALUES(alerts_count),generated_at=NOW()`,
          [userId, startDate, endDate, reportData.medications.total || 0, reportData.medications.taken || 0, (results[1] || []).reduce((a, h) => a + h.count, 0), moodJson, healthJson, reportData.alerts.alert_count || 0],
          (saveErr) => { if (saveErr) console.log('Report save error:', saveErr.message); });
        res.json(reportData);
      }
    });
  });
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => { console.log(`Server running on http://192.168.1.68:${PORT}`); });