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
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Connected to MySQL Database.');
});

const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// TEST ENDPOINTS
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() });
});

//  AUTHENTICATION 

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role, phone, dob, gender, emergency } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const regCode = (role === 'elderly') ? generateCode() : null;

    const sql = `INSERT INTO users (name, email, password, role, phone, registration_code, dob, gender, emergency_contact) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    db.query(sql, [name, email, hashedPassword, role, phone, regCode, dob, gender, (role === 'elderly' ? emergency : null)], (err, result) => {
      if (err) return res.status(400).json({ message: 'Registration failed: ' + err.message });
      res.json({ message: 'Success', registration_code: regCode, userId: result.insertId });
    });
  } catch (error) { 
    res.status(500).json({ message: 'Server Error' }); 
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  
  console.log('Login attempt for:', email);
  
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ message: 'Server error' });
    }
    
    if (!results.length) {
      console.log('User not found:', email);
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    const user = results[0];
    console.log('User found:', user.email, 'Role:', user.role);
    
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log('Password mismatch for:', email);
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    console.log('Password matched for:', email);

    if (user.role === 'caregiver' || user.role === 'doctor') {
      const connSql = `SELECT COUNT(*) as count FROM connections WHERE requester_id = ? AND status = 'approved'`;
      db.query(connSql, [user.id], (connErr, connResults) => {
        if (connErr) {
          console.error('Connection check error:', connErr);
          return res.json({ 
            id: user.id, 
            role: user.role, 
            name: user.name, 
            email: user.email,
            code: user.registration_code,
            hasConnection: false
          });
        }
        
        const hasConnection = connResults && connResults[0] && connResults[0].count > 0;
        console.log('Login successful for caregiver:', user.email, 'Has connections:', hasConnection);
        
        res.json({ 
          id: user.id, 
          role: user.role, 
          name: user.name,
          email: user.email,
          code: user.registration_code,
          hasConnection: hasConnection
        });
      });
    } else {
      console.log('Login successful for elderly:', user.email);
      res.json({ 
        id: user.id, 
        role: user.role, 
        name: user.name,
        email: user.email,
        code: user.registration_code 
      });
    }
  });
});

// --- CONNECTIONS ---

app.post('/api/auth/connect', (req, res) => {
  const { requesterId, targetCode, relationship } = req.body;

  db.query('SELECT id, name FROM users WHERE registration_code = ?', [targetCode], (err, results) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (results.length === 0) return res.status(404).json({ message: 'Invalid Code' });

    const elderId = results[0].id;
    if (elderId == requesterId) return res.status(400).json({ message: "Cannot connect to yourself" });

    db.query('SELECT status FROM connections WHERE elder_id = ? AND requester_id = ?', 
    [elderId, requesterId], (err, connResults) => {
      if (connResults.length > 0) {
        return res.status(400).json({ message: 'Already connected or pending' });
      }

      db.query('INSERT INTO connections (elder_id, requester_id, relationship, status) VALUES (?, ?, ?, "pending")', 
      [elderId, requesterId, relationship], (err) => {
        if (err) return res.status(400).json({ message: 'Failed to send request' });
        res.json({ message: 'Request sent successfully!', elderName: results[0].name });
      });
    });
  });
});

app.get('/api/auth/pending/:elderId', (req, res) => {
  const sql = `SELECT c.id as connectionId, u.name, u.role, c.relationship FROM connections c 
               JOIN users u ON c.requester_id = u.id 
               WHERE c.elder_id = ? AND c.status = 'pending'`;
  db.query(sql, [req.params.elderId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching requests' });
    res.json(results || []);
  });
});

app.post('/api/auth/approve-connection', (req, res) => {
  const { connectionId } = req.body;
  db.query('UPDATE connections SET status = "approved" WHERE id = ?', [connectionId], (err) => {
    if (err) return res.status(500).json({ message: 'Approval failed' });
    res.json({ message: 'Approved' });
  });
});

app.post('/api/auth/reject-connection', (req, res) => {
  const { connectionId } = req.body;
  db.query('DELETE FROM connections WHERE id = ?', [connectionId], (err) => {
    if (err) return res.status(500).json({ message: 'Failed to delete request' });
    res.json({ message: 'Request removed' });
  });
});

app.get('/api/connections/:caregiverId', (req, res) => {
  const sql = `SELECT u.id, u.name, u.dob, u.phone, u.emergency_contact, c.relationship 
               FROM connections c
               JOIN users u ON c.elder_id = u.id
               WHERE c.requester_id = ? AND c.status = 'approved'`;
  db.query(sql, [req.params.caregiverId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching connections' });
    res.json(results || []);
  });
});

// --- MEDICATIONS ---

app.post('/api/medications', (req, res) => {
  const { elderId, name, dosage, frequency, time, days, timing, notification, addedBy } = req.body;
  
  const sql = `INSERT INTO medications (user_id, name, dosage, frequency, time, days, timing, notification, added_by) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.query(sql, [elderId, name, dosage, frequency, time, JSON.stringify(days), timing, notification, addedBy], (err, result) => {
    if (err) return res.status(400).json({ message: 'Failed to add medication' });
    res.json({ message: 'Medication added successfully', medicationId: result.insertId });
  });
});

