/*
  3-Axis ASRS Control - CNC Shield V3 + Arduino Mega
  Modified for Web Dashboard Integration
  X = columns (horizontal), Y = rows (vertical), Z = lift/lower (pick)
  No limit switches; purely step-based testing.
  Optimized: Concurrent (interleaved) X/Y movement to save time.
  Updated sequences for PICK and PUT with lift threshold.
  Updated to accept slot input from web dashboard like 'PUT:B06' or 'PICK:C04'.
*/

// ===== PIN DEFINITIONS =====
const int enPin    = 8;   // Enable all drivers (LOW = enabled)
const int stepXPin = 2;   // X-axis step
const int dirXPin  = 5;   // X-axis direction
const int stepYPin = 3;   // Y-axis step
const int dirYPin  = 6;   // Y-axis direction
const int stepZPin = 4;   // Z-axis step
const int dirZPin  = 7;   // Z-axis direction

// ===== SYSTEM PARAMETERS =====
const int maxColumns    = 8;     // Number of columns in rack
const int maxRows       = 7;     // Number of rows in rack
const long stepsPerCol  = 2000;  // Steps X motor per column
const long stepsPerRow  = 1500;  // Steps Y motor per row
const long stepsZTravel = 1000;  // Steps Z motor for full extend/retract
const long liftThreshold = 300;  // Small Y steps for lifting/lowering pallet (calibrate this)
const long delayStep    = 800;   // Microseconds between step pulses

// ===== STATE TRACKERS =====
long posX = 0;  // Current X position in steps
long posY = 0;  // Current Y position in steps
long posZ = 0;  // Current Z position in steps

void setup() {
  Serial.begin(9600);
  // Configure pins
  pinMode(enPin, OUTPUT);
  pinMode(stepXPin, OUTPUT);
  pinMode(dirXPin, OUTPUT);
  pinMode(stepYPin, OUTPUT);
  pinMode(dirYPin, OUTPUT);
  pinMode(stepZPin, OUTPUT);
  pinMode(dirZPin, OUTPUT);
  // Initially disable drivers
  digitalWrite(enPin, HIGH);
  Serial.println("READY"); // Send ready status to dashboard
}

void loop() {
  if (!Serial) return;
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();
    
    // Parse command format: "PUT:B06" or "PICK:C04"
    int colonIndex = cmd.indexOf(':');
    if (colonIndex > 0) {
      String operation = cmd.substring(0, colonIndex);
      String slot = cmd.substring(colonIndex + 1);
      
      if (operation == "PUT" || operation == "PICK") {
        handleOperation(operation, slot);
      } else {
        Serial.println("ERROR:Invalid command format");
      }
    } else {
      Serial.println("ERROR:Invalid command format. Use PUT:B06 or PICK:C04");
    }
  }
}

// Helper: Convert row letter (A-G) to index (0-6)
int rowFromChar(char c) {
  if (c >= 'A' && c <= 'G') {
    return c - 'A';
  }
  return -1; // Invalid character
}

// Slot parser: e.g. "B06" -> row=1, col=5
bool parseSlot(String slot, int &row, int &col) {
  slot.trim();
  slot.toUpperCase();
  if (slot.length() < 3) return false;
  
  char rowChar = slot.charAt(0);
  String colStr = slot.substring(1);
  
  row = rowFromChar(rowChar);
  col = colStr.toInt() - 1; // Columns entered as 01-08, store 0-7
  
  if (row < 0 || row > 6 || col < 0 || col > 7) return false;
  return true;
}

// Main operation using slots
void handleOperation(String op, String slot) {
  int row, col;
  if (!parseSlot(slot, row, col)) {
    Serial.println("ERROR:Invalid slot format");
    return;
  }

  Serial.println("LOADING"); // Send loading status to dashboard
  
  digitalWrite(enPin, LOW); // Enable drivers

  long targetX = col * stepsPerCol;  // X is columns (left to right)
  long targetY = row * stepsPerRow;  // Y is rows (top to bottom)

  if (op == "PICK") {
    moveXYConcurrent(targetX, targetY);
    moveAxis(stepZPin, dirZPin, posZ + stepsZTravel, posZ);           // Lower Z
    moveAxis(stepYPin, dirYPin, posY + liftThreshold, posY);          // Slight Y lift
    moveAxis(stepZPin, dirZPin, posZ - stepsZTravel, posZ);           // Raise Z
    moveXYConcurrent(0, 0);
  } else if (op == "PUT") {
    moveXYConcurrent(targetX, targetY + liftThreshold);
    moveAxis(stepZPin, dirZPin, posZ + stepsZTravel, posZ);           // Lower Z (put)
    moveAxis(stepYPin, dirYPin, posY - liftThreshold, posY);          // Lower Y
    moveAxis(stepZPin, dirZPin, posZ - stepsZTravel, posZ);           // Raise Z
    moveXYConcurrent(0, 0);
  }

  delay(500); // Wait 500ms for motors to fully settle
  
  digitalWrite(enPin, HIGH); // Disable drivers
  
  delay(100); // Wait 100ms after disabling drivers
  
  Serial.println("COMPLETE"); // Send completion status to dashboard
}

// Move X and Y concurrently to absolute targets (updates posX and posY)
void moveXYConcurrent(long targetX, long targetY) {
  long deltaX = targetX - posX;
  long deltaY = targetY - posY;
  bool dirX = (deltaX >= 0);
  bool dirY = (deltaY >= 0);
  long stepsX = abs(deltaX);
  long stepsY = abs(deltaY);
  
  // Set directions
  digitalWrite(dirXPin, dirX ? HIGH : LOW);
  digitalWrite(dirYPin, dirY ? HIGH : LOW);
  
  long maxSteps = max(stepsX, stepsY);
  long currentX = 0;
  long currentY = 0;
  
  for (long i = 0; i < maxSteps; i++) {
    if (currentX < stepsX) {
      digitalWrite(stepXPin, HIGH);
      delayMicroseconds(delayStep);
      digitalWrite(stepXPin, LOW);
      delayMicroseconds(delayStep);
      currentX++;
      posX += dirX ? 1 : -1;
    }
    
    if (currentY < stepsY) {
      digitalWrite(stepYPin, HIGH);
      delayMicroseconds(delayStep);
      digitalWrite(stepYPin, LOW);
      delayMicroseconds(delayStep);
      currentY++;
      posY += dirY ? 1 : -1;
    }
  }
}

// Move single axis to targetSteps absolute
void moveAxis(int stepPin, int dirPin, long targetSteps, long &pos) {
  long delta = targetSteps - pos;
  bool direction = (delta >= 0);
  moveSteps(stepPin, dirPin, abs(delta), pos, direction);
}

// Core stepper function: move `steps` in direction `dirFlag` (updates pos)
void moveSteps(int stepPin, int dirPin, long steps, long &pos, bool dirFlag) {
  digitalWrite(dirPin, dirFlag ? HIGH : LOW);
  for (long i = 0; i < steps; i++) {
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(delayStep);
    digitalWrite(stepPin, LOW);
    delayMicroseconds(delayStep);
    pos += dirFlag ? 1 : -1;
  }
}