// State management
let allData = [];
let uniqueEngines = []; // List of: { key, source, engineName, hp, config, records }
let activeEngineIds = []; // Array of selected engine keys
let activePowers = [];    // Array of selected power levels (numbers)
let activeConfigs = [];   // Array of selected configurations (strings)
let activeHulls = [];     // Array of selected hull types (strings)
let selectedMetric = "gph"; // 'gph', 'mpg', 'mph'
let selectedColorMode = "unique"; // 'unique', 'boat_manufacturer', 'hull_length_exact', 'boat_weight_exact', 'hull_length_range', 'engine_key', 'engine_brand'
let perEngine = false; // divide fuel/economy by engine count
let activeSpeedUnit = "mph"; // 'mph', 'knts', 'ms'
let activeLengthUnit = "ft"; // 'ft', 'm'
let activeVolumeUnit = "gal"; // 'gal', 'l'
// Boat length range slider state (in feet; null = no restriction)
let lengthSliderAbsMin = 0;  // global dataset min (ft)
let lengthSliderAbsMax = 100; // global dataset max (ft)
let activeLengthMin = null;  // current filter min (ft)
let activeLengthMax = null;  // current filter max (ft)
let chartInstance = null;

// DOM Elements
const loadingOverlay = document.getElementById("loadingOverlay");
const engineSearch = document.getElementById("engineSearch");
const engineSelect = document.getElementById("engineSelect");
const selectedEnginesList = document.getElementById("selectedEnginesList");
const powerSelect = document.getElementById("powerSelect");
const selectedPowersList = document.getElementById("selectedPowersList");
const configSelect = document.getElementById("configSelect");
const selectedConfigsList = document.getElementById("selectedConfigsList");
const hullSelect = document.getElementById("hullSelect");
const selectedHullsList = document.getElementById("selectedHullsList");
const clearEnginesBtn = document.getElementById("clearEnginesBtn");
const clearPowersBtn = document.getElementById("clearPowersBtn");
const clearConfigsBtn = document.getElementById("clearConfigsBtn");
const clearHullsBtn = document.getElementById("clearHullsBtn");
const exportPdfBtn = document.getElementById("exportPdfBtn");
const exportHtmlBtn = document.getElementById("exportHtmlBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const chartTitle = document.getElementById("chartTitle");
const summaryEngine = document.getElementById("summaryEngine");
const summaryBoatCount = document.getElementById("summaryBoatCount");
const summaryPlottedCount = document.getElementById("summaryPlottedCount");
const colorModeSelect = document.getElementById("colorModeSelect");
const colorModeCard = document.getElementById("colorModeCard");

// Hull type friendly names mapping
const hullTypeNames = {
  'ALM': 'Aluminum',
  'BAY': 'Bay Boat',
  'BSS': 'Bass Boat',
  'CAT': 'Catamaran',
  'DCK': 'Deck Boat',
  'FLT': 'Flat Boat',
  'INF': 'Inflatable',
  'OCC': 'Offshore Center Console',
  'ODC': 'Offshore Dual Console',
  'OWA': 'Offshore Walk Around',
  'PNT': 'Pontoon',
  'RBT': 'Runabout',
  'SKF': 'Skiff',
  'WLY': 'Walleye Boat',
  'Unknown': 'Unknown / Other'
};

// Parse weight strings, prioritize weight_as_tested, fall back to dry_weight
function formatWeight(boatSpecs) {
  if (!boatSpecs) return "-";
  
  const cleanNum = (str) => {
    if (!str) return "";
    return str.replace(/\s*(lbs|lb|kg|g).*$/i, '').trim();
  };
  
  const tested = cleanNum(boatSpecs.weight_as_tested);
  if (tested) {
    return `${tested} (As Tested)`;
  }
  
  const dry = cleanNum(boatSpecs.dry_weight);
  if (dry) {
    return `${dry} (Dry)`;
  }
  
  return "-";
}

// Unit System utility functions
function getSpeedUnitLabel() {
  if (activeSpeedUnit === "knts") return "knts";
  if (activeSpeedUnit === "ms") return "kph";
  return "MPH";
}

function getVolumeUnitLabel() {
  if (activeVolumeUnit === "l") return "L";
  return "gal";
}

function getEconomyUnitLabel() {
  if (activeSpeedUnit === "mph" && activeVolumeUnit === "gal") return "gal/mi";
  if (activeSpeedUnit === "mph" && activeVolumeUnit === "l") return "L/mi";
  if (activeSpeedUnit === "knts" && activeVolumeUnit === "gal") return "gal/NM";
  if (activeSpeedUnit === "knts" && activeVolumeUnit === "l") return "L/NM";
  if (activeSpeedUnit === "ms" && activeVolumeUnit === "gal") return "gal/km";
  if (activeSpeedUnit === "ms" && activeVolumeUnit === "l") return "L/km";
  return "gal/mi";
}

function convertSpeed(mph) {
  if (mph === null || mph === undefined || isNaN(mph)) return null;
  if (activeSpeedUnit === "knts") {
    return mph / 1.15078;
  } else if (activeSpeedUnit === "ms") {
    return mph * 1.60934;
  }
  return mph;
}

function convertFuel(gph) {
  if (gph === null || gph === undefined || isNaN(gph)) return null;
  if (activeVolumeUnit === "l") {
    return gph * 3.78541;
  }
  return gph;
}

function convertEconomy(mph, gph) {
  if (mph === null || mph === undefined || isNaN(mph)) return null;
  if (gph === null || gph === undefined || isNaN(gph) || mph === 0) return null;
  
  let volPerHour = gph;
  if (activeVolumeUnit === "l") {
    volPerHour = gph * 3.78541;
  }
  
  let distPerHour = mph;
  if (activeSpeedUnit === "knts") {
    distPerHour = mph / 1.15078;
  } else if (activeSpeedUnit === "ms") {
    distPerHour = mph * 1.609344; // mph to km/h
  }
  
  return volPerHour / distPerHour;
}

function convertLengthStr(lengthStr) {
  if (!lengthStr) return "-";
  const feet = parseLengthToFeet(lengthStr);
  if (feet === null) return lengthStr;
  if (activeLengthUnit === "m") {
    return `${(feet * 0.3048).toFixed(2)} m`;
  }
  return lengthStr;
}

function formatWindSpeed(windStr) {
  if (!windStr) return "-";
  const matches = windStr.match(/\d+(\.\d+)?/g);
  if (!matches) return windStr;
  
  if (activeSpeedUnit === "mph") {
    if (/mph/i.test(windStr)) return windStr;
    return `${windStr} MPH`;
  }
  
  let convertedStr = windStr.replace(/\d+(\.\d+)?/g, (match) => {
    const val = parseFloat(match);
    if (activeSpeedUnit === "knts") {
      return (val / 1.15078).toFixed(1);
    } else {
      return (val * 1.60934).toFixed(1);
    }
  });
  
  convertedStr = convertedStr.replace(/\s*mph/i, "");
  return `${convertedStr} ${getSpeedUnitLabel()}`;
}

function formatElevation(elevStr) {
  if (!elevStr) return "-";
  const matches = elevStr.match(/\d+(\.\d+)?/g);
  if (!matches) return elevStr;
  
  if (activeLengthUnit === "ft") {
    if (/ft|feet/i.test(elevStr)) return elevStr;
    return `${elevStr} ft`;
  }
  
  let convertedStr = elevStr.replace(/\d+(\.\d+)?/g, (match) => {
    const val = parseFloat(match);
    return (val * 0.3048).toFixed(0);
  });
  
  convertedStr = convertedStr.replace(/\s*(ft|feet)/i, "");
  return `${convertedStr} m`;
}

// Formats test conditions into a readable summary string
function formatTestConditions(testConds) {
  if (!testConds) return "-";
  
  const parts = [];
  if (testConds.number_of_people) {
    parts.push(`${testConds.number_of_people} People`);
  }
  if (testConds.fuel_load) {
    const fuel = testConds.fuel_load.includes("%") ? testConds.fuel_load : `${testConds.fuel_load}%`;
    parts.push(`${fuel} Fuel`);
  }
  if (testConds.air_temp) {
    const air = testConds.air_temp.includes("°") ? testConds.air_temp : `${testConds.air_temp}°F`;
    parts.push(`Air: ${air}`);
  }
  if (testConds.water_temp) {
    const water = testConds.water_temp.includes("°") ? testConds.water_temp : `${testConds.water_temp}°F`;
    parts.push(`Water: ${water}`);
  }
  if (testConds.water_conditions) {
    parts.push(`Water: ${testConds.water_conditions}`);
  }
  if (testConds.wind_velocity) {
    parts.push(`Wind: ${formatWindSpeed(testConds.wind_velocity)}`);
  }
  if (testConds.elevation) {
    parts.push(`Elev: ${formatElevation(testConds.elevation)}`);
  }
  
  return parts.length > 0 ? parts.join(", ") : "-";
}

const metricButtons = {
  gph: document.getElementById("btnGph"),
  mpg: document.getElementById("btnMpg"),
  mph: document.getElementById("btnMph")
};

// Distinct colors palette for lines
const colorPalette = [
  '#d4af37', // Gold
  '#f43f5e', // Rose
  '#10b981', // Emerald
  '#fbbf24', // Amber
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#f97316', // Orange
  '#06b6d4', // Cyan
  '#84cc16', // Lime
  '#6366f1', // Indigo
  '#14b8a6', // Teal
  '#e11d48'  // Rose dark
];

function getLineColor(index) {
  return colorPalette[index % colorPalette.length];
}

// Parses length in feet (with decimal for inches/fractions) from various formats:
// e.g. "25'2\"", "32' 5\"", "22' - 0\"", "17' - 2\"\"", "22\"", "22?T 2??", "18.4'", "227"
function parseLengthToFeet(lengthStr) {
  if (!lengthStr) return null;
  // Extract all numeric values (integers or decimals)
  const matches = lengthStr.match(/\d+(\.\d+)?/g);
  if (!matches) return null;
  
  if (matches.length === 1) {
    const val = parseFloat(matches[0]);
    // If the value is large (>= 50), it is likely specified in inches (e.g. "227" -> 18.92 ft)
    if (val >= 50) {
      return val / 12;
    }
    return val;
  } else {
    // Treat the first two numbers as feet and inches respectively
    const feet = parseFloat(matches[0]);
    const inches = parseFloat(matches[1]);
    return feet + (inches / 12);
  }
}

// Parses boat weight from boat specifications, prioritizing tested weight over dry weight.
// Strips commas and units to parse a raw numerical value.
function parseWeightToLbs(boatSpecs) {
  if (!boatSpecs) return null;
  
  const parseNum = (str) => {
    if (!str) return null;
    const cleaned = str.replace(/,/g, '').match(/\d+(\.\d+)?/);
    return cleaned ? parseFloat(cleaned[0]) : null;
  };
  
  const tested = parseNum(boatSpecs.weight_as_tested);
  if (tested !== null) return tested;
  
  const dry = parseNum(boatSpecs.dry_weight);
  if (dry !== null) return dry;
  
  return null;
}

// Formats a float feet value back to standard feet/inches format (e.g. 25.17 -> 25' 2", 25 -> 25')
function formatFeetAndInches(feetVal) {
  if (feetVal === null || feetVal === undefined || isNaN(feetVal)) return "Unknown Length";
  const feet = Math.floor(feetVal);
  const inches = Math.round((feetVal - feet) * 12);
  if (inches === 0) {
    return `${feet}'`;
  }
  if (inches === 12) {
    return `${feet + 1}'`;
  }
  return `${feet}' ${inches}"`;
}

// Parses the maximum numerical wind speed from a velocity string (e.g. "5-10 mph" -> 10, "15" -> 15)
function parseWindSpeed(windStr) {
  if (!windStr) return null;
  const matches = windStr.match(/\d+/g);
  if (!matches) return null;
  const numbers = matches.map(Number);
  return Math.max(...numbers);
}

// Helper to determine the grouping key of a boat record based on current color mode
function getRecordGroupKey(record) {
  switch (selectedColorMode) {
    case "boat_manufacturer":
      return record.boat_manufacturer ? record.boat_manufacturer.trim() : "Unknown Brand";
      
    case "hull_length_exact": {
      const feet = parseLengthToFeet(record.boat_length);
      if (feet === null) return "Unknown Length";
      if (activeLengthUnit === "m") {
        return `${(feet * 0.3048).toFixed(2)} m`;
      }
      return formatFeetAndInches(feet);
    }
    
    case "boat_weight_exact": {
      const weight = parseWeightToLbs(record.boat_specs);
      if (weight === null) return "Unknown Weight";
      return `${Math.round(weight).toLocaleString()} lbs`;
    }
    
    case "hull_length_range": {
      const feet = parseLengthToFeet(record.boat_length);
      if (feet === null) return "Unknown Length";
      if (activeLengthUnit === "m") {
        const meters = feet * 0.3048;
        if (meters < 6.10) return "Under 6.10 m";
        if (meters < 7.62) return "6.10 m - 7.62 m";
        if (meters < 9.14) return "7.62 m - 9.14 m";
        return "9.14 m and over";
      } else {
        if (feet < 20) return "Under 20'";
        if (feet < 25) return "20' - 24'";
        if (feet < 30) return "25' - 29'";
        return "30' and over";
      }
    }
    
    case "engine_key": {
      const configVal = getConfiguration(record);
      const configStr = configVal !== "Single" ? `${configVal} ` : "";
      const engineName = getNormalizedEngineName(record.engine_name);
      return `${configStr}${engineName}`.trim() || "Unknown Engine";
    }
    
    case "engine_power_config": {
      const configVal = getConfiguration(record);
      const configStr = configVal !== "Single" ? `${configVal} ` : "Single ";
      const hpVal = getHorsepower(record);
      const hpStr = hpVal ? `${hpVal} HP` : "Unknown HP";
      return `${configStr}${hpStr}`.trim();
    }
    
    case "engine_brand":
      return record.source || "Unknown Engine Brand";
      
    case "hull_type":
      return record.boat_type ? (hullTypeNames[record.boat_type] || record.boat_type) : "Unknown Hull Type";
      
    case "wind_velocity": {
      const speed = record.test_conditions ? parseWindSpeed(record.test_conditions.wind_velocity) : null;
      if (speed === null) return "Unknown Wind";
      if (activeSpeedUnit === "knts") {
        const speedKnts = speed / 1.15078;
        if (speedKnts <= 5) return "Light Wind (0-5 knts)";
        if (speedKnts <= 10) return "Moderate Wind (6-10 knts)";
        if (speedKnts <= 17) return "Fresh Wind (11-17 knts)";
        return "Strong Wind (>17 knts)";
      } else if (activeSpeedUnit === "ms") {
        const speedKph = speed * 1.60934;
        if (speedKph <= 8) return "Light Wind (0-8 kph)";
        if (speedKph <= 19) return "Moderate Wind (9-19 kph)";
        if (speedKph <= 32) return "Fresh Wind (20-32 kph)";
        return "Strong Wind (>32 kph)";
      } else {
        if (speed <= 5) return "Light Wind (0-5 MPH)";
        if (speed <= 12) return "Moderate Wind (6-12 MPH)";
        if (speed <= 20) return "Fresh Wind (13-20 MPH)";
        return "Strong Wind (>20 MPH)";
      }
    }
      
    case "unique":
    default:
      return null;
  }
}


// Fetch performance data (with fallback to data.js variable)
async function loadData() {
  try {
    // Check if the data is already preloaded via the data.js script tag
    if (typeof outboardsPerformanceData !== 'undefined' && Array.isArray(outboardsPerformanceData)) {
      allData = outboardsPerformanceData;
      processData();
      hideLoading();
      return;
    }

    // Fallback to fetching outboards_performance_data.json
    const response = await fetch("outboards_performance_data.json");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    allData = await response.json();
    processData();
    hideLoading();
  } catch (error) {
    console.error("Failed to load outboard performance data:", error);
    const isLocalFile = window.location.protocol === 'file:';
    let extraHint = '';
    if (isLocalFile && typeof outboardsPerformanceData === 'undefined') {
      extraHint = '<br><br><strong>Tip:</strong> It looks like you are opening index.html directly from your file manager, but data.js was not loaded. Make sure data.js exists in the same directory and contains the data.';
    }
    document.querySelector(".loading-text").innerHTML = 
      `<div style="text-align: left; max-width: 500px; margin: 0 auto; color: #ef4444; font-family: monospace;">` +
      `<strong>Initialization Error:</strong> ${error.message}<br>` +
      `<span style="color: #94a3b8; font-size: 0.8rem;">${error.stack ? error.stack.replace(/\n/g, '<br>') : ''}</span>` +
      extraHint +
      `</div>`;
    document.querySelector(".spinner").style.borderTopColor = "#ef4444";
  }
}

// // Helper to parse horsepower from a record
function getHorsepower(record) {
  // 1. Try engine_hp
  if (record.engine_hp !== null && record.engine_hp !== undefined && !isNaN(record.engine_hp) && record.engine_hp > 0) {
    return parseFloat(record.engine_hp);
  }
  // 2. Try engine_specs.horsepower
  if (record.engine_specs && record.engine_specs.horsepower) {
    const val = parseFloat(record.engine_specs.horsepower);
    if (!isNaN(val) && val > 0) return val;
  }
  // 3. Extract numbers from engine name
  const name = record.engine_name || "";
  const matches = name.match(/\b\d+\b/g);
  if (matches) {
    for (const match of matches) {
      const val = parseFloat(match);
      if (val >= 2 && val <= 600) return val;
    }
  }
  return null;
}

// Helper to determine configuration (Single, Twin, Triple, Quad, Quint)
function getConfiguration(record) {
  const count = record.engine_count || 1;
  if (count === 5) return "Quint";
  if (count === 4) return "Quad";
  if (count === 3) return "Triple";
  if (count === 2 || count === 21) return "Twin";
  return "Single";
}

// Helper to normalize engine name (collapsing slashes and shaft lengths)
function getNormalizedEngineName(engineName) {
  if (!engineName) return "Unknown Engine";
  
  // 1. Split by '/' and trim
  const parts = engineName.split('/').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return "Unknown Engine";
  
  // Pick first part that doesn't start with L prefix followed by another letter (Yamaha counter-rotation style)
  const nonLParts = parts.filter(p => {
    const lower = p.toLowerCase();
    return !(lower.startsWith('l') && lower.length > 1 && /[a-z]/.test(lower[1]));
  });
  
  let selected = nonLParts.length > 0 ? nonLParts[0] : parts[0];
  
  // 2. Strip 'L' prefix if it is a counter-rotation prefix (followed by another letter, like LF150 or LFX425)
  const lowerSelected = selected.toLowerCase();
  if (lowerSelected.startsWith('l') && lowerSelected.length > 1 && /[a-z]/.test(lowerSelected[1])) {
    selected = selected.substring(1);
  }
  
  // 3. Strip shaft length characters (TX, TU, X, U, L, Y, Z) situated immediately after HP digits
  // Example: F300XCA -> F300CA, F150XB -> F150B, F350TXR -> F350R
  selected = selected.replace(/(\d+)(?:TX|TU|X|U|L|Y|Z)([A-Za-z]*\d*)/i, '$1$2');
  
  return selected.trim();
}

// Process and group data by unique engine
function processData() {
  const engineGroups = {};
  
  allData.forEach((record, index) => {
    record.originalIndex = index;
    const source = record.source || "Unknown";
    const rawEngineName = record.engine_name || "Unknown Engine";
    const engineName = getNormalizedEngineName(rawEngineName);
    const hpVal = getHorsepower(record);
    const hpStr = hpVal ? `${hpVal} HP` : "";
    const configVal = getConfiguration(record);
    const configStr = configVal !== "Single" ? `${configVal} ` : "";
    
    // Create a key for the engine
    const engineKey = `${source} - ${configStr}${engineName} ${hpStr}`.trim().replace(/\s+/g, ' ');
    
    if (!engineGroups[engineKey]) {
      engineGroups[engineKey] = {
        key: engineKey,
        source: source,
        engineName: engineName,
        hp: hpVal,
        config: configVal,
        records: []
      };
    }
    
    engineGroups[engineKey].records.push({
      ...record,
      originalIndex: index
    });
  });
  
  uniqueEngines = Object.values(engineGroups);
  
  initLengthSlider();
  handleFilterChange();
}

// Helper to get records matching selected filters (optionally excluding some filters to build interdependent facets)
function getFilteredRecords(excludePower = false, excludeConfig = false, excludeHull = false) {
  return allData.filter(record => {
    // 1. Power Filter (if not excluded)
    if (!excludePower && activePowers.length > 0) {
      const hpVal = getHorsepower(record);
      if (hpVal === null || !activePowers.includes(hpVal)) return false;
    }
    // 2. Configuration Filter (if not excluded)
    if (!excludeConfig && activeConfigs.length > 0) {
      const configVal = getConfiguration(record);
      if (!activeConfigs.includes(configVal)) return false;
    }
    // 3. Hull Type Filter (if not excluded)
    if (!excludeHull && activeHulls.length > 0) {
      if (!activeHulls.includes(record.boat_type)) return false;
    }
    // 4. Length Range Filter (always applied)
    if (activeLengthMin !== null || activeLengthMax !== null) {
      const ft = parseLengthToFeet(record.boat_length);
      if (ft === null) return false; // exclude unknown lengths when filter active
      if (activeLengthMin !== null && ft < activeLengthMin) return false;
      if (activeLengthMax !== null && ft > activeLengthMax) return false;
    }
    return true;
  });
}

// Rebuild Power options based on active Config and Hull selections
function updatePowerFilterOptions() {
  const matchingRecords = getFilteredRecords(true, false, false);
  
  const hps = new Set();
  matchingRecords.forEach(record => {
    const hp = getHorsepower(record);
    if (hp !== null && hp !== undefined) {
      hps.add(hp);
    }
  });
  
  powerSelect.innerHTML = '<option value="" disabled selected>Select Horsepower...</option>';
  const sortedHps = Array.from(hps).sort((a, b) => a - b);
  sortedHps.forEach(hp => {
    if (activePowers.includes(hp)) return;
    const option = document.createElement("option");
    option.value = hp;
    option.textContent = `${hp} HP`;
    powerSelect.appendChild(option);
  });
}

// Rebuild Configuration options based on active Power and Hull selections
function updateConfigFilterOptions() {
  const matchingRecords = getFilteredRecords(false, true, false);
  
  const configs = new Set();
  matchingRecords.forEach(record => {
    const cfg = getConfiguration(record);
    if (cfg) {
      configs.add(cfg);
    }
  });
  
  configSelect.innerHTML = '<option value="" disabled selected>Select Configuration...</option>';
  const order = { 'Single': 1, 'Twin': 2, 'Triple': 3, 'Quad': 4, 'Quint': 5 };
  const sortedConfigs = Array.from(configs).sort((a, b) => {
    const orderA = order[a] || 99;
    const orderB = order[b] || 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b);
  });
  
  sortedConfigs.forEach(cfg => {
    if (activeConfigs.includes(cfg)) return;
    const option = document.createElement("option");
    option.value = cfg;
    option.textContent = `${cfg} Engine${cfg !== 'Single' ? 's' : ''}`;
    configSelect.appendChild(option);
  });
}