app.get('/api/medications/:userId', (req, res) => {
  const sql = 'SELECT * FROM medications WHERE user_id = ? ORDER BY time';
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching medications' });
    
    const meds = (results || []).map(med => ({
      ...med,
      days: JSON.parse(med.days || '[]')
    }));
    res.json(meds);
  });
});

app.put('/api/medications/:id', (req, res) => {
  const { name, dosage, frequency, time, days, timing, notification } = req.body;
  const sql = `UPDATE medications SET name=?, dosage=?, frequency=?, time=?, days=?, timing=?, notification=? WHERE id=?`;
  
  db.query(sql, [name, dosage, frequency, time, JSON.stringify(days), timing, notification, req.params.id], (err) => {
    if (err) return res.status(400).json({ message: 'Failed to update medication' });
    res.json({ message: 'Medication updated' });
  });
});

app.delete('/api/medications/:id', (req, res) => {
  db.query('DELETE FROM medications WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: 'Failed to delete medication' });
    res.json({ message: 'Medication deleted' });
  });
});

app.post('/api/medications/mark-taken', (req, res) => {
  const { medicationId, userId, status } = req.body;
  
  const sql = `INSERT INTO medication_logs (medication_id, user_id, status, taken_at) VALUES (?, ?, ?, NOW())`;
  
  db.query(sql, [medicationId, userId, status], (err, result) => {
    if (err) return res.status(400).json({ message: 'Failed to log medication' });
    res.json({ message: 'Medication logged', logId: result.insertId });
  });
});

app.get('/api/medication-logs/:userId', (req, res) => {
  const sql = `SELECT ml.*, m.name, m.dosage, m.time FROM medication_logs ml
               JOIN medications m ON ml.medication_id = m.id
               WHERE ml.user_id = ?
               ORDER BY ml.taken_at DESC
               LIMIT 100`;
  
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching logs' });
    res.json(results || []);
  });
});

app.get('/api/medications/today/:userId', (req, res) => {
  const sql = `SELECT m.*, 
               (SELECT COUNT(*) FROM medication_logs ml 
                WHERE ml.medication_id = m.id 
                AND ml.user_id = m.user_id 
                AND DATE(ml.taken_at) = CURDATE()
                AND ml.status = 'taken') as taken_today
               FROM medications m
               WHERE m.user_id = ?
               ORDER BY m.time`;
  
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching today medications' });
    const meds = (results || []).map(med => ({
      ...med,
      days: JSON.parse(med.days || '[]')
    }));
    res.json(meds);
  });
});

// --- HEALTH LOGS WITH ALERTS ---

