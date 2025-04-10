const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const ping = require("ping");
const multer = require("multer");
const xlsx = require("xlsx");
const path = require("path");

const fs = require("fs");
const app = express();
const PORT = 3000;
const DATA_FILE = "ipList.json";


// Middleware
app.use(cors());
app.use(bodyParser.json());

// File upload setup
const upload = multer({ dest: "uploads/" });

// Load IP data from JSON file or initialize
let ipData = [];
let deletedIPs = [];

function loadIPData() {
  if (fs.existsSync(DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    ipData = data.ipList || [];
    deletedIPs = data.deletedIPs || [];

  }
}

function saveIPData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ ipList: ipData, deletedIPs }, null, 2));

}

// Load data on server startup
loadIPData();

// Routes

// Fetch all IPs and their statuses
app.get("/ping", async (req, res) => {
  const pingPromises = ipData.map(async (entry) => {
    const pingResult = await ping.promise.probe(entry.ip, { timeout: 2 });
    return { ...entry, status: pingResult.alive ? "Connected" : "Disconnected" };
  });

  const results = await Promise.all(pingPromises);
  res.json(results);
});

//filter starts 

// Fetch data from iplist.json and populate the dropdown with turbine locations
async function fetchDataAndInitialize() {
  try {
    // Fetch the JSON file
    const response = await fetch("iplist.json");
    const data = await response.json();

    // Extract unique turbine locations
    const locations = [...new Set(data.map((item) => item.turbineLocation))];
    const dropdown = document.getElementById("location-filter");

    // Clear existing options in the dropdown
    dropdown.innerHTML = '<option value="all">All Turbine Locations</option>';

    // Populate the dropdown with unique locations
    locations.forEach((location) => {
      const option = document.createElement("option");
      option.value = location;
      option.textContent = location;
      dropdown.appendChild(option);
    });
  } catch (error) {
    console.error("Error fetching or processing JSON:", error);
  }
}


//filter ends



// Export all turbine data to XLSX and download
app.get("/export-turbines", (req, res) => {
  try {
    const includeDeleted = req.query.includeDeleted === "true"; // Check if deleted IPs should be included
    const filter = req.query.filter || null; // Optional filter parameter

     // Prepare data for export
     let exportData = [...ipData];
     if (includeDeleted) {
       exportData = [...exportData, ...deletedIPs];
     }
 
     if (filter) {
       exportData = exportData.filter((entry) =>
         entry.name.toLowerCase().includes(filter.toLowerCase())
       );
     }




 // Ensure there's data to export
 if (exportData.length === 0) {
  return res.status(404).json({ message: "No data available for export." });
}


 // Create a new Excel workbook and worksheet
 const workbook = xlsx.utils.book_new();
 const worksheet = xlsx.utils.json_to_sheet(exportData);
 xlsx.utils.book_append_sheet(workbook, worksheet, "IP List");

   // Generate file name
   const timestamp = new Date().toISOString().replace(/[:.-]/g, "_");
   const fileName = `IP_List_${timestamp}.xlsx`;
   const filePath = path.join(__dirname, fileName);


    // Write the workbook to the server and send it for download
    xlsx.writeFile(workbook, filePath);
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).send("Failed to download the file.");
      }

      // Clean up: delete the file after sending it
      fs.unlinkSync(filePath);
    });
  } catch (error) {
    console.error("Error exporting IPs:", error);
    res.status(500).send("Failed to export IPs.");
  }
});



// Add a new IP entry
app.post("/add-ip", (req, res) => {
  const { name, ip, turbineType, turbineLocation } = req.body;

  if (!name || !ip || !turbineType || !turbineLocation) {
    return res.status(400).json({ message: "All fields are required." });
  }

  if (ipData.some((entry) => entry.ip === ip)) {
    return res.status(400).json({ message: "IP address already exists." });
  }

  ipData.push({ name, ip, turbineType, turbineLocation, status: "Disconnected" });
  saveIPData();
  res.status(201).json({ message: "IP added successfully." });
});

// Edit an IP entry
app.put("/edit-ip", (req, res) => {
  const { oldIp, name, ip, turbineType, turbineLocation } = req.body;

  if (!oldIp || !name || !ip || !turbineType || !turbineLocation) {
    return res.status(400).json({ message: "All fields are required." });
  }

  const ipIndex = ipData.findIndex((entry) => entry.ip === oldIp);
  if (ipIndex === -1) {
    return res.status(404).json({ message: "IP not found." });
  }

  ipData[ipIndex] = { name, ip, turbineType, turbineLocation, status: "Disconnected" };
  saveIPData();
  res.json({ message: "IP updated successfully." });
});


// Delete an IP entry
app.delete("/delete-ip/:ip", (req, res) => {
  const { ip } = req.params;

  const ipIndex = ipData.findIndex((entry) => entry.ip === ip);
  if (ipIndex === -1) {
    return res.status(404).json({ message: "IP not found." });
  }

  const [deletedIP] = ipData.splice(ipIndex, 1);
  deletedIPs.push(deletedIP);
  saveIPData();
  res.json({ message: "IP deleted successfully." });
});

// Fetch deleted IPs
app.get("/deleted-ips", (req, res) => {
  res.json(deletedIPs);
});

// Restore a deleted IP
app.post("/restore-ip/:ip", (req, res) => {
  const { ip } = req.params;

  const ipIndex = deletedIPs.findIndex((entry) => entry.ip === ip);
  if (ipIndex === -1) {
    return res.status(404).json({ message: "Deleted IP not found." });
  }


  const [restoredIP] = deletedIPs.splice(ipIndex, 1);
  ipData.push(restoredIP);
  saveIPData();
  res.json({ message: "IP restored successfully." });

});

// Permanently delete an IP from the deleted list
app.delete("/permanently-delete-ip/:ip", (req, res) => {
  const { ip } = req.params;
  const ipIndex = deletedIPs.findIndex((entry) => entry.ip === ip);
  if (ipIndex === -1) {
    return res.status(404).json({ message: "Deleted IP not found." });
  }

  deletedIPs.splice(ipIndex, 1);
  saveIPData();
  res.json({ message: "IP permanently deleted." });
});

// Bulk upload IPs from an XLSX file
app.post("/bulk-add", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  try {
    const filePath = path.resolve(req.file.path);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const newEntries = [];
    const duplicates = [];
    const errors = [];

    sheetData.forEach((row) => {
      const { Name, IP, TurbineType, TurbineLocation } = row;

      if (!Name || !IP || !TurbineType || !TurbineLocation) {
        errors.push(row);
        return;
      }

      if (ipData.find((entry) => entry.ip === IP)) {
        duplicates.push(row);
        return;
      }

      newEntries.push({
        name: Name,
        ip: IP,
        turbineType: TurbineType,
        turbineLocation: TurbineLocation,
        status: "Disconnected",
      });
    });

    ipData = [...ipData, ...newEntries];
    saveIPData();
    fs.unlinkSync(filePath);

    res.json({
      message: "Bulk upload completed.",
      added: newEntries.length,
      duplicates: duplicates.length,
      errors: errors.length,
      details: { newEntries, duplicates, errors },
    });
  } catch (error) {
    console.error("Error processing bulk upload:", error);
    res.status(500).json({ error: "Failed to process bulk upload." });
  }
});



// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});



app.use(express.static(path.join(__dirname, 'dist/scadaconnectivity')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/scadaconnectivity/index.html'));
});