// Rebuild Hull options based on active Power and Config selections
function updateHullFilterOptions() {
  const matchingRecords = getFilteredRecords(false, false, true);
  
  const hullTypes = new Set();
  matchingRecords.forEach(record => {
    if (record.boat_type) {
      hullTypes.add(record.boat_type);
    }
  });
  
  hullSelect.innerHTML = '<option value="" disabled selected>Select Hull Type...</option>';
  const sortedTypes = Array.from(hullTypes).sort();
  sortedTypes.forEach(type => {
    if (activeHulls.includes(type)) return;
    const option = document.createElement("option");
    option.value = type;
    const displayName = hullTypeNames[type] ? `${hullTypeNames[type]} (${type})` : type;
    option.textContent = displayName;
    hullSelect.appendChild(option);
  });
}

// Power Selection Management
function addPowerSelection(hp) {
  const hpNum = parseFloat(hp);
  if (!isNaN(hpNum) && !activePowers.includes(hpNum)) {
    activePowers.push(hpNum);
  }
  renderSelectedPowersList();
  handleFilterChange();
}

function removePowerSelection(hpNum) {
  activePowers = activePowers.filter(hp => hp !== hpNum);
  renderSelectedPowersList();
  handleFilterChange();
}

function renderSelectedPowersList() {
  selectedPowersList.innerHTML = "";
  clearPowersBtn.style.display = activePowers.length > 0 ? "block" : "none";
  activePowers.forEach(hp => {
    const chip = document.createElement("div");
    chip.className = "selected-chip";
    const textSpan = document.createElement("span");
    textSpan.textContent = `${hp} HP`;
    const removeBtn = document.createElement("button");
    removeBtn.className = "selected-chip-remove";
    removeBtn.title = "Remove power";
    removeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    removeBtn.addEventListener("click", () => {
      removePowerSelection(hp);
    });
    chip.appendChild(textSpan);
    chip.appendChild(removeBtn);
    selectedPowersList.appendChild(chip);
  });
}