// Function to check for health risks
function checkHealthRisks(userId, logType, value, unit) {
  const riskCheckSql = `
    SELECT value, logged_at 
    FROM health_logs 
    WHERE user_id = ? AND log_type = ? 
    AND logged_at >= DATE_SUB(NOW(), INTERVAL 3 DAY)
    ORDER BY logged_at DESC 
    LIMIT 5
  `;
  
  db.query(riskCheckSql, [userId, logType], (err, logs) => {
    if (err || logs.length < 3) return;
    
    let riskDetected = false;
    let riskMessage = '';
    
    if (logType === 'blood_pressure') {
      const bpReadings = logs.map(log => {
        const parts = log.value.split('/');
        if (parts.length !== 2) return null;
        const systolic = parseInt(parts[0]);
        const diastolic = parseInt(parts[1]);
        if (isNaN(systolic) || isNaN(diastolic)) return null;
        return { systolic, diastolic, date: log.logged_at };
      }).filter(bp => bp !== null);
      
      if (bpReadings.length < 3) return;
      
      const lowBPCount = bpReadings.filter(bp => bp.systolic < 90 || bp.diastolic < 60).length;
      const highBPCount = bpReadings.filter(bp => bp.systolic > 140 || bp.diastolic > 90).length;
      
      if (lowBPCount >= 3) {
        riskDetected = true;
        riskMessage = `⚠️ LOW BLOOD PRESSURE ALERT: ${lowBPCount} low readings in the last 3 days. Current: ${value} ${unit}`;
      } else if (highBPCount >= 3) {
        riskDetected = true;
        riskMessage = `⚠️ HIGH BLOOD PRESSURE ALERT: ${highBPCount} high readings in the last 3 days. Current: ${value} ${unit}`;
      }
    } else if (logType === 'blood_sugar') {
      const readings = logs.map(log => parseFloat(log.value)).filter(r => !isNaN(r));
      if (readings.length < 3) return;
      
      const lowCount = readings.filter(r => r < 70).length;
      const highCount = readings.filter(r => r > 180).length;
      
      if (lowCount >= 3) {
        riskDetected = true;
        riskMessage = `⚠️ LOW BLOOD SUGAR ALERT: ${lowCount} low readings in the last 3 days. Current: ${value} ${unit}`;
      } else if (highCount >= 3) {
        riskDetected = true;
        riskMessage = `⚠️ HIGH BLOOD SUGAR ALERT: ${highCount} high readings in the last 3 days. Current: ${value} ${unit}`;
      }
    } else if (logType === 'heart_rate') {
      const readings = logs.map(log => parseFloat(log.value)).filter(r => !isNaN(r));
      if (readings.length < 3) return;
      
      const lowCount = readings.filter(r => r < 60).length;
      const highCount = readings.filter(r => r > 100).length;
      
      if (lowCount >= 3) {
        riskDetected = true;
        riskMessage = `⚠️ LOW HEART RATE ALERT: ${lowCount} low readings in the last 3 days. Current: ${value} ${unit}`;
      } else if (highCount >= 3) {
        riskDetected = true;
        riskMessage = `⚠️ HIGH HEART RATE ALERT: ${highCount} high readings in the last 3 days. Current: ${value} ${unit}`;
      }
    }
    
    if (riskDetected) {
      const caregiverSql = `SELECT requester_id FROM connections WHERE elder_id = ? AND status = 'approved'`;
      
      db.query(caregiverSql, [userId], (err2, caregivers) => {
        if (err2 || caregivers.length === 0) return;
        
        const alertValues = caregivers.map(c => [
          userId,
          c.requester_id,
          'vital',
          riskMessage,
          false,
          new Date()
        ]);
        
        const alertSql = `INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, created_at) VALUES ?`;
        db.query(alertSql, [alertValues], (err3) => {
          if (err3) console.log('Alert insert error:', err3);
        });
      });
    }
  });
}

// Function to notify caregivers about new health logs
function notifyCaregiversHealthLog(userId, logType, value, unit, notes) {
  const caregiverSql = `SELECT requester_id FROM connections WHERE elder_id = ? AND status = 'approved'`;
  
  db.query(caregiverSql, [userId], (err, caregivers) => {
    if (err || caregivers.length === 0) return;
    
    const logTypeLabel = logType.replace(/_/g, ' ').toUpperCase();
    const message = `New health log: ${logTypeLabel} - ${value} ${unit}${notes ? ` (${notes})` : ''}`;
    
    const alertValues = caregivers.map(c => [
      userId,
      c.requester_id,
      'health_log',
      message,
      false,
      new Date()
    ]);
    
    const alertSql = `INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, created_at) VALUES ?`;
    db.query(alertSql, [alertValues], (err2) => {
      if (err2) console.log('Health log alert error:', err2);
    });
  });
}

