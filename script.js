
/*
  FRONTEND PRINCIPAL (HTML + JS)
  - Preparado para recibir JSON por WebSerial (115200) o WebSocket.
  - Parser incremental: acumula bytes hasta '\n', luego JSON.parse.
  - Punto central de lectura: handleIncomingJson(obj)
  - Mock mode: genera estados y eventos para probar UI.
*/

/* ---------- Estado local ---------- */
const state = {
  grid: {rows:8, cols:8},
  restaurants: [], // {id, pos:{av,ca}, algo, queue}
  houses: [],      // {id, pos:{av,ca}}
  drivers: [],     // {id, pos:{av,ca}, load:[], target:{av,ca}, eta_s}
  orders: [],      // {id, house, rest, state, t_prep_s, t_left_s}
  metrics: {},
  history: [],     // {ts,msg}
  traces: [],      // para export
};

/* ---------- Canvas / dibujo ---------- */
const canvas = document.getElementById('gridCanvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const rows = 8, cols = 8;
let cellW = W/cols, cellH = H/rows;
let selectedCell = null;
let animRequest = null;
let paused = false;
let simSpeed = 1;

function resizeCanvas(){
  // si quisieras adaptativo, recalcular cellW/cellH
}
function drawGrid(){
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle = '#d5dbe0';
  for(let i=0;i<=cols;i++){
    const x = i*cellW;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
  }
  for(let j=0;j<=rows;j++){
    const y = j*cellH;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
  }
  // draw cell labels
  ctx.fillStyle = '#333';
  ctx.font = '12px Arial';
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const x = c*cellW, y=r*cellH;
      ctx.fillText(`Av${c+1}-C${r+1}`, x+6, y+16);
    }
  }
}

function drawMarkers(){
  // Draw restaurants
  for(const r of state.restaurants){
    drawRestaurant(r);
  }
  // Draw houses
  for(const h of state.houses){
    drawHouse(h);
  }
  // Draw drivers (with routes)
  for(const d of state.drivers){
    drawDriver(d);
  }
  // Draw orders status as small badges in their house cell
  for(const o of state.orders){
    const house = state.houses.find(h=>h.id===o.house);
    if(!house) continue;
    const px = (house.pos.av -1)*cellW;
    const py = (house.pos.ca -1)*cellH;
    drawOrderBadge(px,py,o);
  }
}

function drawRestaurant(r){
  const px = (r.pos.av -1)*cellW;
  const py = (r.pos.ca -1)*cellH;
  // draw small rectangle at top edge of cell to represent "en la cara"
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff8c1a';
  ctx.fillRect(px + cellW*0.18, py + 4, cellW*0.64, 16);
  ctx.fillStyle = '#fff';
  ctx.font = '12px Arial';
  ctx.fillText(r.id, px + cellW*0.22, py+15);
}

function drawHouse(h){
  const px = (h.pos.av -1)*cellW;
  const py = (h.pos.ca -1)*cellH;
  // draw small circle on left edge
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--house').trim() || '#2b7bd3';
  ctx.beginPath();
  ctx.arc(px + 12, py + cellH*0.6, 10, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '11px Arial';
  ctx.fillText(h.id.replace('H',''), px+6, py + cellH*0.64);
}

function drawDriver(d){
  const px = (d.pos.av -1)*cellW;
  const py = (d.pos.ca -1)*cellH;
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--driver').trim() || '#2fa84f';
  // small triangle
  ctx.beginPath();
  ctx.moveTo(px + cellW*0.8, py + cellH*0.2);
  ctx.lineTo(px + cellW*0.9, py + cellH*0.4);
  ctx.lineTo(px + cellW*0.7, py + cellH*0.4);
  ctx.closePath();
  ctx.fill();
  // label
  ctx.fillStyle = '#fff';
  ctx.font = '12px Arial';
  ctx.fillText(d.id, px + cellW*0.72, py + cellH*0.36);
  // route: if driver.target exists draw line to target (Manhattan polyline)
  if(d.target){
    const points = manhattanPolyline(d.pos, d.target);
    ctx.strokeStyle = 'rgba(47,168,79,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for(let i=0;i<points.length;i++){
      const p = points[i];
      const cx = (p.av -1)*cellW + cellW/2;
      const cy = (p.ca -1)*cellH + cellH/2;
      if(i===0) ctx.moveTo(cx,cy); else ctx.lineTo(cx,cy);
    }
    ctx.stroke();
  }
}