// Configuration Selection Management
function addConfigSelection(cfg) {
  if (cfg && !activeConfigs.includes(cfg)) {
    activeConfigs.push(cfg);
  }
  renderSelectedConfigsList();
  handleFilterChange();
}

function removeConfigSelection(cfg) {
  activeConfigs = activeConfigs.filter(c => c !== cfg);
  renderSelectedConfigsList();
  handleFilterChange();
}

function renderSelectedConfigsList() {
  selectedConfigsList.innerHTML = "";
  clearConfigsBtn.style.display = activeConfigs.length > 0 ? "block" : "none";
  activeConfigs.forEach(cfg => {
    const chip = document.createElement("div");
    chip.className = "selected-chip";
    const textSpan = document.createElement("span");
    textSpan.textContent = `${cfg} Engine${cfg !== 'Single' ? 's' : ''}`;
    const removeBtn = document.createElement("button");
    removeBtn.className = "selected-chip-remove";
    removeBtn.title = "Remove configuration";
    removeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    removeBtn.addEventListener("click", () => {
      removeConfigSelection(cfg);
    });
    chip.appendChild(textSpan);
    chip.appendChild(removeBtn);
    selectedConfigsList.appendChild(chip);
  });
}

// Hull Selection Management
function addHullSelection(type) {
  if (type && !activeHulls.includes(type)) {
    activeHulls.push(type);
  }
  renderSelectedHullsList();
  handleFilterChange();
}

function removeHullSelection(type) {
  activeHulls = activeHulls.filter(t => t !== type);
  renderSelectedHullsList();
  handleFilterChange();
}

function renderSelectedHullsList() {
  selectedHullsList.innerHTML = "";
  clearHullsBtn.style.display = activeHulls.length > 0 ? "block" : "none";
  activeHulls.forEach(type => {
    const chip = document.createElement("div");
    chip.className = "selected-chip";
    const textSpan = document.createElement("span");
    const displayName = hullTypeNames[type] ? `${hullTypeNames[type]} (${type})` : type;
    textSpan.textContent = displayName;
    const removeBtn = document.createElement("button");
    removeBtn.className = "selected-chip-remove";
    removeBtn.title = "Remove hull type";
    removeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    removeBtn.addEventListener("click", () => {
      removeHullSelection(type);
    });
    chip.appendChild(textSpan);
    chip.appendChild(removeBtn);
    selectedHullsList.appendChild(chip);
  });
}

// Helper to get all engines that have records matching current filters
function getAllMatchingEngines() {
  const filteredRecords = getFilteredRecords();
  const matchingRecordIndices = new Set(filteredRecords.map(rec => rec.originalIndex));
  
  return uniqueEngines.filter(eng => {
    return eng.records.some(rec => matchingRecordIndices.has(rec.originalIndex));
  });
}

// Harmonized handler when any selection filter is updated
function handleFilterChange() {
  updatePowerFilterOptions();
  updateConfigFilterOptions();
  updateHullFilterOptions();
  
  const hasActiveFilters = activePowers.length > 0 || activeConfigs.length > 0 || activeHulls.length > 0 || activeLengthMin !== null || activeLengthMax !== null;
  if (hasActiveFilters) {
    const matching = getAllMatchingEngines();
    activeEngineIds = matching.map(eng => eng.key);
  } else {
    activeEngineIds = [];
  }
  
  populateEngineSelect();
  renderSelectedEnginesList();
  updateActiveEnginesSummary();
  updateSummaries();
  updateChart();
}

// ── Length Range Slider ──────────────────────────────────────────────────────

function initLengthSlider() {
  // Compute global min/max across all records with a valid length
  let minFt = Infinity, maxFt = -Infinity;
  allData.forEach(record => {
    const ft = parseLengthToFeet(record.boat_length);
    if (ft !== null) {
      if (ft < minFt) minFt = ft;
      if (ft > maxFt) maxFt = ft;
    }
  });
  if (!isFinite(minFt) || !isFinite(maxFt)) return; // no valid lengths

  lengthSliderAbsMin = Math.floor(minFt);
  lengthSliderAbsMax = Math.ceil(maxFt);

  const sliderMin = document.getElementById("lengthSliderMin");
  const sliderMax = document.getElementById("lengthSliderMax");
  if (!sliderMin || !sliderMax) return;

  sliderMin.min = lengthSliderAbsMin;
  sliderMin.max = lengthSliderAbsMax;
  sliderMin.value = lengthSliderAbsMin;

  sliderMax.min = lengthSliderAbsMin;
  sliderMax.max = lengthSliderAbsMax;
  sliderMax.value = lengthSliderAbsMax;

  // Reset active filter state
  activeLengthMin = null;
  activeLengthMax = null;

  updateLengthSliderDisplay();

  // Events
  sliderMin.addEventListener("input", () => {
    let minVal = parseFloat(sliderMin.value);
    let maxVal = parseFloat(sliderMax.value);
    if (minVal > maxVal) { sliderMin.value = maxVal; minVal = maxVal; }
    activeLengthMin = (minVal <= lengthSliderAbsMin) ? null : minVal;
    updateLengthSliderDisplay();
    handleFilterChange();
  });

  sliderMax.addEventListener("input", () => {
    let minVal = parseFloat(sliderMin.value);
    let maxVal = parseFloat(sliderMax.value);
    if (maxVal < minVal) { sliderMax.value = minVal; maxVal = minVal; }
    activeLengthMax = (maxVal >= lengthSliderAbsMax) ? null : maxVal;
    updateLengthSliderDisplay();
    handleFilterChange();
  });

  const clearLengthBtn = document.getElementById("clearLengthBtn");
  if (clearLengthBtn) {
    clearLengthBtn.addEventListener("click", () => {
      sliderMin.value = lengthSliderAbsMin;
      sliderMax.value = lengthSliderAbsMax;
      activeLengthMin = null;
      activeLengthMax = null;
      updateLengthSliderDisplay();
      handleFilterChange();
    });
  }
}

function updateLengthSliderDisplay() {
  const sliderMin = document.getElementById("lengthSliderMin");
  const sliderMax = document.getElementById("lengthSliderMax");
  const track = document.getElementById("lengthSliderTrack");
  const minLabel = document.getElementById("lengthMinLabel");
  const maxLabel = document.getElementById("lengthMaxLabel");
  const clearBtn = document.getElementById("clearLengthBtn");
  if (!sliderMin || !sliderMax || !track) return;

  const minVal = parseFloat(sliderMin.value);
  const maxVal = parseFloat(sliderMax.value);
  const range = lengthSliderAbsMax - lengthSliderAbsMin;

  const leftPct  = range > 0 ? ((minVal - lengthSliderAbsMin) / range) * 100 : 0;
  const rightPct = range > 0 ? ((lengthSliderAbsMax - maxVal)  / range) * 100 : 0;
  track.style.left  = `${leftPct}%`;
  track.style.right = `${rightPct}%`;

  const fmt = (ft) => activeLengthUnit === "m"
    ? `${(ft * 0.3048).toFixed(1)} m`
    : formatFeetAndInches(ft);

  if (minLabel) minLabel.textContent = fmt(minVal);
  if (maxLabel) maxLabel.textContent = fmt(maxVal);

  const isFiltered = activeLengthMin !== null || activeLengthMax !== null;
  if (clearBtn) clearBtn.style.display = isFiltered ? "block" : "none";
}

// Get currently filtered engines based on inputs
function getCurrentlyFilteredEngines() {
  const filterText = engineSearch.value.trim().toLowerCase();
  
  return uniqueEngines.filter(eng => {
    // Don't show already selected engines
    if (activeEngineIds.includes(eng.key)) {
      return false;
    }
    // 1. Text Search Filter
    if (filterText !== "" && !eng.key.toLowerCase().includes(filterText)) {
      return false;
    }
    // 2. Power HP Filter
    if (activePowers.length > 0 && (eng.hp === null || !activePowers.includes(eng.hp))) {
      return false;
    }
    // 3. Configuration Filter
    if (activeConfigs.length > 0 && !activeConfigs.includes(eng.config)) {
      return false;
    }
    // 4. Hull Type Filter
    if (activeHulls.length > 0) {
      const hasHullType = eng.records.some(rec => activeHulls.includes(rec.boat_type));
      if (!hasHullType) return false;
    }
    return true;
  });
}

// Add all currently filtered engines from the select dropdown
function addAllFilteredEngines(filteredEngines) {
  filteredEngines.forEach(eng => {
    if (!activeEngineIds.includes(eng.key)) {
      activeEngineIds.push(eng.key);
    }
  });
  
  renderSelectedEnginesList();
  populateEngineSelect();
  updateActiveEnginesSummary();
  updateSummaries();
  updateChart();
}

// Populate engine select dropdown based on search text and select filters
function populateEngineSelect() {
  engineSelect.innerHTML = '<option value="" disabled selected>Select an engine...</option>';
  
  const filteredEngines = getCurrentlyFilteredEngines();
  
  if (filteredEngines.length > 0) {
    const addAllOption = document.createElement("option");
    addAllOption.value = "ADD_ALL";
    addAllOption.textContent = `[Add All Filtered Engines (${filteredEngines.length})]`;
    addAllOption.style.fontWeight = "600";
    addAllOption.style.color = "var(--accent-primary)";
    engineSelect.appendChild(addAllOption);
  }
  
  // Sort engines alphabetically
  filteredEngines.sort((a, b) => a.key.localeCompare(b.key));
  
  filteredEngines.forEach(eng => {
    const option = document.createElement("option");
    option.value = eng.key;
    option.textContent = `${eng.key} (${eng.records.length} boat models)`;
    engineSelect.appendChild(option);
  });
}

// Add an engine selection from the dropdown
function addEngineSelection(engineKey) {
  if (!activeEngineIds.includes(engineKey)) {
    activeEngineIds.push(engineKey);
  }
  
  renderSelectedEnginesList();
  populateEngineSelect();
  updateActiveEnginesSummary();
  updateSummaries();
  updateChart();
}

// Remove an engine selection
function removeEngineSelection(engineKey) {
  activeEngineIds = activeEngineIds.filter(id => id !== engineKey);
  
  renderSelectedEnginesList();
  populateEngineSelect();
  updateActiveEnginesSummary();
  updateSummaries();
  updateChart();
}

// Render selected engine model chips below dropdown
function renderSelectedEnginesList() {
  selectedEnginesList.innerHTML = "";
  clearEnginesBtn.style.display = activeEngineIds.length > 0 ? "block" : "none";
  activeEngineIds.forEach(key => {
    const chip = document.createElement("div");
    chip.className = "selected-chip";
    
    const textSpan = document.createElement("span");
    textSpan.textContent = key;
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "selected-chip-remove";
    removeBtn.title = "Remove engine";
    removeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    removeBtn.addEventListener("click", () => {
      removeEngineSelection(key);
    });
    
    chip.appendChild(textSpan);
    chip.appendChild(removeBtn);
    selectedEnginesList.appendChild(chip);
  });
}

// Hide loading overlay
function hideLoading() {
  loadingOverlay.classList.add("hidden");
}