// POST health log
app.post('/api/health-logs', (req, res) => {
  const { userId, logType, value, unit, notes } = req.body;
  
  console.log('Received health log request:', { userId, logType, value, unit, notes });
  
  if (!userId || !logType || !value || !unit) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  
  const sql = `INSERT INTO health_logs (user_id, log_type, value, unit, notes) VALUES (?, ?, ?, ?, ?)`;
  
  db.query(sql, [userId, logType, value, unit, notes || null], (err, result) => {
    if (err) {
      console.log('Health log insert error:', err);
      return res.status(400).json({ message: 'Failed to log health data: ' + err.message });
    }
    
    console.log('Health log inserted successfully:', result.insertId);
    
    // Check for risks and notify caregivers
    checkHealthRisks(userId, logType, value, unit);
    notifyCaregiversHealthLog(userId, logType, value, unit, notes);
    
    res.json({ message: 'Health data logged', logId: result.insertId });
  });
});

// GET health logs
app.get('/api/health-logs/:userId', (req, res) => {
  const sql = 'SELECT * FROM health_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 50';
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching health logs' });
    res.json(results || []);
  });
});

// GET latest health readings
app.get('/api/health-logs/latest/:userId', (req, res) => {
  const sql = `SELECT log_type, value, unit, logged_at 
               FROM health_logs h1
               WHERE user_id = ? 
               AND logged_at = (
                 SELECT MAX(logged_at) 
                 FROM health_logs h2 
                 WHERE h2.user_id = h1.user_id 
                 AND h2.log_type = h1.log_type
               )`;
  
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching latest readings' });
    res.json(results || []);
  });
});

// GET health summary
app.get('/api/health-summary/:userId', (req, res) => {
  const userId = req.params.userId;
  
  const sql = `
    SELECT 
      log_type,
      COUNT(*) as total_logs,
      MAX(logged_at) as last_logged,
      AVG(CASE 
        WHEN log_type = 'blood_sugar' THEN CAST(value AS DECIMAL(10,2))
        WHEN log_type = 'heart_rate' THEN CAST(value AS DECIMAL(10,2))
        WHEN log_type = 'weight' THEN CAST(value AS DECIMAL(10,2))
        WHEN log_type = 'temperature' THEN CAST(value AS DECIMAL(10,2))
        ELSE NULL 
      END) as avg_value
    FROM health_logs 
    WHERE user_id = ? 
    AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY log_type
  `;
  
  db.query(sql, [userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching health summary' });
    res.json(results || []);
  });
});

// GET health trends
app.get('/api/health-trends/:userId/:logType', (req, res) => {
  const { userId, logType } = req.params;
  const days = req.query.days || 7;
  
  const sql = `
    SELECT value, unit, logged_at 
    FROM health_logs 
    WHERE user_id = ? AND log_type = ?
    AND logged_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    ORDER BY logged_at ASC
  `;
  
  db.query(sql, [userId, logType, days], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching trends' });
    res.json(results || []);
  });
});

// --- MOOD TRACKING ---

app.post('/api/mood', (req, res) => {
  const { userId, mood, notes } = req.body;

  const sql = `INSERT INTO mood_logs (user_id, mood, notes) VALUES (?, ?, ?)`;

  db.query(sql, [userId, mood, notes || null], (err, result) => {
    if (err) {
      console.log('Mood insert error:', err);
      return res.status(400).json({ message: 'Failed to log mood' });
    }

    const caregiverSql = `SELECT requester_id FROM connections WHERE elder_id = ? AND status = 'approved'`;

    db.query(caregiverSql, [userId], (err2, caregivers) => {
      if (err2) {
        console.log('Caregiver fetch error:', err2);
        return res.json({ message: 'Mood saved but no alert created' });
      }

      if (caregivers.length > 0) {
        const alertValues = caregivers.map(c => [
          userId,
          c.requester_id,
          'mood',
          `New mood recorded: ${mood}${notes ? ' - ' + notes : ''}`,
          false,
          new Date()
        ]);

        const alertSql = `INSERT INTO alerts (user_id, caregiver_id, alert_type, message, is_read, created_at) VALUES ?`;

        db.query(alertSql, [alertValues], (err3) => {
          if (err3) console.log('Alert insert error:', err3);
        });
      }

      res.json({ message: 'Mood logged successfully' });
    });
  });
});