function drawOrderBadge(px,py,o){
  // small status color box
  const map = {
    'CREADO':'s-created',
    'PREPARING':'s-preparing',
    'READY':'s-ready',
    'SEARCHING_DRIVER':'s-search',
    'EN_REPARTO':'s-onroute',
    'DELIVERED':'s-delivered'
  };
  const cls = map[o.state] || 's-created';
  const col = window.getComputedStyle(document.querySelector('.' + cls))?.backgroundColor || '#999';
  ctx.fillStyle = col;
  ctx.fillRect(px + cellW*0.72, py + cellH*0.72, 20, 20);
}

/* Manhattan polyline helper */
function manhattanPolyline(from, to){
  // returns array of waypoints with av,ca for a simple L shaped path: first along av then ca
  const arr = [];
  arr.push({av: from.av, ca: from.ca});
  arr.push({av: to.av, ca: from.ca});
  arr.push({av: to.av, ca: to.ca});
  return arr;
}

/* ---------- Main loop ---------- */
function renderLoop(){
  if(paused) return;
  drawGrid();
  drawMarkers();
  animRequest = requestAnimationFrame(renderLoop);
}

/* ---------- UI Actions ---------- */
canvas.addEventListener('click', (ev)=>{
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const av = Math.floor(x/cellW)+1;
  const ca = Math.floor(y/cellH)+1;
  selectedCell = {av, ca};
  // show modal to create order
  openCreateModal(selectedCell);
});

document.getElementById('modalCancel').onclick = ()=> closeModal();
document.getElementById('modalConfirm').onclick = ()=> {
  const rest = document.getElementById('modalSelectRest').value;
  createOrderManual(selectedCell, rest);
  closeModal();
};
document.getElementById('btnCreateManual').onclick = ()=> {
  // fallback: use dropdown selection and default last clicked
  const rest = document.getElementById('selectRest').value;
  createOrderManual(selectedCell || {av:1, ca:1}, rest);
};
document.getElementById('connectBtn').onclick = connectOrStart;
document.getElementById('pauseBtn').onclick = ()=>{
  paused = !paused;
  document.getElementById('pauseBtn').textContent = paused ? 'Reanudar' : 'Pausar';
  if(!paused) renderLoop();
};
document.getElementById('stressBtn').onclick = ()=> {
  // send special mock command or call mock generator
  if(comm.mode === 'mock') comm.mockStress();
  else if(comm.mode === 'websocket') comm.sendCommand({type:'cmd', cmd:'STRESS', n:30});
  else if(comm.portWriter) comm.sendCommand({type:'cmd', cmd:'STRESS', n:30});
};

/* ---------- Modal helpers ---------- */
function openCreateModal(coords) {
  document.getElementById('modalCoords').textContent = `Destino: Av${coords.av} - C${coords.ca}`;
  populateModalRests();
  document.getElementById('modalCreate').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modalCreate').style.display = 'none';
}

/* ---------- Populate selects based on state ---------- */
function populateRests() {
  const sel = document.getElementById('selectRest');
  sel.innerHTML = '';
  state.restaurants.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.id;
    sel.appendChild(opt);
  });
}

