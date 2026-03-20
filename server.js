const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const ping = require("ping");
const multer = require("multer");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "ipList.json");

/* ================= MIDDLEWARE ================= */
app.use(cors());
app.use(bodyParser.json());

/* ================= STATIC ================= */
const frontendPath = path.join(__dirname, "dist", "scadaconnectivity");
app.use(express.static(frontendPath));

/* ================= UPLOAD ================= */
const upload = multer({ dest: "uploads/" });

/* ================= DATA ================= */
let ipData = [];
let deletedIPs = [];

/* ================= LOAD ================= */
function loadIPData() { 
  
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    ipData = raw.ipList || [];
    deletedIPs = raw.deletedIPs || [];
  }
 renderSummary(ipData);
}

/* ================= SAVE ================= */
function saveIPData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ ipList: ipData, deletedIPs }, null, 2)
  );
}

loadIPData();

/* ================= HELPERS ================= */

/* Validate IP */
function isValidIP(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
}

/* Generate PLC IP */
function generatePlcIp(ip) {
  try {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;

    const last = parseInt(parts[3]);
    if (isNaN(last) || last <= 0) return null;

    parts[3] = last - 1;
    return parts.join(".");
  } catch {
    return null;
  }
}

/* ================= ROUTES ================= */

/* ---------- PING ---------- */
app.get("/ping", async (req, res) => {
  try {
    const results = await Promise.all(
      ipData.map(async (t) => {
        let ipAlive = false;
        let plcAlive = false;

        try {
          if (t.ip) {
            const ipPing = await ping.promise.probe(t.ip, { timeout: 2 });
            ipAlive = ipPing.alive;
          }
        } catch {}

        try {
          if (t.plcIp) {
            const plcPing = await ping.promise.probe(t.plcIp, { timeout: 2 });
            plcAlive = plcPing.alive;
          }
        } catch {}

        return {
          ...t,
          ipStatus: ipAlive ? "Connected" : "Disconnected",
          plcStatus: t.plcIp
            ? plcAlive ? "Connected" : "Disconnected"
            : "Missing"
        };
      })
    );

    res.json(results);
  } catch (err) {
    console.error("Ping error:", err);
    res.status(500).json({ error: "Ping failed" });
  }
});

/* ---------- ADD ---------- */
app.post("/add-ip", (req, res) => {
  let { name, ip, plcIp, turbineType, turbineLocation } = req.body;

  if (!name || !ip || !turbineType || !turbineLocation) {
    return res.status(400).json({ message: "Required fields missing" });
  }

  if (!isValidIP(ip)) {
    return res.status(400).json({ message: "Invalid SCADA IP" });
  }

  if (!plcIp) {
    plcIp = generatePlcIp(ip);
  }

  if (plcIp && !isValidIP(plcIp)) {
    return res.status(400).json({ message: "Invalid PLC IP" });
  }

  if (ipData.some(e => e.ip === ip || e.plcIp === plcIp)) {
    return res.status(400).json({ message: "Duplicate IP/PLC exists" });
  }

  ipData.push({
    name,
    ip,
    plcIp,
    turbineType,
    turbineLocation
  });

  saveIPData();
  res.status(201).json({ message: "Turbine added" });
});

/* ---------- EDIT ---------- */
app.put("/edit-ip", (req, res) => {
  const { oldIp, name, ip, plcIp, turbineType, turbineLocation } = req.body;

  const index = ipData.findIndex(e => e.ip === oldIp);
  if (index === -1) {
    return res.status(404).json({ message: "IP not found" });
  }

  // Prevent duplicate when editing
  const duplicate = ipData.some(
    (e, i) =>
      i !== index &&
      (e.ip === ip || (plcIp && e.plcIp === plcIp))
  );

  if (duplicate) {
    return res.status(400).json({ message: "Duplicate IP/PLC exists" });
  }

  ipData[index] = {
    ...ipData[index],
    name,
    ip,
    plcIp: plcIp || ipData[index].plcIp,
    turbineType,
    turbineLocation
  };

  saveIPData();
  res.json({ message: "Updated" });
});

/* ---------- DELETE ---------- */
app.delete("/delete-ip/:ip", (req, res) => {
  const index = ipData.findIndex(e => e.ip === req.params.ip);

  if (index === -1) {
    return res.status(404).json({ message: "IP not found" });
  }

  deletedIPs.push(ipData[index]);
  ipData.splice(index, 1);

  saveIPData();
  res.json({ message: "Deleted" });
});

/* ---------- DELETED ---------- */
app.get("/deleted-ips", (req, res) => {
  res.json(deletedIPs);
});

/* ---------- RESTORE ---------- */
app.post("/restore-ip/:ip", (req, res) => {
  const index = deletedIPs.findIndex(e => e.ip === req.params.ip);

  if (index === -1) {
    return res.status(404).json({ message: "Not found" });
  }

  ipData.push(deletedIPs[index]);
  deletedIPs.splice(index, 1);

  saveIPData();
  res.json({ message: "Restored" });
});

/* ---------- PERMANENT DELETE ---------- */
app.delete("/permanently-delete-ip/:ip", (req, res) => {
  const index = deletedIPs.findIndex(e => e.ip === req.params.ip);

  if (index === -1) {
    return res.status(404).json({ message: "Not found" });
  }

  deletedIPs.splice(index, 1);
  saveIPData();

  res.json({ message: "Removed permanently" });
});

/* ---------- BULK UPLOAD ---------- */
app.post("/bulk-add", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    let added = 0, duplicates = 0, skipped = 0;

    rows.forEach(row => {
      const r = {};
      Object.keys(row).forEach(k => r[k.trim()] = row[k]);

      const name = r["Name"];
      const ip = r["IP"];
      let plcIp = r["PLC IP"];
      const turbineType = r["Turbine Type"];
      const turbineLocation = r[" "];

      if (!name || !ip || !turbineType || !turbineLocation) {
        skipped++;
        return;
      }

      if (!plcIp) {
        plcIp = generatePlcIp(ip);
      }

      if (ipData.some(e => e.ip === ip || e.plcIp === plcIp)) {
        duplicates++;
        return;
      }

      ipData.push({
        name: String(name).trim(),
        ip: String(ip).trim(),
        plcIp: plcIp ? String(plcIp).trim() : null,
        turbineType: String(turbineType).trim(),
        turbineLocation: String(turbineLocation).trim()
      });

      added++;
    });

    saveIPData();
    fs.unlinkSync(req.file.path);

    res.json({ added, duplicates, skipped });

  } catch (err) {
    fs.unlinkSync(req.file.path); // 🔥 important fix
    console.error("Bulk upload error:", err);
    res.status(500).json({ error: "Bulk upload failed" });
  }
});

/* ---------- EXPORT ---------- */
app.get("/export-turbines", (req, res) => {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(ipData);
  xlsx.utils.book_append_sheet(wb, ws, "IP_List");

  const fileName = `IP_List_${Date.now()}.xlsx`;
  xlsx.writeFile(wb, fileName);

  res.download(fileName, () => fs.unlinkSync(fileName));
});

/* ---------- SPA ---------- */
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
});