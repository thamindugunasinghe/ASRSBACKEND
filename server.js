const express = require('express');
const cors = require('cors');
const { ArduinoSerial } = require('./lib/arduino-serial');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Arduino instance
const arduino = new ArduinoSerial();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    arduino_connected: arduino.isConnected()
  });
});

// Arduino connection endpoint
app.post('/api/arduino/connect', async (req, res) => {
  try {
    const { port } = req.body;
    const connected = await arduino.connect(port);
    
    if (connected) {
      res.json({ success: true, message: 'Arduino connected successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Failed to connect to Arduino' });
    }
  } catch (error) {
    console.error('Arduino connection error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Arduino command endpoint
app.post('/api/arduino/command', async (req, res) => {
  try {
    const { command } = req.body;
    
    if (!arduino.isConnected()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Arduino not connected' 
      });
    }

    console.log(`[${new Date().toISOString()}] Executing command: ${command}`);
    
    const response = await arduino.sendCommand(command);
    
    if (response.includes('COMPLETE')) {
      res.json({ 
        success: true, 
        message: 'Command executed successfully',
        response: response
      });
    } else if (response.includes('ERROR')) {
      res.status(400).json({ 
        success: false, 
        message: 'Arduino returned error',
        response: response
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Command sent',
        response: response
      });
    }
  } catch (error) {
    console.error('Arduino command error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Arduino disconnect endpoint
app.post('/api/arduino/disconnect', async (req, res) => {
  try {
    await arduino.disconnect();
    res.json({ success: true, message: 'Arduino disconnected' });
  } catch (error) {
    console.error('Arduino disconnect error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// List available serial ports
app.get('/api/arduino/ports', async (req, res) => {
  try {
    const ports = await arduino.listPorts();
    res.json({ success: true, ports });
  } catch (error) {
    console.error('List ports error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Arduino status endpoint
app.get('/api/arduino/status', (req, res) => {
  res.json({
    connected: arduino.isConnected(),
    port: arduino.getCurrentPort(),
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 ASRS Arduino Backend running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔧 Ready to connect to Arduino...`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  if (arduino.isConnected()) {
    await arduino.disconnect();
    console.log('📱 Arduino disconnected');
  }
  process.exit(0);
});