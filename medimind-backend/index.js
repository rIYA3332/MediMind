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
  password: '', // Your MySQL password
  database: 'medimind',
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Connected to MySQL Database.');
});

// Helper: Generate 6-digit alphanumeric code
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// --- AUTHENTICATION ROUTES ---

// REGISTER: 
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
  } catch (error) { res.status(500).json({ message: 'Server Error' }); }
});

// LOGIN: 
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (!results.length) return res.status(401).json({ message: 'Invalid credentials' });
    
    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });

    res.json({ 
      id: user.id, 
      role: user.role, 
      name: user.name, 
      code: user.registration_code 
    });
  });
});

// --- CONNECTION LOGIC ---

// CONNECT: Caregiver requests to link with Elder using a Code
app.post('/api/auth/connect', (req, res) => {
  const { requesterId, targetCode, relationship } = req.body;

  // 1. Find the Elder by their registration code
  db.query('SELECT id FROM users WHERE registration_code = ?', [targetCode], (err, results) => {
    if (err) return res.status(500).json({ message: 'Server error' });
    if (results.length === 0) return res.status(404).json({ message: 'Invalid Code: Elder not found' });

    const elderId = results[0].id;

    // 2. Prevent connecting to yourself (if someone tries)
    if (elderId == requesterId) {
        return res.status(400).json({ message: "You cannot connect to your own account." });
    }

    // 3. Check if a connection already exists (Pending OR Approved)
    db.query('SELECT status FROM connections WHERE elder_id = ? AND requester_id = ?', 
    [elderId, requesterId], (err, connResults) => {
      
      if (connResults.length > 0) {
        const status = connResults[0].status;
        return res.status(400).json({ 
          message: status === 'pending' ? 'Request already sent and is pending approval.' : 'You are already linked to this user.' 
        });
      }

      // 4. Create new pending connection
      db.query('INSERT INTO connections (elder_id, requester_id, status) VALUES (?, ?, "pending")', 
      [elderId, requesterId], (err) => {
        if (err) return res.status(400).json({ message: 'Failed to send request' });
        res.json({ message: 'Request sent successfully! Please ask the Elder to approve it.' });
      });
    });
  });
});

// PENDING REQUESTS: Fetches caregivers/doctors waiting for approval for a specific Elder
app.get('/api/auth/pending/:elderId', (req, res) => {
  const sql = `SELECT c.id as connectionId, u.name, u.role FROM connections c 
               JOIN users u ON c.requester_id = u.id 
               WHERE c.elder_id = ? AND c.status = 'pending'`;
  db.query(sql, [req.params.elderId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error fetching requests' });
    res.json(results || []);
  });
});

// APPROVE: Change status from 'pending' to 'approved'
app.post('/api/auth/approve-connection', (req, res) => {
  const { connectionId } = req.body;
  db.query('UPDATE connections SET status = "approved" WHERE id = ?', [connectionId], (err) => {
    if (err) return res.status(500).json({ message: 'Approval failed' });
    res.json({ message: 'Approved' });
  });
});

// REJECT/REMOVE: Deletes the connection request
app.post('/api/auth/reject-connection', (req, res) => {
  const { connectionId } = req.body;
  db.query('DELETE FROM connections WHERE id = ?', [connectionId], (err) => {
    if (err) return res.status(500).json({ message: 'Failed to delete request' });
    res.json({ message: 'Request removed' });
  });
});

// Start server
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://10.125.81.28:${PORT}`);
});