function populateModalRests() {
  const sel = document.getElementById('modalSelectRest');
  sel.innerHTML = '';
  state.restaurants.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.id} (Av${r.pos.av}, C${r.pos.ca})`;
    sel.appendChild(opt);
  });
}

/* ---------- Create order manual: sends JSON cmd to comm service ---------- */
function createOrderManual(coords, restId) {
  if (!coords || !restId) {
    addHistory("Error crear pedido: falta destino o restaurante");
    return;
  }

  const cmd = {
    type: 'cmd',
    cmd: 'CREATE_ORDER',
    house: { av: coords.av, ca: coords.ca },
    restaurant: restId
  };

  addHistory(`Crear pedido manual -> casa Av${coords.av}-C${coords.ca} restaurante ${restId}`);
  comm.sendCommand(cmd);

  // add to traces local (optimistic)
  state.traces = state.traces || [];
  state.traces.push({ ts: Date.now(), action: 'CREATE_ORDER', payload: cmd });
}

/* ---------- Tables update ---------- */
function refreshTables() {
  // orders table
  const tbody = document.querySelector('#ordersTable tbody');
  tbody.innerHTML = '';
  const filter = document.getElementById('filterState').value;
  const q = document.getElementById('searchOrder').value.trim();

  for (const o of state.orders) {
    if (filter !== 'all' && o.state !== filter) continue;
    if (q && !String(o.id).includes(q)) continue;

    const tr = document.createElement('tr');

    const tdId = document.createElement('td');
    tdId.textContent = o.id;
    tr.appendChild(tdId);

    const tdState = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'status-badge ' + statusClass(o.state);
    span.textContent = o.state;
    tdState.appendChild(span);
    tr.appendChild(tdState);

    const tdPrep = document.createElement('td');
    tdPrep.textContent = o.t_prep_s ? `${o.t_prep_s}s` : '-';
    tr.appendChild(tdPrep);

    const tdDriver = document.createElement('td');
    tdDriver.textContent = o.assignedTo || '-';
    tr.appendChild(tdDriver);

    tbody.appendChild(tr);
  }

  // drivers
  const tbodyD = document.querySelector('#driversTable tbody');
  tbodyD.innerHTML = '';
  for (const d of state.drivers) {
    const tr = document.createElement('tr');

    const td1 = document.createElement('td');
    td1.textContent = d.id;
    tr.appendChild(td1);

    const td2 = document.createElement('td');
    td2.textContent = (d.load && d.load.length) ? d.load.length : 0;
    tr.appendChild(td2);

    const td3 = document.createElement('td');
    td3.textContent = d.target ? `Av${d.target.av}, C${d.target.ca}` : '-';
    tr.appendChild(td3);

    tbodyD.appendChild(tr);
  }

  // restaurants
  const tbodyR = document.querySelector('#restsTable tbody');
  tbodyR.innerHTML = '';
  for (const r of state.restaurants) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.id}</td><td>Av${r.pos.av}, C${r.pos.ca}</td><td>${r.queue ?? 0}</td><td>${r.algo ?? 'SJF'}</td>`;
    tbodyR.appendChild(tr);
  }
}

/* helper status class */
function statusClass(s) {
  if (!s) return 's-created';
  if (s.includes('PREPAR')) return 's-preparing';
  if (s === 'READY') return 's-ready';
  if (s.includes('SEARCH')) return 's-search';
  if (s.includes('EN_REPARTO') || s.includes('ON_ROUTE')) return 's-onroute';
  if (s.includes('DELIVERED')) return 's-delivered';
  return 's-created';
}

/* ---------- History / traces ---------- */
function addHistory(msg) {
  const ts = Date.now();
  state.history.unshift({ ts, msg });
  if (state.history.length > 200) state.history.pop();
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById('history');
  el.innerHTML = '';
  for (const h of state.history) {
    const div = document.createElement('div');
    const time = new Date(h.ts).toLocaleTimeString();
    div.innerHTML = `<span style="color:#999;font-size:12px">${time}</span> - ${h.msg}`;
    el.appendChild(div);
  }
}