app.get('/api/mood/:userId', (req, res) => {
  const sql = `SELECT * FROM mood_logs WHERE user_id = ? ORDER BY logged_at DESC`;

  db.query(sql, [req.params.userId], (err, results) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: 'Error fetching moods' });
    }
    res.json(results || []);
  });
});

// --- ALERTS ---

app.post('/api/alerts', (req, res) => {
  const { elderId, caregiverId, type, message, priority } = req.body;
  
  const sql = `INSERT INTO alerts (elder_id, caregiver_id, type, message, priority) VALUES (?, ?, ?, ?, ?)`;
  
  db.query(sql, [elderId, caregiverId, type, message, priority], (err, result) => {
    if (err) return res.status(400).json({ message: 'Failed to create alert' });
    res.json({ message: 'Alert created', alertId: result.insertId });
  });
});

app.get('/api/alerts/caregiver/:caregiverId', (req, res) => {
  const sql = `
    SELECT a.*, u.name as elder_name
    FROM alerts a
    JOIN users u ON a.user_id = u.id
    WHERE a.caregiver_id = ? AND a.is_read = false
    ORDER BY a.created_at DESC
  `;

  db.query(sql, [req.params.caregiverId], (err, results) => {
    if (err) {
      console.log('Fetch alerts error:', err);
      return res.status(500).json({ message: 'Error fetching alerts' });
    }
    res.json(results || []);
  });
});

app.put('/api/alerts/:id/read', (req, res) => {
  db.query('UPDATE alerts SET is_read = true WHERE id = ?', [req.params.id], (err) => {
    if (err) return res.status(400).json({ message: 'Failed to update alert' });
    res.json({ message: 'Alert marked as read' });
  });
});

// --- WEEKLY REPORTS ---

app.get('/api/reports/weekly/:userId', (req, res) => {
  const userId = req.params.userId;
  
  const medSql = `SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END) as taken
    FROM medication_logs
    WHERE user_id = ? AND taken_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  
  const healthSql = `
    SELECT 
      log_type,
      COUNT(*) as count,
      AVG(CASE 
        WHEN log_type = 'blood_sugar' THEN CAST(value AS DECIMAL(10,2))
        WHEN log_type = 'heart_rate' THEN CAST(value AS DECIMAL(10,2))
        WHEN log_type = 'weight' THEN CAST(value AS DECIMAL(10,2))
        WHEN log_type = 'temperature' THEN CAST(value AS DECIMAL(10,2))
        ELSE NULL 
      END) as avg_value,
      MAX(value) as max_value,
      MIN(value) as min_value
    FROM health_logs 
    WHERE user_id = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    GROUP BY log_type
  `;
  
  const moodSql = `SELECT mood, COUNT(*) as count FROM mood_logs 
                   WHERE user_id = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                   GROUP BY mood`;
  
  const alertsSql = `SELECT COUNT(*) as alert_count FROM alerts 
                     WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  
  db.query(medSql, [userId], (err, medResults) => {
    if (err) return res.status(500).json({ message: 'Error generating report' });
    
    db.query(healthSql, [userId], (err, healthResults) => {
      if (err) return res.status(500).json({ message: 'Error generating report' });
      
      db.query(moodSql, [userId], (err, moodResults) => {
        if (err) return res.status(500).json({ message: 'Error generating report' });
        
        db.query(alertsSql, [userId], (err, alertResults) => {
          if (err) return res.status(500).json({ message: 'Error generating report' });
          
          res.json({
            medications: medResults[0] || { total: 0, taken: 0 },
            healthLogs: healthResults || [],
            mood: moodResults || [],
            alerts: alertResults[0] || { alert_count: 0 }
          });
        });
      });
    });
  });
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://192.168.1.68:${PORT}`);
});
