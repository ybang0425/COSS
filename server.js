const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MariaDB 연결 풀 생성
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'arduino_data',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 데이터베이스 초기화
async function initDatabase() {
  try {
    const connection = await pool.getConnection();
    
    // 테이블 생성
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        id INT AUTO_INCREMENT PRIMARY KEY,
        value INT NOT NULL,
        arduino_timestamp BIGINT,
        pc_timestamp VARCHAR(50),
        server_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_timestamp (server_timestamp)
      )
    `);
    
    connection.release();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// API 엔드포인트

// Arduino 데이터 수신
app.post('/api/data', async (req, res) => {
  try {
    const { value, timestamp, pc_timestamp } = req.body;
    
    // 데이터베이스에 저장
    const [result] = await pool.execute(
      'INSERT INTO sensor_data (value, arduino_timestamp, pc_timestamp) VALUES (?, ?, ?)',
      [value, timestamp, pc_timestamp]
    );
    
    // 실시간으로 클라이언트에 전송
    io.emit('newData', {
      id: result.insertId,
      value,
      arduino_timestamp: timestamp,
      pc_timestamp,
      server_timestamp: new Date()
    });
    
    res.json({ success: true, id: result.insertId });
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 최근 데이터 조회
app.get('/api/data', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const [rows] = await pool.execute(
      'SELECT * FROM sensor_data ORDER BY id DESC LIMIT ?',
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: error.message });
  }
});

// 통계 데이터 조회
app.get('/api/stats', async (req, res) => {
  try {
    const [stats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_records,
        SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END) as count_ones,
        SUM(CASE WHEN value = 0 THEN 1 ELSE 0 END) as count_zeros,
        MAX(server_timestamp) as last_update
      FROM sensor_data
    `);
    res.json(stats[0]);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO 연결 처리
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// 서버 시작
const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