// Update the summary metrics for active engines
function updateActiveEnginesSummary() {
  if (activeEngineIds.length === 0) {
    summaryEngine.textContent = "-";
  } else if (activeEngineIds.length === 1) {
    summaryEngine.textContent = activeEngineIds[0];
  } else {
    summaryEngine.textContent = `${activeEngineIds.length} Engines`;
  }
}

// Update count and summaries of boat models matching active engines and filters
function updateSummaries() {
  if (activeEngineIds.length === 0) {
    summaryBoatCount.textContent = "0";
    summaryPlottedCount.textContent = "0";
    return;
  }
  
  // Gather all records from selected engines
  let combinedRecords = [];
  activeEngineIds.forEach(id => {
    const eng = uniqueEngines.find(e => e.key === id);
    if (eng) {
      combinedRecords = combinedRecords.concat(eng.records);
    }
  });
  
  // Filter by active sidebar filters
  const filteredRecords = combinedRecords.filter(record => {
    if (activeHulls.length > 0 && !activeHulls.includes(record.boat_type)) return false;
    if (activePowers.length > 0) {
      const hp = getHorsepower(record);
      if (hp === null || !activePowers.includes(hp)) return false;
    }
    if (activeConfigs.length > 0) {
      const configVal = getConfiguration(record);
      if (!activeConfigs.includes(configVal)) return false;
    }
    if (activeLengthMin !== null || activeLengthMax !== null) {
      const ft = parseLengthToFeet(record.boat_length);
      if (ft === null) return false;
      if (activeLengthMin !== null && ft < activeLengthMin) return false;
      if (activeLengthMax !== null && ft > activeLengthMax) return false;
    }
    return true;
  });
  
  summaryBoatCount.textContent = filteredRecords.length;
  summaryPlottedCount.textContent = filteredRecords.length;
}

// Get metric display names and unit
function getMetricDetails() {
  const engSuffix = perEngine ? "/eng" : "";
  switch (selectedMetric) {
    case "gph": {
      const u = getVolumeUnitLabel() + "/h" + engSuffix;
      return { label: `Fuel Consumption (${u})`, unit: u, title: `RPM vs Fuel Consumption (${u})` };
    }
    case "mpg": {
      const u = getEconomyUnitLabel() + engSuffix;
      return { label: `Fuel Economy (${u})`, unit: u, title: `RPM vs Fuel Economy (${u})` };
    }
    case "mph": {
      const u = getSpeedUnitLabel();
      return { label: `Speed (${u})`, unit: u, title: `RPM vs Speed (${u})` };
    }
    default: {
      const u = getVolumeUnitLabel() + "/h" + engSuffix;
      return { label: `Fuel Consumption (${u})`, unit: u, title: `RPM vs Fuel Consumption (${u})` };
    }
  }
}

// Update Chart
function updateChart() {
  const details = getMetricDetails();
  chartTitle.textContent = details.title;

  if (activeEngineIds.length === 0) {
    clearChart();
    return;
  }

  // Gather all records from selected engines
  let combinedRecords = [];
  activeEngineIds.forEach(id => {
    const eng = uniqueEngines.find(e => e.key === id);
    if (eng) {
      combinedRecords = combinedRecords.concat(eng.records);
    }
  });

  // Apply filters
  const recordsToPlot = combinedRecords.filter(record => {
    if (activeHulls.length > 0 && !activeHulls.includes(record.boat_type)) return false;
    if (activePowers.length > 0) {
      const hp = getHorsepower(record);
      if (hp === null || !activePowers.includes(hp)) return false;
    }
    if (activeConfigs.length > 0) {
      const configVal = getConfiguration(record);
      if (!activeConfigs.includes(configVal)) return false;
    }
    if (activeLengthMin !== null || activeLengthMax !== null) {
      const ft = parseLengthToFeet(record.boat_length);
      if (ft === null) return false;
      if (activeLengthMin !== null && ft < activeLengthMin) return false;
      if (activeLengthMax !== null && ft > activeLengthMax) return false;
    }
    return true;
  });

  if (recordsToPlot.length === 0) {
    clearChart();
    return;
  }

  // Determine group colors mapping if color mode is not unique
  const groupColors = {};

  // For hull_length_exact / boat_weight_exact: compute min/max across all plotted records for the spectrum
  let lengthSpectrumMin = null;
  let lengthSpectrumMax = null;
  if (selectedColorMode === "hull_length_exact") {
    recordsToPlot.forEach(record => {
      const ft = parseLengthToFeet(record.boat_length);
      if (ft !== null) {
        if (lengthSpectrumMin === null || ft < lengthSpectrumMin) lengthSpectrumMin = ft;
        if (lengthSpectrumMax === null || ft > lengthSpectrumMax) lengthSpectrumMax = ft;
      }
    });
  }

  let weightSpectrumMin = null;
  let weightSpectrumMax = null;
  if (selectedColorMode === "boat_weight_exact") {
    recordsToPlot.forEach(record => {
      const lbs = parseWeightToLbs(record.boat_specs);
      if (lbs !== null) {
        if (weightSpectrumMin === null || lbs < weightSpectrumMin) weightSpectrumMin = lbs;
        if (weightSpectrumMax === null || lbs > weightSpectrumMax) weightSpectrumMax = lbs;
      }
    });
  }

  // Maps a 0–1 value to a blue→cyan→green→yellow→red spectrum (HSL hue 240→0)
  function spectrumColor(t) {
    const hue = Math.round((1 - t) * 240); // 240=blue at short, 0=red at long
    return `hsl(${hue}, 90%, 55%)`;
  }

  if (selectedColorMode !== "unique" && selectedColorMode !== "hull_length_exact" && selectedColorMode !== "boat_weight_exact") {
    const uniqueKeys = new Set();
    recordsToPlot.forEach(record => {
      uniqueKeys.add(getRecordGroupKey(record));
    });
    
    const sortedKeys = Array.from(uniqueKeys).sort((a, b) => {
      if (selectedColorMode === "engine_power_config") {
        const order = { 'Single': 1, 'Twin': 2, 'Triple': 3, 'Quad': 4, 'Quint': 5 };
        const partsA = a.split(" ");
        const partsB = b.split(" ");
        const configA = partsA[0];
        const configB = partsB[0];
        const hpA = parseFloat(partsA[1]) || 0;
        const hpB = parseFloat(partsB[1]) || 0;
        const orderA = order[configA] || 99;
        const orderB = order[configB] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return hpA - hpB;
      }
      if (selectedColorMode === "hull_length_range") {
        const order = activeLengthUnit === "m"
          ? { "Under 6.10 m": 1, "6.10 m - 7.62 m": 2, "7.62 m - 9.14 m": 3, "9.14 m and over": 4, "Unknown Length": 5 }
          : { "Under 20'": 1, "20' - 24'": 2, "25' - 29'": 3, "30' and over": 4, "Unknown Length": 5 };
        return (order[a] || 99) - (order[b] || 99);
      }
      if (selectedColorMode === "wind_velocity") {
        let order;
        if (activeSpeedUnit === "knts") {
          order = { "Light Wind (0-5 knts)": 1, "Moderate Wind (6-10 knts)": 2, "Fresh Wind (11-17 knts)": 3, "Strong Wind (>17 knts)": 4, "Unknown Wind": 5 };
        } else if (activeSpeedUnit === "ms") {
          order = { "Light Wind (0-8 kph)": 1, "Moderate Wind (9-19 kph)": 2, "Fresh Wind (20-32 kph)": 3, "Strong Wind (>32 kph)": 4, "Unknown Wind": 5 };
        } else {
          order = { "Light Wind (0-5 MPH)": 1, "Moderate Wind (6-12 MPH)": 2, "Fresh Wind (13-20 MPH)": 3, "Strong Wind (>20 MPH)": 4, "Unknown Wind": 5 };
        }
        return (order[a] || 99) - (order[b] || 99);
      }
      return a.localeCompare(b);
    });
    
    sortedKeys.forEach((key, idx) => {
      groupColors[key] = colorPalette[idx % colorPalette.length];
    });
  }

  // Build datasets
  const datasets = recordsToPlot.map((record, index) => {
    // Sort performance points by RPM numeric
    const rawPerf = record.performance_data || [];
    const points = rawPerf
      .map(pt => {
        const rpm = pt.rpm_numeric !== undefined && pt.rpm_numeric !== null ? pt.rpm_numeric : parseFloat(pt.rpm);
        
        const engCount = (perEngine && record.engine_count && record.engine_count > 1) ? record.engine_count : 1;

        let val = null;
        if (selectedMetric === "gph") {
          const rawGph = pt.gph !== undefined && pt.gph !== null ? parseFloat(pt.gph) : null;
          const converted = convertFuel(rawGph);
          val = converted !== null ? converted / engCount : null;
        } else if (selectedMetric === "mpg") {
          const rawMph = pt.mph !== undefined && pt.mph !== null ? parseFloat(pt.mph) : null;
          const rawGph = pt.gph !== undefined && pt.gph !== null ? parseFloat(pt.gph) : null;
          // For economy per engine: use gph/engCount so the boat travels the same distance burning less per engine
          const rawGphPerEng = (rawGph !== null && engCount > 1) ? rawGph / engCount : rawGph;
          val = perEngine ? convertEconomy(rawMph, rawGphPerEng) : convertEconomy(rawMph, rawGph);
        } else if (selectedMetric === "mph") {
          const rawMph = pt.mph !== undefined && pt.mph !== null ? parseFloat(pt.mph) : null;
          val = convertSpeed(rawMph);
        }

        return { x: rpm, y: val, raw: pt };
      })
      // Filter out points with invalid RPM or target metric value
      .filter(p => !isNaN(p.x) && p.y !== null && !isNaN(p.y))
      .sort((a, b) => a.x - b.x);

    const mfg = record.boat_manufacturer || "";
    const model = record.boat_model || "";
    const engineStr = record.engine_name ? ` - ${record.engine_name}` : "";
    const label = `${mfg} ${model}${engineStr}`.trim();
    
    // Assign color based on the selected mode
    let color;
    let isHidden = false;
    if (selectedColorMode === "unique") {
      color = getLineColor(index);
    } else if (selectedColorMode === "hull_length_exact") {
      const ft = parseLengthToFeet(record.boat_length);
      if (ft !== null && lengthSpectrumMin !== null && lengthSpectrumMax !== null && lengthSpectrumMax > lengthSpectrumMin) {
        const t = (ft - lengthSpectrumMin) / (lengthSpectrumMax - lengthSpectrumMin);
        color = spectrumColor(t);
      } else {
        color = "#94a3b8"; // fallback for unknown / single-value range
        isHidden = true;
      }
    } else if (selectedColorMode === "boat_weight_exact") {
      const lbs = parseWeightToLbs(record.boat_specs);
      if (lbs !== null && weightSpectrumMin !== null && weightSpectrumMax !== null && weightSpectrumMax > weightSpectrumMin) {
        const t = (lbs - weightSpectrumMin) / (weightSpectrumMax - weightSpectrumMin);
        color = spectrumColor(t);
      } else {
        color = "#94a3b8"; // fallback for unknown / single-value range
        isHidden = true;
      }
    } else {
      color = groupColors[getRecordGroupKey(record)] || "#cccccc";
    }

    return {
      label: label,
      data: points,
      borderColor: color,
      backgroundColor: color + '22', // translucent fill / point background
      borderWidth: 2.5,
      tension: 0.2, // slight curve smoothing
      pointRadius: 4,
      pointHoverRadius: 6,
      fill: false,
      hidden: isHidden,
      originalRecord: record // Save reference to record
    };
  });

  const ctx = document.getElementById("performanceChart").getContext("2d");

  if (chartInstance) {
    chartInstance.destroy();
  }

  // Find all unique RPMs across all datasets to use as labels if needed, 
  // but since X is linear numerical, we'll configure chart as a scatter / linear X axis!
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: datasets
    },
    options: {
      onClick: (event, elements) => {
        if (elements && elements.length > 0) {
          const firstElement = elements[0];
          const datasetIndex = firstElement.datasetIndex;
          const dataset = chartInstance.data.datasets[datasetIndex];
          const record = dataset.originalRecord;
          if (record) {
            highlightDetailsTableRow(record.originalIndex);
          }
        }
      },
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          position: 'bottom',
          title: {
            display: true,
            text: 'Engine RPM',
            color: '#94a3b8',
            font: {
              weight: '600',
              size: 11
            }
          },
          grid: {
            color: '#2d2d2d'
          },
          ticks: {
            color: '#94a3b8',
            callback: function(value) {
              return Math.round(value);
            }
          }
        },
        y: {
          title: {
            display: true,
            text: details.label,
            color: '#94a3b8',
            font: {
              weight: '600',
              size: 11
            }
          },
          grid: {
            color: '#2d2d2d'
          },
          ticks: {
            color: '#94a3b8',
            callback: function(value) {
              if (selectedMetric === "mpg") {
                return value.toFixed(2);
              }
              return value.toFixed(1);
            }
          }
        }
      },
      plugins: {
        legend: {
          display: false // Hide the built-in legend in favor of custom HTML legend
        },
        tooltip: {
          backgroundColor: '#1a1a1a',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          borderColor: '#2d2d2d',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: function(context) {
              return `RPM: ${context[0].parsed.x}`;
            },
            label: function(context) {
              const pt = context.raw;
              const dsLabel = context.dataset.label;
              const unit = details.unit;
              const val = context.parsed.y.toFixed(2);
              
              // Custom details display in tooltip
              let labelStr = `${dsLabel}: ${val} ${unit}`;
              
              if (pt.raw) {
                const mphVal = pt.raw.mph !== undefined ? parseFloat(pt.raw.mph) : null;
                const gphVal = pt.raw.gph !== undefined ? parseFloat(pt.raw.gph) : null;
                
                const speedStr = mphVal !== null ? `${convertSpeed(mphVal).toFixed(1)} ${getSpeedUnitLabel()}` : '-';
                const fuelStr = gphVal !== null ? `${convertFuel(gphVal).toFixed(1)} ${getVolumeUnitLabel()}/h` : '-';
                const econStr = (mphVal !== null && gphVal !== null) ? `${convertEconomy(mphVal, gphVal).toFixed(2)} ${getEconomyUnitLabel()}` : '-';
                
                labelStr += ` | Speed: ${speedStr} | Fuel: ${fuelStr} | Economy: ${econStr}`;
              }
              return labelStr;
            }
          }
        },
        zoom: {
          zoom: {
            wheel: {
              enabled: true
            },
            pinch: {
              enabled: true
            },
            mode: 'xy'
          },
          pan: {
            enabled: true,
            mode: 'xy'
          }
        }
      }
    }
  });

  // Render custom HTML legend and details table
  buildCustomLegend(datasets, groupColors);
  buildDetailsTable(datasets);
}