/* ---------- Export traces ---------- */
document.getElementById('downloadTraces').onclick = ()=>{
  const data = JSON.stringify(state.traces || [], null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download = 'traces.json'; a.click();
};

/* ---------- COMM SERVICE (WebSerial + WebSocket + Mock) ---------- */
const comm = {
  mode: 'mock',
  port: null,
  portReader: null,
  portWriter: null,
  ws: null,
  mockInterval: null,
  buffer: '',

  async start(mode){
    this.mode = mode;
    if(mode === 'webserial'){
      await this.startSerial();
    } else if(mode === 'websocket'){
      this.startWebSocket();
    } else {
      this.startMock();
    }
  },

  async startSerial(){
    if(!('serial' in navigator)){
      alert('WebSerial API no disponible en este navegador. Use Chrome/Edge en localhost o HTTPS.');
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      this.port = port;
      this.portReader = port.readable.getReader();
      this.portWriter = port.writable.getWriter();
      addHistory('Puerto serial abierto');
      // read loop incremental
      this.readSerialLoop();
    } catch(err){
      console.error('Error abrir serial', err);
      addHistory('Error abrir serial: ' + err.message);
    }
  },

  async readSerialLoop(){
    // Lee bytes y acumula hasta '\n' para parsear JSON por línea
    try {
      while(this.port && this.port.readable){
        const { value, done } = await this.portReader.read();
        if(done) break;
        if(value){
          // value es Uint8Array
          const text = new TextDecoder().decode(value);
          this.buffer += text;
          let idx;
          while((idx = this.buffer.indexOf('\\n')) >= 0){
            const line = this.buffer.slice(0, idx).trim();
            this.buffer = this.buffer.slice(idx+1);
            if(line.length === 0) continue;
            try {
              const obj = JSON.parse(line);
              // <-- Aquí se recibe un JSON desde la placa vía WebSerial
              // dispatch it to UI handlers:
              handleIncomingJson(obj);
            } catch(e){
              console.warn('JSON Parse error', e, line);
              addHistory('JSON parse error from serial: ' + e.message);
            }
          }
        }
      }
    } catch(e){
      console.error('readSerialLoop err', e);
      addHistory('readSerialLoop err: ' + e.message);
    } finally {
      if(this.portReader){ try{ this.portReader.releaseLock(); }catch(e){} }
    }
  },

  async sendCommand(obj){
    // obj -> stringify + '\n' and send via writer or websocket or handle mock
    const txt = JSON.stringify(obj) + '\\n';
    if(this.mode === 'webserial' && this.portWriter){
      try {
        await this.portWriter.write(new TextEncoder().encode(txt));
        addHistory('CMD -> serial: ' + obj.cmd);
      } catch(e){ console.error(e); addHistory('Error enviar cmd serial: ' + e.message); }
    } else if(this.mode === 'websocket' && this.ws && this.ws.readyState === WebSocket.OPEN){
      this.ws.send(txt);
      addHistory('CMD -> ws: ' + obj.cmd);
    } else if(this.mode === 'mock'){
      // Mock responds locally (e.g., create immediate event)
      mockHandleIncomingCommand(obj);
    } else {
      addHistory('No conectado: comando no enviado');
    }
  },

  startWebSocket(){
    const url = prompt('WebSocket URL (ej: ws://localhost:9000/ws):','ws://localhost:9000/ws');
    if(!url) return;
    this.ws = new WebSocket(url);
    this.ws.onopen = ()=> addHistory('WS conectado ' + url);
    this.ws.onmessage = (ev)=> {
      try {
        const obj = JSON.parse(ev.data);
        handleIncomingJson(obj);
      } catch(e){ console.warn('WS parse err', e); }
    };
    this.ws.onclose = ()=> addHistory('WS cerrado');
    this.ws.onerror = (e)=> addHistory('WS error');
  },

  startMock(){
    addHistory('Mock iniciado');
    // generate default map only first time
    if(state.restaurants.length===0) createDefaultMap();
    // periodic snapshots (200ms)
    if(this.mockInterval) clearInterval(this.mockInterval);
    this.mockInterval = setInterval(()=>{
      if(paused) return;
      const snapshot = mockGenerateSnapshot();
      handleIncomingJson(snapshot);
    }, 200 / simSpeed);
  },

  stop(){
    if(this.port){ try{ this.port.close(); addHistory('Puerto serial cerrado'); }catch(e){} }
    if(this.ws){ try{ this.ws.close(); }catch(e){} }
    if(this.mockInterval) clearInterval(this.mockInterval);
  },

  mockStress(){
    // generate many orders in mock mode quickly
    addHistory('Mock: stress test 30 pedidos');
    for(let i=0;i<30;i++){
      setTimeout(()=>{
        const coords = {av: Math.floor(Math.random()*8)+1, ca: Math.floor(Math.random()*8)+1};
        const rest = state.restaurants[Math.floor(Math.random()*state.restaurants.length)].id;
        const cmd = {type:'cmd', cmd:'CREATE_ORDER', house: coords, restaurant: rest};
        mockHandleIncomingCommand(cmd);
      }, i*80);
    }
  }
};

/* ---------- Handling incoming JSON ---------- */
function handleIncomingJson(obj){
  if(!obj || !obj.type) return;
  if(obj.type === 'state'){
    // complete snapshot: replace local state
    // Update local state in a safe way, keeping traces/history as needed
    // IMPORTANT: This is the point where JSON received from the placa (via WebSerial or WebSocket)
    // is parsed and applied. The expected structure is the "state" contract provided in las instrucciones.
    applyStateSnapshot(obj);
    addHistory('Snapshot recibido t=' + (obj.t || 0));
  } else if(obj.type === 'event'){
    // push event
    addHistory('EVENT: ' + obj.ev + (obj.order ? ' order ' + obj.order : ''));
    // optionally update orders/drivers locally
    applyEvent(obj);
  } else if(obj.type === 'history'){
    // chunk of history items
    for(const it of obj.items || []){ state.history.unshift(it); }
    renderHistory();
  } else if(obj.type === 'event' && obj.ev === 'BUTTON_PRESSED'){
    showCatEmoji();
    addHistory('Botón placa presionado -> gato!');
  } else {
    addHistory('Mensaje desconocido: ' + JSON.stringify(obj).slice(0,120));
  }
  refreshUI();
}

/* ---------- Apply state snapshot to UI state ---------- */
function applyStateSnapshot(s){
  // validate minimal fields
  state.grid = s.grid || state.grid;
  state.restaurants = s.restaurants || state.restaurants;
  state.houses = s.houses || state.houses;
  state.drivers = s.drivers || state.drivers;
  state.orders = s.orders || state.orders;
  state.metrics = s.metrics || state.metrics;
  // keep traces if exists
  if(s.metrics && s.metrics.last_event) addHistory('metric event: ' + s.metrics.last_event);
}

function showCatEmoji(){
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.right = '18px';
  el.style.top = '18px';
  el.style.fontSize = '48px';
  el.style.zIndex = 9999;
  el.textContent = '😺';
  document.body.appendChild(el);
  setTimeout(()=> {
    el.style.transition = 'opacity 600ms';
    el.style.opacity = '0';
    setTimeout(()=> el.remove(), 650);
  }, 1500);
}

/* ---------- Apply event ---------- */
function applyEvent(e) {
  if (e.ev === 'ORDER_READY') {
    // mark order as READY
    const o = state.orders.find(x => x.id === e.order);
    if (o) o.state = 'READY';
  } else if (e.ev === 'DRIVER_ASSIGNED') {
    const o = state.orders.find(x => x.id === e.order);
    if (o) o.assignedTo = e.driver;
    addHistory(`ORDER ${e.order} assigned to ${e.driver}`);
  } else if (e.ev === 'DELIVERED') {
    const o = state.orders.find(x => x.id === e.order);
    if (o) o.state = 'DELIVERED';
    addHistory(`ORDER ${e.order} delivered (lat ${e.latency_s || '?'}s)`);
    // push to traces
    state.traces = state.traces || [];
    state.traces.push({ ts: Date.now(), action: 'DELIVERED', order: e.order, latency_s: e.latency_s });
  }
}

/* ---------- Refresh UI elements and rendering ---------- */
function refreshUI() {
  populateRests();
  populateModalRests();
  refreshTables();
  renderHistory();
}

/* ---------- Mock generator & handlers ---------- */
let mockOrderId = 100;
function createDefaultMap() {
  // place 5 restaurants on edges and 10 houses on random cells
  state.restaurants = [
    { id: 'R1', pos: { av: 2, ca: 1 }, algo: 'SJF', queue: 0 },
    { id: 'R2', pos: { av: 7, ca: 1 }, algo: 'SJF', queue: 0 },
    { id: 'R3', pos: { av: 1, ca: 4 }, algo: 'SJF', queue: 0 },
    { id: 'R4', pos: { av: 6, ca: 6 }, algo: 'SJF', queue: 0 },
    { id: 'R5', pos: { av: 3, ca: 7 }, algo: 'SJF', queue: 0 }
  ];
  state.houses = [];
  for (let i = 0; i < 12; i++) {
    state.houses.push({
      id: 'H' + (i + 1),
      pos: { av: Math.floor(Math.random() * 8) + 1, ca: Math.floor(Math.random() * 8) + 1 }
    });
  }
  state.drivers = [
    { id: 'M1', pos: { av: 2, ca: 6 }, load: [], target: null, eta_s: 0 },
    { id: 'M2', pos: { av: 8, ca: 1 }, load: [], target: null, eta_s: 0 },
    { id: 'M3', pos: { av: 4, ca: 3 }, load: [], target: null, eta_s: 0 }
  ];
  state.orders = [];
}

function mockGenerateSnapshot() {
  // advance drivers slightly toward their target or idle
  for (const d of state.drivers) {
    if (d.target) {
      // simple movement: move one step toward target
      if (d.pos.av < d.target.av) d.pos.av++;
      else if (d.pos.av > d.target.av) d.pos.av--;
      else if (d.pos.ca < d.target.ca) d.pos.ca++;
      else if (d.pos.ca > d.target.ca) d.pos.ca--;
      // if reached
      if (d.pos.av === d.target.av && d.pos.ca === d.target.ca) {
        // either pick up or deliver: simulate event
        if (d.load && d.load.length) {
          const delivered = d.load.shift();
          // push event
          state.history.unshift({ ts: Date.now(), msg: `Mock delivered order ${delivered} by ${d.id}` });
        }
        d.target = null;
      }
    } else {
      // randomly set a target for some drivers
      if (Math.random() < 0.05) {
        const house = state.houses[Math.floor(Math.random() * state.houses.length)];
        d.target = { av: house.pos.av, ca: house.pos.ca };
      }
    }
  }

  // occasionally create new order (auto)
  if (Math.random() < 0.08) {
    const house = state.houses[Math.floor(Math.random() * state.houses.length)];
    const rest = state.restaurants[Math.floor(Math.random() * state.restaurants.length)];
    const id = mockOrderId++;
    const t_prep = 20 + Math.floor(Math.random() * 25);
    state.orders.push({ id, house: house.id, rest: rest.id, state: 'PREPARING', t_prep_s: t_prep, t_left_s: t_prep });
    rest.queue = (rest.queue || 0) + 1;
    state.traces.push({ ts: Date.now(), action: 'AUTO_CREATE', order: id });
    state.history.unshift({ ts: Date.now(), msg: `Auto order ${id} created at ${house.id} -> ${rest.id}` });
  }

  // decrement t_left_s for preparing orders
  for (const o of state.orders) {
    if (o.state === 'PREPARING') {
      o.t_left_s = Math.max(0, (o.t_left_s || o.t_prep_s) - 1 * simSpeed);
      if (o.t_left_s <= 0) {
        o.state = 'READY';
        state.history.unshift({ ts: Date.now(), msg: `Order ${o.id} READY` });
      }
    }
  }

  // assemble snapshot like placa
  const snap = {
    type: 'state',
    t: Date.now(),
    grid: { rows: 8, cols: 8 },
    restaurants: state.restaurants,
    houses: state.houses,
    drivers: state.drivers,
    orders: state.orders,
    metrics: {
      avg_wait_s: 0,
      avg_delivery_s: 0,
      kitchen_algo: document.getElementById('kitchenAlgo').value,
      driver_policy: 'RR+nearest'
    }
  };
  return snap;
}

function mockHandleIncomingCommand(cmd) {
  // handle CREATE_ORDER and others locally for mock
  if (cmd.type === 'cmd' && cmd.cmd === 'CREATE_ORDER') {
    const id = mockOrderId++;
    const coords = cmd.house;
    const house = { id: 'HM' + id, pos: { av: coords.av, ca: coords.ca } };
    state.houses.push(house);
    const rest = cmd.restaurant || state.restaurants[0].id;
    const t_prep = 20 + Math.floor(Math.random() * 25);
    state.orders.push({ id, house: house.id, rest, state: 'CREATED', t_prep_s: t_prep, t_left_s: t_prep });
    addHistory(`Mock created order ${id} at Av${coords.av}-C${coords.ca} rest ${rest}`);
    // immediately simulate moving to PREPARING
    setTimeout(() => {
      const o = state.orders.find(x => x.id === id);
      if (o) o.state = 'PREPARING';
    }, 500);
  } else if (cmd.type === 'cmd' && (cmd.cmd === 'PAUSE' || cmd.cmd === 'RESUME')) {
    addHistory(`Mock: ${cmd.cmd}`);
  } else if (cmd.type === 'cmd' && cmd.cmd === 'SET_KITCHEN_ALGO') {
    addHistory(`Mock set kitchen algo: ${cmd.algo}`);
  } else {
    addHistory(`Mock received cmd: ${JSON.stringify(cmd)}`);
  }
}


/* ---------- connectOrStart UI action ---------- */
async function connectOrStart(){
  const mode = document.getElementById('commMode').value;
  if(mode === 'webserial'){
    comm.stop();
    await comm.start('webserial');
  } else if(mode === 'websocket'){
    comm.stop();
    comm.start('websocket');
  } else {
    comm.stop();
    comm.start('mock');
  }
  document.getElementById('connectBtn').textContent = mode === 'mock' ? 'Mock ON' : 'Connected';
}

/* ---------- initialization ---------- */
function init(){
  createDefaultMap();
  populateRests();
  refreshTables();
  renderLoop();
  // wire some UI events
  document.getElementById('kitchenAlgo').onchange = (e)=> {
    comm.sendCommand({type:'cmd', cmd:'SET_KITCHEN_ALGO', algo: e.target.value});
  };
  document.getElementById('simSpeed').onchange = (e)=> { simSpeed = Number(e.target.value); addHistory('Velocidad set to ' + simSpeed + 'x'); };
  document.getElementById('clearHistory').onclick = ()=> { state.history = []; renderHistory(); };
  document.getElementById('filterState').onchange = refreshTables;
  document.getElementById('searchOrder').oninput = refreshTables;
}
init();

window.onload = () => {
  drawGrid();
  renderLoop();
};

// --- Inicialización del mapa ---
window.addEventListener("DOMContentLoaded", () => {
  // Datos de prueba (mock)
  state.restaurants = [
    { id: "R1", pos: { av: 2, ca: 3 } },
    { id: "R2", pos: { av: 6, ca: 5 } }
  ];

  state.houses = [
    { id: "H1", pos: { av: 1, ca: 7 } },
    { id: "H2", pos: { av: 8, ca: 2 } },
    { id: "H3", pos: { av: 4, ca: 4 } }
  ];

  state.drivers = [
    { id: "D1", pos: { av: 3, ca: 8 }, load: [], target: null, eta_s: 0 },
    { id: "D2", pos: { av: 7, ca: 1 }, load: [], target: null, eta_s: 0 }
  ];

  drawGrid();
  drawMarkers();
  renderLoop(); // ¡Arranca el bucle de dibujo!
});

/* ---------- Important: where JSON is read from placa ----------
   - If using WebSerial: readSerialLoop() reads raw bytes -> accumulates into this.buffer -> when it finds a newline '\\n' it slices a line and JSON.parse(line)
     Then handleIncomingJson(obj) is called.
   - If using WebSocket: onmessage -> JSON.parse(ev.data) -> handleIncomingJson(obj)
   - The central handler is handleIncomingJson(obj) which expects the "state" contract explained en las instrucciones.
   - Make sure the STM32 envíe cada JSON completo terminado con '\\n' y que no incluya caracteres extra que rompan el parseo.
*/
