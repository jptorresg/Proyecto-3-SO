// server.js - Bridge serial <-> websocket + static server
const express = require('express');
const http = require('http');
const cors = require('cors');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');
const env = require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend (coloca tu index.html en ./public)
app.use('/', express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Config (puedes cambiar con env var)
const HTTP_PORT = process.env.PORT || 3000;
const SERIAL_PORT_PATH = process.env.SERIAL_PORT || null; // ej: "/dev/ttyACM0" o "COM3"
const BAUDRATE = 115200;

let serial = null;
let parser = null;

// Broadcast helper
function broadcast(obj){
  const txt = JSON.stringify(obj);
  wss.clients.forEach(client => {
    if(client.readyState === WebSocket.OPEN){
      client.send(txt);
    }
  });
}

// List ports and optionally open one
async function listPorts(){
  try{
    const ports = await SerialPort.list();
    console.log('Ports found:');
    ports.forEach(p => console.log(` - ${p.path} (${p.manufacturer || ''})`));
    return ports;
  }catch(e){
    console.error('Error listing ports', e);
    return [];
  }
}

async function openSerial(portPath){
  if(serial){
    try{ await serial.close(); } catch(e){}
    serial = null;
  }
  serial = new SerialPort({ path: portPath, baudRate: BAUDRATE, autoOpen: false });
  parser = serial.pipe(new ReadlineParser({ delimiter: '\n' }));
  serial.on('open', ()=> {
    console.log(`Serial opened at ${portPath} @ ${BAUDRATE}`);
  });
  serial.on('error', (err)=> {
    console.error('Serial error:', err.message);
  });
  parser.on('data', (line) => {
    line = line.trim();
    if(!line) return;
    console.log('SERIAL ->', line);
    try{
      const obj = JSON.parse(line);
      // forward to websocket clients
      broadcast(obj);
    }catch(e){
      console.warn('Invalid JSON from serial:', e.message);
      // Optionally broadcast raw line
      broadcast({ type:'raw', raw: line });
    }
  });
  await new Promise((res, rej) => {
    serial.open((err) => err ? rej(err) : res());
  });
}

// If SERIAL_PORT env set, open it; otherwise attempt to open first available
(async ()=>{
  const ports = await listPorts();
  let toOpen = SERIAL_PORT_PATH;
  if(!toOpen){
    if(ports.length > 0){
      toOpen = ports[0].path;
      console.log('No SERIAL_PORT set. Will attempt to open:', toOpen);
    } else {
      console.log('No serial ports found (yet). Start server and connect later.');
    }
  }
  if(toOpen){
    try{
      await openSerial(toOpen);
    }catch(e){
      console.error('Failed to open serial port', e.message);
    }
  }
})();

// WebSocket server behaviour
wss.on('connection', function connection(ws){
  console.log('WS client connected. total:', wss.clients.size);
  ws.send(JSON.stringify({ type:'info', msg:'connected to bridge' }));

  ws.on('message', function message(data){
    // expect JSON commands from client to forward to STM32
    try{
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      console.log('WS ->', obj);
      if(serial && serial.writable){
        const txt = JSON.stringify(obj) + '\n';
        serial.write(txt, (err)=> {
          if(err) console.error('Write error to serial:', err.message);
        });
      } else {
        console.log('Serial not open; ignoring write.');
      }
    }catch(e){
      console.warn('Invalid WS message', e.message);
    }
  });

  ws.on('close', ()=> console.log('WS disconnected. total:', wss.clients.size));
});

// HTTP endpoints for control
app.get('/ports', async (req, res) => {
  const ports = await listPorts();
  res.json(ports);
});

app.post('/open', async (req, res) => {
  const { path } = req.body;
  if(!path) return res.status(400).json({error:'path required'});
  try{
    await openSerial(path);
    res.json({ok:true});
  }catch(e){
    res.status(500).json({error: e.message});
  }
});

// simple CLI input to broadcast test events
const stdin = process.openStdin();
stdin.addListener('data', function(d) {
  const s = d.toString().trim();
  if(s === 'test'){
    const ev = { type:'event', ev:'BUTTON_PRESSED', payload:'cat' };
    broadcast(ev);
    console.log('Broadcast test event to WS clients');
  } else {
    console.log('Unknown command on stdin. Type "test" to send test event to clients.');
  }
});

server.listen(HTTP_PORT, () => {
  console.log(`HTTP+WS server listening http://localhost:${HTTP_PORT}`);
  console.log(`WS path ws://localhost:${HTTP_PORT}/ws`);
  console.log('Type "test" + ENTER to broadcast test event (no serial needed).');
});