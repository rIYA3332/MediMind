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

    // For caregivers, check if they have approved connections
    if (user.role === 'caregiver' || user.role === 'doctor') {
      const connSql = `SELECT COUNT(*) as count FROM connections WHERE requester_id = ? AND status = 'approved'`;
      db.query(connSql, [user.id], (connErr, connResults) => {
        if (connErr) {
          console.error('Connection check error:', connErr);
          // Don't fail login, just assume no connections
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

// --- MEDICATIONS (Caregivers add for elders) ---

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

// --- HEALTH LOGS ---

app.post('/api/health-logs', (req, res) => {
  const { userId, logType, value, unit, notes } = req.body;
  
  const sql = `INSERT INTO health_logs (user_id, log_type, value, unit, notes) VALUES (?, ?, ?, ?, ?)`;
  
  db.query(sql, [userId, logType, value, unit, notes], (err, result) => {
    if (err) return res.status(400).json({ message: 'Failed to log health data' });
    res.json({ message: 'Health data logged', logId: result.insertId });
  });
});

app.get('/api/health-logs/:userId', (req, res) => {
  const sql = 'SELECT * FROM health_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 50';
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching health logs' });
    res.json(results || []);
  });
});

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

// --- MOOD TRACKING ---

app.post('/api/mood', (req, res) => {
  const { userId, mood, notes } = req.body;
  
  const sql = `INSERT INTO mood_logs (user_id, mood, notes) VALUES (?, ?, ?)`;
  
  db.query(sql, [userId, mood, notes], (err, result) => {
    if (err) return res.status(400).json({ message: 'Failed to log mood' });
    res.json({ message: 'Mood logged', moodId: result.insertId });
  });
});

app.get('/api/mood/:userId', (req, res) => {
  const sql = 'SELECT * FROM mood_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 30';
  db.query(sql, [req.params.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching mood logs' });
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
  const sql = `SELECT a.*, u.name as elder_name FROM alerts a
               JOIN users u ON a.elder_id = u.id
               WHERE a.caregiver_id = ? AND a.read_status = false
               ORDER BY a.created_at DESC`;
  
  db.query(sql, [req.params.caregiverId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching alerts' });
    res.json(results || []);
  });
});

app.put('/api/alerts/:id/read', (req, res) => {
  db.query('UPDATE alerts SET read_status = true WHERE id = ?', [req.params.id], (err) => {
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
  
  const healthSql = `SELECT COUNT(*) as count FROM health_logs 
                     WHERE user_id = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
  
  const moodSql = `SELECT mood, COUNT(*) as count FROM mood_logs 
                   WHERE user_id = ? AND logged_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                   GROUP BY mood`;
  
  db.query(medSql, [userId], (err, medResults) => {
    if (err) return res.status(500).json({ message: 'Error generating report' });
    
    db.query(healthSql, [userId], (err, healthResults) => {
      if (err) return res.status(500).json({ message: 'Error generating report' });
      
      db.query(moodSql, [userId], (err, moodResults) => {
        if (err) return res.status(500).json({ message: 'Error generating report' });
        
        res.json({
          medications: medResults[0],
          healthLogs: healthResults[0],
          mood: moodResults || []
        });
      });
    });
  });
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://192.168.1.67:${PORT}`);
});