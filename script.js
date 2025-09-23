// script.js - shared logic for pages
const STORAGE_KEY = "tamper_history_v1";

/* ---------- Data model & storage ---------- */
function loadHistory(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  }catch(e){
    console.error("loadHistory error", e);
    return [];
  }
}
function saveHistory(arr){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}
function addEvent(event){
  const h = loadHistory();
  h.unshift(event); // newest first
  if(h.length>200) h.length = 200;
  saveHistory(h);
}
function deleteEvent(id){
  const h = loadHistory().filter(x=>x.id !== id);
  saveHistory(h);
}
function updateEvent(updated){
  const h = loadHistory().map(x=> x.id===updated.id ? updated : x);
  saveHistory(h);
}

/* ---------- util ---------- */
function uid(prefix="id"){
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
function nowISO(){ return new Date().toISOString(); }
function displayTs(iso){
  const d = new Date(iso);
  return d.toLocaleString();
}

/* ---------- simulation ---------- */
let simInterval = null;
function simulateOnce(){
  const states = [
    {k:"OK", cls:"status-ok"},
    {k:"WARNING", cls:"status-warn"},
    {k:"TAMPER DETECTED", cls:"status-alert"}
  ];
  // bias toward OK
  const r = Math.random();
  let st;
  if(r<0.65) st = states[0];
  else if(r<0.9) st = states[1];
  else st = states[2];

  const ev = {
    id: uid("ev"),
    ts: nowISO(),
    status: st.k,
    value: (Math.random()*200).toFixed(1),
    note: st.k==="TAMPER DETECTED" ? "Tamper pattern detected" : "",
    resolved: false
  };
  addEvent(ev);
  // notify page (if home shows last)
  document.dispatchEvent(new CustomEvent("historyChanged"));
  return ev;
}

function startSimulation(intervalMs=4000){
  if(simInterval) return;
  simulateOnce();
  simInterval = setInterval(simulateOnce, intervalMs);
  document.dispatchEvent(new CustomEvent("simulationChanged",{detail:{running:true}}));
}
function stopSimulation(){
  if(!simInterval) return;
  clearInterval(simInterval);
  simInterval = null;
  document.dispatchEvent(new CustomEvent("simulationChanged",{detail:{running:false}}));
}

/* ---------- history rendering helpers ---------- */
function renderHistoryTable(tbodyEl, opts={}){
  const all = loadHistory();
  let items = all.slice();

  // filtering
  if(opts.q){
    const q = opts.q.toLowerCase();
    items = items.filter(it => (it.status+it.value+it.note+displayTs(it.ts)).toLowerCase().includes(q));
  }
  if(opts.filterStatus){
    items = items.filter(it => it.status === opts.filterStatus);
  }
  // limit
  const limit = opts.limit || items.length;
  items = items.slice(0, limit);

  // render
  tbodyEl.innerHTML = "";
  if(items.length === 0){
    tbodyEl.innerHTML = <tr><td colspan="5" class="center small">No records</td></tr>;
    return;
  }
  items.forEach(it=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${displayTs(it.ts)}</td>
      <td><strong>${it.status}</strong></td>
      <td>${it.value}</td>
      <td>${it.note || "-"}</td>
      <td>
        ${it.resolved ? <span class="badge">Resolved</span> :
          <button class="ghost" data-action="resolve" data-id="${it.id}">Mark Resolved</button>}
        <button class="ghost" data-action="delete" data-id="${it.id}">Delete</button>
      </td>
    `;
    tbodyEl.appendChild(tr);
  });
}

/* ---------- CSV export ---------- */
function exportCSV(){
  const arr = loadHistory();
  if(arr.length===0){ alert("No records to export"); return; }
  const rows = [["timestamp","status","value","note","resolved"]];
  arr.forEach(it => rows.push([it.ts, it.status, it.value, (it.note||""), it.resolved?"1":"0"]));
  const csv = rows.map(r => r.map(cell => "${String(cell).replace(/"/g,'""')}").join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tamper_history.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Chart rendering (Chart.js) ---------- */
let tamperChart = null;
function renderChart(canvasEl){
  const all = loadHistory();
  // count events per day (last 10 entries)
  const slice = all.slice(0,30).reverse();
  const labels = slice.map(it => new Date(it.ts).toLocaleTimeString());
  const values = slice.map(it => it.status==="TAMPER DETECTED" ? 2 : (it.status==="WARNING"?1:0));
  if(!canvasEl) return;
  if(window.Chart){
    if(tamperChart) tamperChart.destroy();
    tamperChart = new Chart(canvasEl, {
      type:"bar",
      data:{
        labels,
        datasets:[{
          label:"Event severity (0=OK,1=Warn,2=Tamper)",
          data:values,
          borderRadius:6,
          barPercentage:0.6
        }]
      },
      options:{
        responsive:true,
        scales:{y:{beginAtZero:true, ticks:{precision:0}}}
      }
    });
  }
}

/* ---------- event delegation for table actions ---------- */
function attachTableActions(tbodyEl){
  tbodyEl.addEventListener("click", e=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const action = btn.getAttribute("data-action");
    const id = btn.getAttribute("data-id");
    if(action === "delete"){
      if(confirm("Delete this record?")){
        deleteEvent(id);
        renderHistoryTable(tbodyEl);
        document.dispatchEvent(new CustomEvent("historyChanged"));
      }
    } else if(action === "resolve"){
      const hist = loadHistory();
      const one = hist.find(x=>x.id===id);
      if(one){
        one.resolved = true;
        updateEvent(one);
        renderHistoryTable(tbodyEl);
        document.dispatchEvent(new CustomEvent("historyChanged"));
      }
    }
  });
}

/* ---------- form helpers ---------- */
function setupManualAdd(formEl, onAdded){
  formEl.addEventListener("submit", e=>{
    e.preventDefault();
    const f = new FormData(formEl);
    const status = f.get("status");
    const value = f.get("value") || (Math.random()*100).toFixed(1);
    const note = f.get("note") || "";
    const ev = { id: uid("ev"), ts: nowISO(), status, value, note, resolved:false };
    addEvent(ev);
    formEl.reset();
    if(typeof onAdded === "function") onAdded(ev);
    document.dispatchEvent(new CustomEvent("historyChanged"));
  });
}

/* Exported functions for pages */
window.app = {
  startSimulation, stopSimulation, simulateOnce,
  loadHistory, addEvent, deleteEvent, exportCSV,
  renderHistoryTable, attachTableActions, renderChart, setupManualAdd
};