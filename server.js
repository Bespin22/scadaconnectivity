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

/* ================= STATIC FRONTEND ================= */
const frontendPath = path.join(__dirname, "dist", "scadaconnectivity");
app.use(express.static(frontendPath));

/* ================= FILE UPLOAD ================= */
const upload = multer({ dest: "uploads/" });

/* ================= DATA ================= */
let ipData = [];
let deletedIPs = [];

/* ================= LOAD & SAVE ================= */
function loadIPData() {
  if (fs.existsSync(DATA_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    ipData = raw.ipList || [];
    deletedIPs = raw.deletedIPs || [];
  }
}

function saveIPData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ ipList: ipData, deletedIPs }, null, 2)
  );
}

loadIPData();

/* ================= ROUTES ================= */

/* ---- Ping Status ---- */
app.get("/ping", async (req, res) => {
  try {
    const results = await Promise.all(
      ipData.map(async (entry) => {
        try {
          const r = await ping.promise.probe(entry.ip, { timeout: 2 });
          return { ...entry, status: r.alive ? "Connected" : "Disconnected" };
        } catch {
          return { ...entry, status: "Disconnected" };
        }
      })
    );
    res.json(results);
  } catch {
    res.status(500).json({ error: "Ping failed" });
  }
});

/* ---- Add IP ---- */
app.post("/add-ip", (req, res) => {
  const { name, ip, turbineType, turbineLocation } = req.body;

  if (!name || !ip || !turbineType || !turbineLocation) {
    return res.status(400).json({ message: "All fields required" });
  }

  if (ipData.some(e => e.ip === ip)) {
    return res.status(400).json({ message: "IP already exists" });
  }

  ipData.push({ name, ip, turbineType, turbineLocation });
  saveIPData();
  res.status(201).json({ message: "IP added" });
});

/* ---- Edit IP ---- */
app.put("/edit-ip", (req, res) => {
  const { oldIp, name, ip, turbineType, turbineLocation } = req.body;

  const index = ipData.findIndex(e => e.ip === oldIp);
  if (index === -1) {
    return res.status(404).json({ message: "IP not found" });
  }

  ipData[index] = { name, ip, turbineType, turbineLocation };
  saveIPData();
  res.json({ message: "IP updated" });
});

/* ---- Delete IP (Soft) ---- */
app.delete("/delete-ip/:ip", (req, res) => {
  const index = ipData.findIndex(e => e.ip === req.params.ip);
  if (index === -1) {
    return res.status(404).json({ message: "IP not found" });
  }

  deletedIPs.push(ipData[index]);
  ipData.splice(index, 1);
  saveIPData();
  res.json({ message: "IP deleted" });
});

/* ---- Deleted IPs ---- */
app.get("/deleted-ips", (req, res) => {
  res.json(deletedIPs);
});

/* ---- Restore IP ---- */
app.post("/restore-ip/:ip", (req, res) => {
  const index = deletedIPs.findIndex(e => e.ip === req.params.ip);
  if (index === -1) {
    return res.status(404).json({ message: "Deleted IP not found" });
  }

  ipData.push(deletedIPs[index]);
  deletedIPs.splice(index, 1);
  saveIPData();
  res.json({ message: "IP restored" });
});

/* ---- Permanent Delete ---- */
app.delete("/permanently-delete-ip/:ip", (req, res) => {
  const index = deletedIPs.findIndex(e => e.ip === req.params.ip);
  if (index === -1) {
    return res.status(404).json({ message: "IP not found" });
  }

  deletedIPs.splice(index, 1);
  saveIPData();
  res.json({ message: "IP permanently deleted" });
});

/* ---- BULK UPLOAD (FIXED) ---- */
app.post("/bulk-add", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    let added = 0;
    let duplicates = 0;
    let skipped = 0;

    rows.forEach(row => {
      // 🔥 Normalize keys (trim spaces)
      const normalizedRow = {};
      Object.keys(row).forEach(k => {
        normalizedRow[k.trim()] = row[k];
      });

      const name = normalizedRow["Name"];
      const ip = normalizedRow["IP"];
      const turbineType = normalizedRow["Turbine Type"];
      const turbineLocation = normalizedRow["Turbine Location"];

      if (!name || !ip || !turbineType || !turbineLocation) {
        skipped++;
        return;
      }

      if (ipData.some(e => e.ip === ip)) {
        duplicates++;
        return;
      }

      ipData.push({
        name: String(name).trim(),
        ip: String(ip).trim(),
        turbineType: String(turbineType).trim(),
        turbineLocation: String(turbineLocation).trim()
      });

      added++;
    });

    saveIPData();
    fs.unlinkSync(req.file.path);

    res.json({
      message: "Bulk upload completed",
      added,
      duplicates,
      skipped
    });
  } catch (err) {
    console.error("Bulk upload error:", err);
    res.status(500).json({ error: "Bulk upload failed" });
  }
});


/* ---- Export XLSX ---- */
app.get("/export-turbines", (req, res) => {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(ipData);
  xlsx.utils.book_append_sheet(wb, ws, "IP_List");

  const fileName = `IP_List_${Date.now()}.xlsx`;
  xlsx.writeFile(wb, fileName);

  res.download(fileName, () => fs.unlinkSync(fileName));
});

/* ================= SPA FALLBACK ================= */
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
