const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const ping = require("ping");
const fs = require("fs");

const app = express();
const PORT = 3000;
const DATA_FILE = "ipList.json";

app.use(bodyParser.json());
app.use(cors());

// Load IP list from file or initialize
let ipList = [];
let deletedIps = [];

// Load IP list from the file
function loadIPList() {
  if (fs.existsSync(DATA_FILE)) {
    const data = fs.readFileSync(DATA_FILE, "utf-8");
    const parsedData = JSON.parse(data);
    ipList = parsedData.ipList || [];
    deletedIps = parsedData.deletedIps || [];
  }
}

// Save IP list to the file
function saveIPList() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ ipList, deletedIps }, null, 2));
}

// Load data on startup
loadIPList();

// Endpoint to fetch all IPs and their statuses
app.get("/ping", async (req, res) => {
  const pingResults = await Promise.all(
    ipList.map((entry) =>
      ping.promise.probe(entry.ip).then((result) => ({
        name: entry.name,
        ip: entry.ip,
        site: entry.site,
        status: result.alive ? "Connected" : "Disconnected",
      }))
    )
  );

  ipList = pingResults;
  saveIPList();
  res.json(ipList);
});

// Add a new IP to the list
app.post("/add-ip", (req, res) => {
  const { name, ip, site } = req.body;

  if (name && ip && site) {
    ipList.push({ name, ip, site, status: "Pending" });
    saveIPList();
    res.status(201).json({ message: "IP added successfully." });
  } else {
    res.status(400).json({ message: "Name, IP, and Site are required." });
  }
});

// Edit an IP entry
app.put("/edit-ip", (req, res) => {
  const { ip, name, site } = req.body;

  if (!ip || !name || !site) {
    return res.status(400).json({ message: "IP, name, and site are required." });
  }

  const index = ipList.findIndex((entry) => entry.ip === ip);
  if (index !== -1) {
    ipList[index].name = name;
    ipList[index].site = site;
    saveIPList();
    res.json({ message: "IP entry updated successfully." });
  } else {
    res.status(404).json({ message: "IP not found." });
  }
});

// Delete an IP from the list
app.delete("/delete-ip/:ip", (req, res) => {
  const { ip } = req.params;
  const index = ipList.findIndex((entry) => entry.ip === ip);

  if (index !== -1) {
    deletedIps.push(ipList[index]);
    ipList.splice(index, 1);
    saveIPList();
    res.json({ message: "IP deleted successfully." });
  } else {
    res.status(404).json({ message: "IP not found." });
  }
});

// Restore a deleted IP
app.post("/restore-ip/:ip", (req, res) => {
  const { ip } = req.params;
  const index = deletedIps.findIndex((entry) => entry.ip === ip);

  if (index !== -1) {
    ipList.push(deletedIps[index]);
    deletedIps.splice(index, 1);
    saveIPList();
    res.json({ message: "IP restored successfully." });
  } else {
    res.status(404).json({ message: "IP not found in deleted list." });
  }
});

// Fetch deleted IPs
app.get("/deleted-ips", (req, res) => {
  res.json(deletedIps);
});

// Periodically update ping status
function updatePingStatus() {
  setInterval(async () => {
    const pingResults = await Promise.all(
      ipList.map((entry) =>
        ping.promise.probe(entry.ip).then((result) => ({
          ...entry,
          status: result.alive ? "Connected" : "Disconnected",
        }))
      )
    );

    ipList = pingResults;
    saveIPList();
    console.log("Updated ping status:", ipList);
  }, 5000);
}

// Start the periodic ping status update
updatePingStatus();

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
