const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const TIMEOUT = 40000; // milliseconds

class ArduinoSerial {
  constructor() {
    this.port = null;
    this.parser = null;
    this.currentPortPath = null;
  }

  async listPorts() {
    try {
      const ports = await SerialPort.list();
      return ports.map(port => ({
        path: port.path,
        manufacturer: port.manufacturer,
        serialNumber: port.serialNumber,
        vendorId: port.vendorId,
        productId: port.productId
      }));
    } catch (error) {
      console.error('Error listing ports:', error);
      throw error;
    }
  }

  async connect(portPath = null) {
    try {
      // If no port specified, try to find Arduino automatically
      if (!portPath) {
        const ports = await this.listPorts();
        const arduinoPorts = ports.filter(port => 
          port.manufacturer && (
            port.manufacturer.toLowerCase().includes('arduino') ||
            port.manufacturer.toLowerCase().includes('ch340') ||
            port.manufacturer.toLowerCase().includes('ftdi')
          )
        );
        
        if (arduinoPorts.length === 0) {
          throw new Error('No Arduino found. Please specify port manually.');
        }
        
        portPath = arduinoPorts[0].path;
        console.log(`🔍 Auto-detected Arduino on port: ${portPath}`);
      }

      // Close existing connection if any
      if (this.port && this.port.isOpen) {
        await this.disconnect();
      }

      // Create new serial port connection
      this.port = new SerialPort({
        path: portPath,
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none'
      });

      // Create parser for reading lines
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
      this.currentPortPath = portPath;

      // Wait for port to open
      await new Promise((resolve, reject) => {
        this.port.on('open', () => {
          console.log(`✅ Connected to Arduino on ${portPath}`);
          resolve();
        });
        
        this.port.on('error', (error) => {
          console.error('Serial port error:', error);
          reject(error);
        });
      });

      // Wait for Arduino to be ready
      await this.waitForReady();
      
      return true;
    } catch (error) {
      console.error('Failed to connect to Arduino:', error);
      this.port = null;
      this.parser = null;
      this.currentPortPath = null;
      throw error;
    }
  }

  async waitForReady(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Arduino ready timeout'));
      }, timeout);

      const onData = (data) => {
        const response = data.toString().trim();
        console.log(`📨 Arduino: ${response}`);
        
        if (response.includes('READY')) {
          clearTimeout(timer);
          this.parser.off('data', onData);
          resolve();
        }
      };

      this.parser.on('data', onData);
    });
  }

  async sendCommand(command) {
    if (!this.isConnected()) {
      throw new Error('Arduino not connected');
    }

    return new Promise((resolve, reject) => {
      let receivedLoading = false;
      const timeout = setTimeout(() => {
        this.parser.off('data', onResponse);
        reject(new Error('Command timeout - Last state: ' + (receivedLoading ? 'LOADING' : 'No response')));
      }, 120000); // 120 second timeout (2 minutes)

      const onResponse = (data) => {
        const response = data.toString().trim();
        console.log(`📨 Arduino response: ${response}`);

        if (response.includes('LOADING')) {
          receivedLoading = true;
        }

        if (response.includes('COMPLETE')) {
          clearTimeout(timeout);
          this.parser.off('data', onResponse);
          resolve(response);
        } else if (response.includes('ERROR')) {
          clearTimeout(timeout);
          this.parser.off('data', onResponse);
          reject(new Error('Arduino reported error: ' + response));
        }
      };

      // Clean up any existing listeners before adding new one
      this.parser.removeAllListeners('data');
      this.parser.on('data', onResponse);
      
      // Send command
      console.log(`📤 Sending command: ${command}`);
      this.port.write(command + '\n');
    });
  }

  async disconnect() {
    if (this.port && this.port.isOpen) {
      await new Promise((resolve) => {
        this.port.close(() => {
          console.log('📱 Arduino disconnected');
          resolve();
        });
      });
    }
    
    this.port = null;
    this.parser = null;
    this.currentPortPath = null;
  }

  isConnected() {
    return this.port && this.port.isOpen;
  }

  getCurrentPort() {
    return this.currentPortPath;
  }
}

module.exports = { ArduinoSerial };