// Helper to update active state of the spectrum unknown toggle
function updateSpectrumUnknownActiveState(datasets) {
  const spectrumUnknownToggle = document.getElementById("spectrumUnknownToggle");
  if (!spectrumUnknownToggle) return;
  const toggleItem = spectrumUnknownToggle.querySelector(".legend-item");
  if (!toggleItem) return;
  
  const unknownIndices = [];
  datasets.forEach((ds, idx) => {
    if (selectedColorMode === "hull_length_exact") {
      const ft = parseLengthToFeet(ds.originalRecord && ds.originalRecord.boat_length);
      if (ft === null) {
        unknownIndices.push(idx);
      }
    } else if (selectedColorMode === "boat_weight_exact") {
      const lbs = parseWeightToLbs(ds.originalRecord && ds.originalRecord.boat_specs);
      if (lbs === null) {
        unknownIndices.push(idx);
      }
    }
  });
  
  const isUnknownVisible = unknownIndices.some(idx => chartInstance.isDatasetVisible(idx));
  if (isUnknownVisible) {
    toggleItem.classList.remove("hidden");
  } else {
    toggleItem.classList.add("hidden");
  }
}

// Helper to update active states of both group and curve legends without rebuilding elements
function updateLegendActiveStates(datasets, groupColors) {
  // Update Individual Curve Legend Items
  const legendContainer = document.getElementById("chartLegend");
  if (legendContainer) {
    const items = legendContainer.querySelectorAll(".legend-item");
    items.forEach((item, index) => {
      const isVisible = chartInstance.isDatasetVisible(index);
      if (isVisible) {
        item.classList.remove("hidden");
      } else {
        item.classList.add("hidden");
      }
    });
  }
  
  // Update Group Legend Items
  updateGroupLegendActiveStates(datasets, groupColors);
  
  // Update Spectrum Unknown active state
  updateSpectrumUnknownActiveState(datasets);
}

function updateGroupLegendActiveStates(datasets, groupColors) {
  const groupLegend = document.getElementById("groupLegend");
  if (!groupLegend || !groupColors || selectedColorMode === "unique" || selectedColorMode === "hull_length_exact" || selectedColorMode === "boat_weight_exact") return;
  
  const groupItems = groupLegend.querySelectorAll(".legend-item");
  const sortedGroupKeys = Object.keys(groupColors).sort((a, b) => {
    if (selectedColorMode === "engine_power_config") {
      const order = { 'Single': 1, 'Twin': 2, 'Triple': 3, 'Quad': 4, 'Quint': 5 };
      const partsA = a.split(" ");
      const partsB = b.split(" ");
      const configA = partsA[0];
      const configB = partsB[0];
      const hpA = parseFloat(partsA[1]) || 0;
      const hpB = parseFloat(partsB[1]) || 0;
      const orderA = order[configA] || 99;
      const orderB = order[configB] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return hpA - hpB;
    }
    if (selectedColorMode === "hull_length_exact") {
      const valA = parseLengthToFeet(a);
      const valB = parseLengthToFeet(b);
      if (valA !== null && valB !== null) return valA - valB;
    }
    if (selectedColorMode === "hull_length_range") {
      const order = activeLengthUnit === "m"
        ? { "Under 6.10 m": 1, "6.10 m - 7.62 m": 2, "7.62 m - 9.14 m": 3, "9.14 m and over": 4, "Unknown Length": 5 }
        : { "Under 20'": 1, "20' - 24'": 2, "25' - 29'": 3, "30' and over": 4, "Unknown Length": 5 };
      return (order[a] || 99) - (order[b] || 99);
    }
    if (selectedColorMode === "wind_velocity") {
      let order;
      if (activeSpeedUnit === "knts") {
        order = { "Light Wind (0-5 knts)": 1, "Moderate Wind (6-10 knts)": 2, "Fresh Wind (11-17 knts)": 3, "Strong Wind (>17 knts)": 4, "Unknown Wind": 5 };
      } else if (activeSpeedUnit === "ms") {
        order = { "Light Wind (0-8 kph)": 1, "Moderate Wind (9-19 kph)": 2, "Fresh Wind (20-32 kph)": 3, "Strong Wind (>32 kph)": 4, "Unknown Wind": 5 };
      } else {
        order = { "Light Wind (0-5 MPH)": 1, "Moderate Wind (6-12 MPH)": 2, "Fresh Wind (13-20 MPH)": 3, "Strong Wind (>20 MPH)": 4, "Unknown Wind": 5 };
      }
      return (order[a] || 99) - (order[b] || 99);
    }
    return a.localeCompare(b);
  });
  
  sortedGroupKeys.forEach((groupKey, groupIdx) => {
    const groupItem = groupItems[groupIdx];
    if (!groupItem) return;
    
    // Find member datasets
    const memberIndices = [];
    datasets.forEach((dataset, idx) => {
      if (getRecordGroupKey(dataset.originalRecord) === groupKey) {
        memberIndices.push(idx);
      }
    });
    
    const isGroupVisible = memberIndices.some(idx => chartInstance.isDatasetVisible(idx));
    if (isGroupVisible) {
      groupItem.classList.remove("hidden");
    } else {
      groupItem.classList.add("hidden");
    }
  });
}

// Build custom HTML-based legend with PDF local link buttons
function buildCustomLegend(datasets, groupColors) {
  const legendCard = document.getElementById("legendCard");
  const legendContainer = document.getElementById("chartLegend");
  const groupLegend = document.getElementById("groupLegend");
  const groupLegendSection = document.getElementById("groupLegendSection");
  const curvesLegendSection = document.getElementById("curvesLegendSection");
  
  if (!legendContainer) return;
  legendContainer.innerHTML = "";
  if (groupLegend) groupLegend.innerHTML = "";
  
  const spectrumSection = document.getElementById("spectrumLegendSection");
  const spectrumTicks = document.getElementById("spectrumTicks");

  if (!datasets || datasets.length === 0) {
    if (legendCard) legendCard.style.display = "none";
    if (colorModeCard) colorModeCard.style.display = "none";
    if (spectrumSection) spectrumSection.style.display = "none";
    if (curvesLegendSection) curvesLegendSection.style.display = "none";
    return;
  }
  
  if (legendCard) {
    legendCard.style.display = (selectedColorMode === "unique") ? "none" : "block";
  }
  if (colorModeCard) colorModeCard.style.display = "block";
  if (curvesLegendSection) {
    curvesLegendSection.style.display = (selectedColorMode === "unique") ? "block" : "none";
  }
  
  // --- Spectrum Legend (hull_length_exact / boat_weight_exact) ---
  if ((selectedColorMode === "hull_length_exact" || selectedColorMode === "boat_weight_exact") && spectrumSection && spectrumTicks) {
    // Set legend title dynamically
    const spectrumLegendTitle = document.getElementById("spectrumLegendTitle");
    if (spectrumLegendTitle) {
      if (selectedColorMode === "hull_length_exact") {
        spectrumLegendTitle.textContent = "Hull Length Color Scale";
      } else {
        spectrumLegendTitle.textContent = "Boat Weight Color Scale";
      }
    }

    // Compute min/max from datasets
    let minVal = null, maxVal = null;
    datasets.forEach(ds => {
      if (selectedColorMode === "hull_length_exact") {
        const ft = parseLengthToFeet(ds.originalRecord && ds.originalRecord.boat_length);
        if (ft !== null) {
          if (minVal === null || ft < minVal) minVal = ft;
          if (maxVal === null || ft > maxVal) maxVal = ft;
        }
      } else if (selectedColorMode === "boat_weight_exact") {
        const lbs = parseWeightToLbs(ds.originalRecord && ds.originalRecord.boat_specs);
        if (lbs !== null) {
          if (minVal === null || lbs < minVal) minVal = lbs;
          if (maxVal === null || lbs > maxVal) maxVal = lbs;
        }
      }
    });

    spectrumSection.style.display = "block";
    if (groupLegendSection) groupLegendSection.style.display = "none";

    // Build tick labels: min, 25%, 50%, 75%, max
    spectrumTicks.innerHTML = "";
    const tickCount = 5;
    for (let i = 0; i < tickCount; i++) {
      const t = i / (tickCount - 1);
      const tick = document.createElement("span");
      tick.className = "spectrum-tick";
      if (minVal !== null && maxVal !== null) {
        const val = minVal + t * (maxVal - minVal);
        let label;
        if (selectedColorMode === "hull_length_exact") {
          label = activeLengthUnit === "m"
            ? `${(val * 0.3048).toFixed(1)} m`
            : formatFeetAndInches(val);
        } else {
          label = `${Math.round(val).toLocaleString()} lbs`;
        }
        tick.textContent = label;
      } else {
        tick.textContent = "–";
      }
      spectrumTicks.appendChild(tick);
    }

    // --- Spectrum Unknown Toggle ---
    const spectrumUnknownToggle = document.getElementById("spectrumUnknownToggle");
    if (spectrumUnknownToggle) {
      spectrumUnknownToggle.innerHTML = "";
      
      const unknownIndices = [];
      datasets.forEach((ds, idx) => {
        if (selectedColorMode === "hull_length_exact") {
          const ft = parseLengthToFeet(ds.originalRecord && ds.originalRecord.boat_length);
          if (ft === null) unknownIndices.push(idx);
        } else if (selectedColorMode === "boat_weight_exact") {
          const lbs = parseWeightToLbs(ds.originalRecord && ds.originalRecord.boat_specs);
          if (lbs === null) unknownIndices.push(idx);
        }
      });
      
      if (unknownIndices.length > 0) {
        const isUnknownVisible = unknownIndices.some(idx => chartInstance.isDatasetVisible(idx));
        
        const toggleItem = document.createElement("div");
        toggleItem.className = "legend-item";
        if (!isUnknownVisible) {
          toggleItem.classList.add("hidden");
        }
        
        const colorCircle = document.createElement("span");
        colorCircle.className = "legend-color";
        colorCircle.style.backgroundColor = "#94a3b8";
        colorCircle.style.boxShadow = "0 0 4px #94a3b8";
        
        const labelSpan = document.createElement("span");
        labelSpan.className = "legend-label";
        const labelType = selectedColorMode === "hull_length_exact" ? "Length" : "Weight";
        labelSpan.textContent = `Unknown ${labelType} (${unknownIndices.length} series)`;
        
        toggleItem.appendChild(colorCircle);
        toggleItem.appendChild(labelSpan);
        
        const toggleUnknown = () => {
          const currentlyVisible = unknownIndices.some(idx => chartInstance.isDatasetVisible(idx));
          unknownIndices.forEach(idx => {
            if (currentlyVisible) {
              chartInstance.hide(idx);
            } else {
              chartInstance.show(idx);
            }
          });
          
          if (currentlyVisible) {
            toggleItem.classList.add("hidden");
          } else {
            toggleItem.classList.remove("hidden");
          }
          updateDetailsTableOpacities();
        };
        
        colorCircle.addEventListener("click", toggleUnknown);
        labelSpan.addEventListener("click", toggleUnknown);
        
        spectrumUnknownToggle.appendChild(toggleItem);
      }
    }
  } else {
    if (spectrumSection) spectrumSection.style.display = "none";
  }

  // 1. Group Legend Section
  if (selectedColorMode !== "unique" && selectedColorMode !== "hull_length_exact" && selectedColorMode !== "boat_weight_exact" && groupColors && groupLegend && groupLegendSection) {
    groupLegendSection.style.display = "block";
    
    // Sort group keys
    const sortedGroupKeys = Object.keys(groupColors).sort((a, b) => {
      if (selectedColorMode === "engine_power_config") {
        const order = { 'Single': 1, 'Twin': 2, 'Triple': 3, 'Quad': 4, 'Quint': 5 };
        const partsA = a.split(" ");
        const partsB = b.split(" ");
        const configA = partsA[0];
        const configB = partsB[0];
        const hpA = parseFloat(partsA[1]) || 0;
        const hpB = parseFloat(partsB[1]) || 0;
        const orderA = order[configA] || 99;
        const orderB = order[configB] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return hpA - hpB;
      }
      if (selectedColorMode === "hull_length_exact") {
        const valA = parseLengthToFeet(a);
        const valB = parseLengthToFeet(b);
        if (valA !== null && valB !== null) return valA - valB;
      }
      if (selectedColorMode === "hull_length_range") {
        const order = activeLengthUnit === "m"
          ? { "Under 6.10 m": 1, "6.10 m - 7.62 m": 2, "7.62 m - 9.14 m": 3, "9.14 m and over": 4, "Unknown Length": 5 }
          : { "Under 20'": 1, "20' - 24'": 2, "25' - 29'": 3, "30' and over": 4, "Unknown Length": 5 };
        return (order[a] || 99) - (order[b] || 99);
      }
      if (selectedColorMode === "wind_velocity") {
        let order;
        if (activeSpeedUnit === "knts") {
          order = { "Light Wind (0-5 knts)": 1, "Moderate Wind (6-10 knts)": 2, "Fresh Wind (11-17 knts)": 3, "Strong Wind (>17 knts)": 4, "Unknown Wind": 5 };
        } else if (activeSpeedUnit === "ms") {
          order = { "Light Wind (0-8 kph)": 1, "Moderate Wind (9-19 kph)": 2, "Fresh Wind (20-32 kph)": 3, "Strong Wind (>32 kph)": 4, "Unknown Wind": 5 };
        } else {
          order = { "Light Wind (0-5 MPH)": 1, "Moderate Wind (6-12 MPH)": 2, "Fresh Wind (13-20 MPH)": 3, "Strong Wind (>20 MPH)": 4, "Unknown Wind": 5 };
        }
        return (order[a] || 99) - (order[b] || 99);
      }
      return a.localeCompare(b);
    });
    
    sortedGroupKeys.forEach(groupKey => {
      const color = groupColors[groupKey];
      
      // Find all dataset indices that belong to this group
      const memberIndices = [];
      datasets.forEach((dataset, idx) => {
        if (getRecordGroupKey(dataset.originalRecord) === groupKey) {
          memberIndices.push(idx);
        }
      });
      
      // Check if group is visible (at least one member is visible)
      const isGroupVisible = memberIndices.some(idx => chartInstance.isDatasetVisible(idx));
      
      const groupItem = document.createElement("div");
      groupItem.className = "legend-item";
      if (!isGroupVisible) {
        groupItem.classList.add("hidden");
      }
      
      // Color circle
      const colorCircle = document.createElement("span");
      colorCircle.className = "legend-color";
      colorCircle.style.backgroundColor = color;
      colorCircle.style.boxShadow = `0 0 4px ${color}`;
      
      // Label text
      const labelSpan = document.createElement("span");
      labelSpan.className = "legend-label";
      labelSpan.textContent = groupKey;
      
      groupItem.appendChild(colorCircle);
      groupItem.appendChild(labelSpan);
      
      // Toggle all member datasets in group when clicked
      const toggleGroup = () => {
        const currentlyVisible = memberIndices.some(idx => chartInstance.isDatasetVisible(idx));
        
        memberIndices.forEach(idx => {
          if (currentlyVisible) {
            chartInstance.hide(idx);
          } else {
            chartInstance.show(idx);
          }
        });
        
        // Refresh legend & table styles
        updateLegendActiveStates(datasets, groupColors);
        updateDetailsTableOpacities();
      };
      
      colorCircle.addEventListener("click", toggleGroup);
      labelSpan.addEventListener("click", toggleGroup);
      
      groupLegend.appendChild(groupItem);
    });
  } else {
    if (groupLegendSection) groupLegendSection.style.display = "none";
  }
  
  // 2. Individual Curves Legend
  datasets.forEach((dataset, index) => {
    const record = dataset.originalRecord;
    const legendItem = document.createElement("div");
    legendItem.className = "legend-item";
    
    // Color circle
    const colorCircle = document.createElement("span");
    colorCircle.className = "legend-color";
    colorCircle.style.backgroundColor = dataset.borderColor;
    colorCircle.style.boxShadow = `0 0 4px ${dataset.borderColor}`;
    
    // Label text
    const labelSpan = document.createElement("span");
    labelSpan.className = "legend-label";
    
    let labelText = dataset.label;
    if (selectedColorMode !== "unique") {
      const groupKey = getRecordGroupKey(record);
      labelText += ` (${groupKey})`;
    }
    labelSpan.textContent = labelText;
    
    legendItem.appendChild(colorCircle);
    legendItem.appendChild(labelSpan);
    
    // Set class if dataset is hidden
    const isVisible = chartInstance.isDatasetVisible(index);
    if (!isVisible) {
      legendItem.classList.add("hidden");
    }
    
    // Clicking the item toggles visibility
    const toggleVisibility = () => {
      const currentlyVisible = chartInstance.isDatasetVisible(index);
      if (currentlyVisible) {
        chartInstance.hide(index);
        legendItem.classList.add("hidden");
      } else {
        chartInstance.show(index);
        legendItem.classList.remove("hidden");
      }
      // Also update the group legend active states to keep them synced
      updateGroupLegendActiveStates(datasets, groupColors);
      updateDetailsTableOpacities();
    };
    
    colorCircle.addEventListener("click", toggleVisibility);
    labelSpan.addEventListener("click", toggleVisibility);
    
    // PDF Logo button (linked to the external URL by default)
    const pdfPath = record.pdf_url || record.local_file_path;
    if (pdfPath) {
      const pdfBtn = document.createElement("a");
      pdfBtn.className = "legend-pdf-btn";
      pdfBtn.href = pdfPath;
      pdfBtn.target = "_blank";
      pdfBtn.title = "Open PDF Bulletin";
      pdfBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      `;
      // Stop click event from toggling the visibility
      pdfBtn.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      legendItem.appendChild(pdfBtn);
    }
    
    legendContainer.appendChild(legendItem);
  });
}

// Build detailed specs table for plotted lines
function buildDetailsTable(datasets) {
  const detailsCard = document.getElementById("detailsCard");
  const detailsTableBody = document.getElementById("detailsTableBody");
  
  if (!datasets || datasets.length === 0) {
    detailsCard.style.display = "none";
    return;
  }
  
  detailsCard.style.display = "block";
  detailsTableBody.innerHTML = "";
  
  datasets.forEach((dataset, index) => {
    const record = dataset.originalRecord;
    const color = dataset.borderColor;
    const mfg = record.boat_manufacturer || "";
    const model = record.boat_model || "";
    const len = record.boat_length ? ` (${convertLengthStr(record.boat_length)})` : "";
    const engineSuffix = record.engine_name ? ` - ${record.engine_name}` : "";
    const boatName = `${mfg} ${model}${len}${engineSuffix}`.trim() || `Boat #${record.originalIndex}`;
    
    const configVal = getConfiguration(record);
    const configStr = configVal !== "Single" ? `${configVal} ` : "Single ";
    const engineStr = `${configStr}${record.engine_name || ""}`.trim();
    
    const propDesc = record.propeller_desc || (record.propeller_specs && record.propeller_specs.diameter_pitch) || "-";
    const weight = formatWeight(record.boat_specs);
    
    const tr = document.createElement("tr");
    tr.id = `details-row-${record.originalIndex}`;
    
    // Color Column
    const tdColor = document.createElement("td");
    let colorBadgeHtml = `<span class="color-badge" style="background-color: ${color}; box-shadow: 0 0 6px ${color};"></span>`;
    if (selectedColorMode !== "unique") {
      const groupKey = getRecordGroupKey(record);
      colorBadgeHtml += ` <span style="font-size: 0.75rem; color: var(--text-secondary); margin-left: 0.35rem;">${groupKey}</span>`;
    }
    tdColor.innerHTML = colorBadgeHtml;
    tr.appendChild(tdColor);
    
    // Boat Model Column
    const tdBoat = document.createElement("td");
    tdBoat.textContent = boatName;
    tdBoat.style.fontWeight = "500";
    tr.appendChild(tdBoat);
    
    // Engine Column
    const tdEngine = document.createElement("td");
    tdEngine.textContent = engineStr;
    tr.appendChild(tdEngine);
    
    // Propeller Column
    const tdProp = document.createElement("td");
    tdProp.textContent = propDesc;
    tr.appendChild(tdProp);
    
    // Weight Column
    const tdWeight = document.createElement("td");
    tdWeight.textContent = weight;
    tr.appendChild(tdWeight);
    
    // Test Conditions Column
    const tdConditions = document.createElement("td");
    tdConditions.textContent = formatTestConditions(record.test_conditions);
    tr.appendChild(tdConditions);
    
    // Action/PDF Column
    const tdAction = document.createElement("td");
    const pdfPath = record.pdf_url || record.local_file_path;
    if (pdfPath) {
      const btn = document.createElement("a");
      btn.className = "pdf-action-btn";
      btn.href = pdfPath;
      btn.target = "_blank";
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
        Open PDF
      `;
      tdAction.appendChild(btn);
    } else {
      tdAction.textContent = "-";
    }
    tr.appendChild(tdAction);
    
    // Handle initial hidden state
    if (chartInstance && !chartInstance.isDatasetVisible(index)) {
      tr.style.opacity = "0.4";
    }
    
    detailsTableBody.appendChild(tr);
  });
}

// Highlight and scroll to a specific details table row when a data point is clicked
function highlightDetailsTableRow(originalIndex) {
  const rowId = `details-row-${originalIndex}`;
  const row = document.getElementById(rowId);
  if (row) {
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("highlighted-row");
    setTimeout(() => {
      row.classList.remove("highlighted-row");
    }, 2000);
  }
}

// Update spec table opacity when toggle visibility is triggered
function updateDetailsTableOpacities() {
  const detailsTableBody = document.getElementById("detailsTableBody");
  if (!detailsTableBody) return;
  const rows = detailsTableBody.querySelectorAll("tr");
  rows.forEach((row, index) => {
    if (chartInstance) {
      row.style.opacity = chartInstance.isDatasetVisible(index) ? "1" : "0.4";
    }
  });
}

// Clear Chart when no selection is present
function clearChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  
  const legendContainer = document.getElementById("chartLegend");
  if (legendContainer) {
    legendContainer.innerHTML = "";
  }
  
  const groupLegend = document.getElementById("groupLegend");
  if (groupLegend) {
    groupLegend.innerHTML = "";
  }
  
  const groupLegendSection = document.getElementById("groupLegendSection");
  if (groupLegendSection) {
    groupLegendSection.style.display = "none";
  }
  
  const spectrumLegendSection = document.getElementById("spectrumLegendSection");
  if (spectrumLegendSection) {
    spectrumLegendSection.style.display = "none";
  }
  
  const legendCard = document.getElementById("legendCard");
  if (legendCard) {
    legendCard.style.display = "none";
  }
  
  if (colorModeCard) {
    colorModeCard.style.display = "none";
  }
  
  const curvesLegendSection = document.getElementById("curvesLegendSection");
  if (curvesLegendSection) {
    curvesLegendSection.style.display = "none";
  }
  
  const spectrumUnknownToggle = document.getElementById("spectrumUnknownToggle");
  if (spectrumUnknownToggle) {
    spectrumUnknownToggle.innerHTML = "";
  }
  
  const detailsCard = document.getElementById("detailsCard");
  if (detailsCard) {
    detailsCard.style.display = "none";
  }
}

// Event Listeners
engineSearch.addEventListener("input", () => {
  populateEngineSelect();
});

powerSelect.addEventListener("change", (e) => {
  const val = e.target.value;
  if (val) {
    addPowerSelection(val);
  }
  powerSelect.value = "";
});

configSelect.addEventListener("change", (e) => {
  const val = e.target.value;
  if (val) {
    addConfigSelection(val);
  }
  configSelect.value = "";
});

hullSelect.addEventListener("change", (e) => {
  const val = e.target.value;
  if (val) {
    addHullSelection(val);
  }
  hullSelect.value = "";
});

clearEnginesBtn.addEventListener("click", () => {
  activeEngineIds = [];
  renderSelectedEnginesList();
  populateEngineSelect();
  updateActiveEnginesSummary();
  updateSummaries();
  updateChart();
});

clearPowersBtn.addEventListener("click", () => {
  activePowers = [];
  renderSelectedPowersList();
  handleFilterChange();
});

clearConfigsBtn.addEventListener("click", () => {
  activeConfigs = [];
  renderSelectedConfigsList();
  handleFilterChange();
});

clearHullsBtn.addEventListener("click", () => {
  activeHulls = [];
  renderSelectedHullsList();
  handleFilterChange();
});

colorModeSelect.addEventListener("change", (e) => {
  selectedColorMode = e.target.value;
  updateChart();
});

engineSelect.addEventListener("change", (e) => {
  const val = e.target.value;
  if (val === "ADD_ALL") {
    const filtered = getCurrentlyFilteredEngines();
    addAllFilteredEngines(filtered);
  } else if (val) {
    addEngineSelection(val);
  }
  // Reset select element selection back to default instruction option
  engineSelect.value = "";
});

// Metric Tabs logic
Object.keys(metricButtons).forEach(metric => {
  const btn = metricButtons[metric];
  btn.addEventListener("click", () => {
    // Toggle active state in UI
    Object.values(metricButtons).forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    
    // Set metric and update chart
    selectedMetric = metric;
    updateChart();
  });
});

// Per Engine toggle
const perEngineToggle = document.getElementById("perEngineToggle");
if (perEngineToggle) {
  perEngineToggle.addEventListener("click", () => {
    perEngine = !perEngine;
    perEngineToggle.classList.toggle("active", perEngine);
    updateChart();
  });
}

// Update Metric Button Labels with active units
function updateMetricTabLabels() {
  const fuelBtn = document.getElementById("btnGph");
  if (fuelBtn) {
    fuelBtn.textContent = `Fuel (${getVolumeUnitLabel()}/h)`;
  }
  const econBtn = document.getElementById("btnMpg");
  if (econBtn) {
    econBtn.textContent = `Economy (${getEconomyUnitLabel()})`;
  }
  const speedBtn = document.getElementById("btnMph");
  if (speedBtn) {
    speedBtn.textContent = `Speed (${getSpeedUnitLabel()})`;
  }
}

// Bind Unit Selection tabs
function bindUnitTabs(containerId, updateCallback) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const buttons = container.querySelectorAll(".unit-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      updateCallback(btn.getAttribute("data-unit"));
    });
  });
}

bindUnitTabs("speedUnitTabs", (val) => {
  activeSpeedUnit = val;
  updateMetricTabLabels();
  updateChart();
});

bindUnitTabs("lengthUnitTabs", (val) => {
  activeLengthUnit = val;
  updateLengthSliderDisplay();
  updateChart();
});

bindUnitTabs("volumeUnitTabs", (val) => {
  activeVolumeUnit = val;
  updateMetricTabLabels();
  updateChart();
});

// Initial labels update
updateMetricTabLabels();



// Sidebar collapse toggle
const controlsSidebar = document.getElementById("controlsSidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const appContainer = document.querySelector(".app-container");

const SIDEBAR_OPEN_WIDTH = 320; // must match .controls-sidebar width in CSS

function updateTogglePosition(collapsed) {
  if (window.innerWidth > 800) {
    sidebarToggle.style.left = (collapsed ? 0 : SIDEBAR_OPEN_WIDTH) + "px";
    sidebarToggle.style.top = "";
  } else {
    sidebarToggle.style.left = "";
    sidebarToggle.style.top = "";
  }
}

// Set initial position
updateTogglePosition(false);

sidebarToggle.addEventListener("click", () => {
  const isNowCollapsed = controlsSidebar.classList.toggle("collapsed");
  appContainer.classList.toggle("sidebar-collapsed", isNowCollapsed);
  updateTogglePosition(isNowCollapsed);
});

// Update position on window resize to adapt to mobile or desktop
window.addEventListener("resize", () => {
  const isCollapsed = controlsSidebar.classList.contains("collapsed");
  updateTogglePosition(isCollapsed);
});

// Export functionality
async function exportToHtml() {
  if (!chartInstance || activeEngineIds.length === 0) {
    alert("No curves plotted to export.");
    return;
  }
  
  const details = getMetricDetails();
  
  const exportedDatasets = chartInstance.data.datasets.map(ds => {
    return {
      label: ds.label,
      data: ds.data.map(p => {
        let rawConverted = undefined;
        if (p.raw) {
          const mphVal = p.raw.mph !== undefined ? parseFloat(p.raw.mph) : null;
          const gphVal = p.raw.gph !== undefined ? parseFloat(p.raw.gph) : null;
          rawConverted = {
            speedStr: mphVal !== null ? `${convertSpeed(mphVal).toFixed(1)} ${getSpeedUnitLabel()}` : '-',
            fuelStr: gphVal !== null ? `${convertFuel(gphVal).toFixed(1)} ${getVolumeUnitLabel()}/h` : '-',
            econStr: (mphVal !== null && gphVal !== null) ? `${convertEconomy(mphVal, gphVal).toFixed(2)} ${getEconomyUnitLabel()}` : '-'
          };
        }
        return {
          x: p.x,
          y: p.y,
          rawConverted: rawConverted
        };
      }),
      borderColor: ds.borderColor,
      backgroundColor: ds.backgroundColor,
      borderWidth: ds.borderWidth,
      tension: ds.tension,
      pointRadius: ds.pointRadius,
      pointHoverRadius: ds.pointHoverRadius,
      fill: ds.fill
    };
  });

  const tableData = chartInstance.data.datasets.map(ds => {
    const record = ds.originalRecord;
    const color = ds.borderColor;
    const mfg = record.boat_manufacturer || "";
    const model = record.boat_model || "";
    const len = record.boat_length ? ` (${convertLengthStr(record.boat_length)})` : "";
    const engineSuffix = record.engine_name ? ` - ${record.engine_name}` : "";
    const boatName = `${mfg} ${model}${len}${engineSuffix}`.trim() || `Boat`;
    
    const configVal = getConfiguration(record);
    const configStr = configVal !== "Single" ? `${configVal} ` : "Single ";
    const engineStr = `${configStr}${record.engine_name || ""}`.trim();
    
    const propDesc = record.propeller_desc || (record.propeller_specs && record.propeller_specs.diameter_pitch) || "-";
    const weight = formatWeight(record.boat_specs);
    const testConditions = formatTestConditions(record.test_conditions);
    const pdfPath = record.pdf_url || record.local_file_path || null;
    const sourceUrl = record.pdf_url || null;
    
    return {
      color,
      boatName,
      engineStr,
      propDesc,
      weight,
      testConditions,
      pdfPath,
      sourceUrl
    };
  });

  const subtitle = chartTitle.textContent;

  // Show progress on the export button
  const exportBtn = document.getElementById("exportHtmlBtn");
  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.textContent = "Embedding PDFs…";
  }

  // Helper: fetch a file and return a base64 data URI (returns null on failure)
  async function fileToDataUri(path) {
    try {
      const resp = await fetch(path);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  // Fetch unique PDF paths and convert to base64 data URIs
  const uniquePaths = [...new Set(tableData.map(r => r.pdfPath).filter(Boolean))];
  Promise.all(uniquePaths.map(p => fileToDataUri(p).then(uri => [p, uri])))
    .then(entries => {
      const pdfDataUris = Object.fromEntries(entries.filter(([, uri]) => uri !== null));

      // Inject base64 data URIs into tableData
      const tableDataWithPdf = tableData.map(row => ({
        ...row,
        pdfDataUri: row.pdfPath ? (pdfDataUris[row.pdfPath] || null) : null
      }));

      const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Exported Outboard Performance Plot</title>
  <style>
    :root {
      --bg-primary: #121212;
      --bg-secondary: #1a1a1a;
      --text-primary: #f8fafc;
      --text-secondary: #a3a3a3;
      --accent-primary: #d4af37;
      --border-color: #2d2d2d;
    }
    body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 2rem;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    header {
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1rem;
    }
    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 1.75rem;
      font-weight: 600;
    }
    h1 span {
      color: var(--accent-primary);
    }
    .subtitle {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    .card {
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 0.5rem;
      padding: 1.5rem;
    }
    .chart-container {
      position: relative;
      height: 500px;
    }
    .table-container {
      width: 100%;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }
    th, td {
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--border-color);
      vertical-align: top;
    }
    th {
      color: var(--text-secondary);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.7rem;
      letter-spacing: 0.05em;
    }
    .color-badge {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      vertical-align: middle;
      margin-right: 0.5rem;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background-color: var(--bg-primary);
      border: 1px solid var(--border-color);
      padding: 0.4rem 0.75rem;
      border-radius: 0.375rem;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s;
    }
    .legend-item:hover {
      border-color: var(--accent-primary);
    }
    .legend-item.hidden {
      opacity: 0.4;
      text-decoration: line-through;
    }
    /* PDF embed styles */
    details.pdf-details {
      margin-top: 0.25rem;
    }
    details.pdf-details summary {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--accent-primary);
      background: none;
      border: 1px solid var(--accent-primary);
      border-radius: 0.3rem;
      padding: 0.25rem 0.6rem;
      user-select: none;
      transition: background 0.15s;
      list-style: none;
    }
    details.pdf-details summary::-webkit-details-marker { display: none; }
    details.pdf-details summary::marker { content: ""; }
    details.pdf-details summary:hover {
      background: rgba(212,175,55,0.12);
    }
    details.pdf-details[open] summary {
      margin-bottom: 0.6rem;
    }
    details.pdf-details embed {
      width: 100%;
      height: 600px;
      border: 1px solid var(--border-color);
      border-radius: 0.375rem;
      display: block;
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
</head>
<body>
  <div class="container">
    <header>
      <h1>Outboards <span>Performance Plot</span></h1>
      <div class="subtitle" id="subtitleText"></div>
    </header>
    
    <div class="card">
      <div class="chart-container">
        <canvas id="exportedChart"></canvas>
      </div>
      <div class="legend" id="exportedLegend"></div>
    </div>
    
    <div class="card">
      <h3 style="margin-top: 0; font-weight: 600;">Plotted Boat Details</h3>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Color</th>
              <th>Boat Model</th>
              <th>Engine</th>
              <th>Propeller</th>
              <th>Weight (lbs)</th>
              <th>Test Conditions</th>
              <th>Reference PDF</th>
            </tr>
          </thead>
          <tbody id="exportedTableBody"></tbody>
        </table>
      </div>
    </div>
  </div>
  
  <script>
    const datasets = ${JSON.stringify(exportedDatasets)};
    const tableData = ${JSON.stringify(tableDataWithPdf)};
    const metricDetails = ${JSON.stringify(details)};
    const subtitle = ${JSON.stringify(subtitle)};
    
    document.getElementById("subtitleText").textContent = subtitle;
    
    // Render Chart
    const ctx = document.getElementById("exportedChart").getContext("2d");
    const chart = new Chart(ctx, {
      type: 'line',
      data: { datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            title: { display: true, text: 'Engine RPM', color: '#94a3b8' },
            grid: { color: '#2d2d2d' },
            ticks: { color: '#94a3b8' }
          },
          y: {
            title: { display: true, text: metricDetails.label, color: '#94a3b8' },
            grid: { color: '#2d2d2d' },
            ticks: { color: '#94a3b8' }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1a1a',
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            borderColor: '#2d2d2d',
            borderWidth: 1,
            callbacks: {
              title: (context) => \`RPM: \${context[0].parsed.x}\`,
              label: (context) => {
                const pt = context.raw;
                let str = \`\${context.dataset.label}: \${context.parsed.y.toFixed(2)} \${metricDetails.unit}\`;
                if (pt.rawConverted) {
                  str += \` | Speed: \${pt.rawConverted.speedStr} | Fuel: \${pt.rawConverted.fuelStr} | Economy: \${pt.rawConverted.econStr}\`;
                }
                return str;
              }
            }
          }
        }
      }
    });
    
    // Render Legend
    const legendContainer = document.getElementById("exportedLegend");
    datasets.forEach((ds, idx) => {
      const item = document.createElement("div");
      item.className = "legend-item";
      
      const badge = document.createElement("span");
      badge.className = "color-badge";
      badge.style.backgroundColor = ds.borderColor;
      badge.style.boxShadow = \`0 0 4px \${ds.borderColor}\`;
      
      const label = document.createElement("span");
      label.textContent = ds.label;
      
      item.appendChild(badge);
      item.appendChild(label);
      
      item.addEventListener("click", () => {
        const visible = chart.isDatasetVisible(idx);
        if (visible) {
          chart.hide(idx);
          item.classList.add("hidden");
        } else {
          chart.show(idx);
          item.classList.remove("hidden");
        }
      });
      legendContainer.appendChild(item);
    });
    
    // Render Table
    const tbody = document.getElementById("exportedTableBody");
    tableData.forEach(row => {
      const tr = document.createElement("tr");
      
      const tdColor = document.createElement("td");
      tdColor.innerHTML = \`<span class="color-badge" style="background-color: \${row.color}; box-shadow: 0 0 6px \${row.color};"></span>\`;
      tr.appendChild(tdColor);
      
      const tdBoat = document.createElement("td");
      tdBoat.textContent = row.boatName;
      tdBoat.style.fontWeight = "500";
      tr.appendChild(tdBoat);
      
      const tdEngine = document.createElement("td");
      tdEngine.textContent = row.engineStr;
      tr.appendChild(tdEngine);
      
      const tdProp = document.createElement("td");
      tdProp.textContent = row.propDesc;
      tr.appendChild(tdProp);
      
      const tdWeight = document.createElement("td");
      tdWeight.textContent = row.weight;
      tr.appendChild(tdWeight);
      
      const tdCond = document.createElement("td");
      tdCond.textContent = row.testConditions;
      tr.appendChild(tdCond);
      
      const tdPdf = document.createElement("td");
      if (row.pdfDataUri) {
        const det = document.createElement("details");
        det.className = "pdf-details";
        const summary = document.createElement("summary");
        summary.innerHTML = \`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> View PDF\`;
        const embed = document.createElement("embed");
        embed.src = row.pdfDataUri;
        embed.type = "application/pdf";
        det.appendChild(summary);
        det.appendChild(embed);
        tdPdf.appendChild(det);
      } else if (row.sourceUrl) {
        const link = document.createElement("a");
        link.href = row.sourceUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.style.cssText = "color: #d4af37; font-size: 0.75rem; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem;";
        link.innerHTML = \`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Source PDF ↗\`;
        tdPdf.appendChild(link);
      } else {
        tdPdf.textContent = "-";
        tdPdf.style.color = "#a3a3a3";
      }
      tr.appendChild(tdPdf);
      
      tbody.appendChild(tr);
    });
  <\/script>
</body>
</html>`;

      const blob = new Blob([template], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Build descriptive filename from active filters + metric
      const sanitize = (str) => str.replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

      const filenameParts = [];

      // Engine(s)
      if (activeEngineIds.length === 1) {
        filenameParts.push(sanitize(activeEngineIds[0]));
      } else if (activeEngineIds.length > 1) {
        filenameParts.push(`${activeEngineIds.length}Engines`);
      }

      // Power filter
      if (activePowers.length > 0) {
        filenameParts.push(sanitize(activePowers.map(p => `${p}HP`).join('-')));
      }

      // Configuration filter
      if (activeConfigs.length > 0) {
        filenameParts.push(sanitize(activeConfigs.join('-')));
      }

      // Hull type filter
      if (activeHulls.length > 0) {
        filenameParts.push(sanitize(activeHulls.join('-')));
      }

      // Length range filter
      if (activeLengthMin !== null || activeLengthMax !== null) {
        const lo = activeLengthMin !== null ? Math.round(activeLengthMin) : lengthSliderAbsMin;
        const hi = activeLengthMax !== null ? Math.round(activeLengthMax) : lengthSliderAbsMax;
        const unit = activeLengthUnit === 'm' ? 'm' : 'ft';
        filenameParts.push(`${lo}-${hi}${unit}`);
      }

      // Metric
      filenameParts.push(selectedMetric.toUpperCase());

      const filename = (filenameParts.length > 0 ? filenameParts.join('__') : 'Outboard_Performance') + '.html';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(err => {
      console.error("PDF embedding failed:", err);
      alert("Failed to embed PDFs: " + err.message);
    })
    .finally(() => {
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.textContent = "Export HTML";
      }
    });
}

// Export graph data and legend to a structured JSON file
function exportToJson() {
  if (!chartInstance || activeEngineIds.length === 0) {
    alert("No curves plotted to export.");
    return;
  }

  const details = getMetricDetails();

  // Build legend: one entry per color group (or per series when mode is 'unique')
  const legendMap = {};
  chartInstance.data.datasets.forEach((ds) => {
    const record = ds.originalRecord;
    const groupKey = selectedColorMode === "unique" ? ds.label : (getRecordGroupKey(record) || ds.label);
    if (!legendMap[groupKey]) {
      legendMap[groupKey] = {
        label: groupKey,
        color: ds.borderColor
      };
    }
  });
  const legend = Object.values(legendMap);

  // Build series array — one object per plotted curve
  const series = chartInstance.data.datasets.map((ds) => {
    const record = ds.originalRecord;
    const groupKey = selectedColorMode === "unique" ? ds.label : (getRecordGroupKey(record) || ds.label);

    const points = ds.data.map((pt) => {
      const entry = { rpm: pt.x, value: pt.y };
      if (pt.raw) {
        const mphVal = pt.raw.mph !== undefined ? parseFloat(pt.raw.mph) : null;
        const gphVal = pt.raw.gph !== undefined ? parseFloat(pt.raw.gph) : null;
        if (mphVal !== null) entry.speed_mph_raw = mphVal;
        if (gphVal !== null) entry.fuel_gph_raw = gphVal;
      }
      return entry;
    });

    return {
      label: ds.label,
      color: ds.borderColor,
      legend_group: groupKey,
      boat_manufacturer: record.boat_manufacturer || null,
      boat_model: record.boat_model || null,
      boat_length: record.boat_length || null,
      engine_name: record.engine_name || null,
      engine_config: getConfiguration(record),
      propeller: record.propeller_desc || (record.propeller_specs && record.propeller_specs.diameter_pitch) || null,
      weight_lbs: parseWeightToLbs(record.boat_specs),
      source_pdf: record.pdf_url || record.local_file_path || null,
      data: points
    };
  });

  // Active filters summary
  const filters = {
    engines: activeEngineIds.slice(),
    power_hp: activePowers.slice(),
    configurations: activeConfigs.slice(),
    hull_types: activeHulls.slice(),
    length_min_ft: activeLengthMin,
    length_max_ft: activeLengthMax
  };

  const output = {
    exported_at: new Date().toISOString(),
    chart_title: chartTitle.textContent,
    metric: selectedMetric,
    metric_label: details.label,
    metric_unit: details.unit,
    speed_unit: activeSpeedUnit,
    volume_unit: activeVolumeUnit,
    length_unit: activeLengthUnit,
    color_mode: selectedColorMode,
    per_engine: perEngine,
    filters,
    legend,
    series
  };

  const json = JSON.stringify(output, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  const sanitize = (str) => str.replace(/[^a-zA-Z0-9\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const filenameParts = [];
  if (activeEngineIds.length === 1) filenameParts.push(sanitize(activeEngineIds[0]));
  else if (activeEngineIds.length > 1) filenameParts.push(`${activeEngineIds.length}Engines`);
  if (activePowers.length > 0) filenameParts.push(sanitize(activePowers.map(p => `${p}HP`).join('-')));
  if (activeConfigs.length > 0) filenameParts.push(sanitize(activeConfigs.join('-')));
  if (activeHulls.length > 0) filenameParts.push(sanitize(activeHulls.join('-')));
  if (activeLengthMin !== null || activeLengthMax !== null) {
    const lo = activeLengthMin !== null ? Math.round(activeLengthMin) : lengthSliderAbsMin;
    const hi = activeLengthMax !== null ? Math.round(activeLengthMax) : lengthSliderAbsMax;
    const unit = activeLengthUnit === 'm' ? 'm' : 'ft';
    filenameParts.push(`${lo}-${hi}${unit}`);
  }
  filenameParts.push(selectedMetric.toUpperCase());

  a.download = (filenameParts.length > 0 ? filenameParts.join('__') : 'Outboard_Performance') + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

exportPdfBtn.addEventListener("click", () => {
  if (!chartInstance || activeEngineIds.length === 0) {
    alert("No curves plotted to export.");
    return;
  }
  window.print();
});

exportHtmlBtn.addEventListener("click", exportToHtml);

if (exportJsonBtn) exportJsonBtn.addEventListener("click", exportToJson);

const resetZoomBtn = document.getElementById("resetZoomBtn");
if (resetZoomBtn) {
  resetZoomBtn.addEventListener("click", () => {
    if (chartInstance) {
      chartInstance.resetZoom();
    }
  });
}

// Help Modal Interactivity
const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const closeHelpBtn = document.getElementById("closeHelpBtn");

function openHelpModal() {
  if (helpModal) {
    helpModal.classList.add("active");
    helpModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden"; // Prevent background scrolling
    if (closeHelpBtn) closeHelpBtn.focus();
  }
}

function closeHelpModal() {
  if (helpModal) {
    helpModal.classList.remove("active");
    helpModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = ""; // Re-enable background scrolling
    if (helpBtn) helpBtn.focus();
  }
}

if (helpBtn) {
  helpBtn.addEventListener("click", openHelpModal);
}

if (closeHelpBtn) {
  closeHelpBtn.addEventListener("click", closeHelpModal);
}

if (helpModal) {
  // Close when clicking on the backdrop overlay
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) {
      closeHelpModal();
    }
  });
}

// Close when pressing Escape key
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && helpModal && helpModal.classList.contains("active")) {
    closeHelpModal();
  }
});

// Initialize on load
loadData();
