
"use strict";

// Step 03: image metadata is extracted by the FastAPI endpoint.
// This frontend still previews layout only. Rendering/export and accurate
// West Bengal Panjika conversion remain intentionally pending.

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTHS_BN_GREGORIAN = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

// NEW: Browser console logging
const DEBUG_PREFIX = "[BengaliWatermark]";

const logger = {
  info: (...args) => console.info(DEBUG_PREFIX, ...args),
  debug: (...args) => console.debug(DEBUG_PREFIX, ...args),
  warn: (...args) => console.warn(DEBUG_PREFIX, ...args),
  error: (...args) => console.error(DEBUG_PREFIX, ...args),
};

const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i;

const elements = {
  dropZone: document.querySelector("#dropZone"),
  photoInput: document.querySelector("#photoInput"),
  fileSummary: document.querySelector("#fileSummary"),
  fileName: document.querySelector("#fileName"),
  fileDetails: document.querySelector("#fileDetails"),
  removePhoto: document.querySelector("#removePhoto"),
  uploadMessage: document.querySelector("#uploadMessage"),
  metadataPanel: document.querySelector("#metadataPanel"),
  metadataStatus: document.querySelector("#metadataStatus"),
  metadataDetails: document.querySelector("#metadataDetails"),
  metadataWarnings: document.querySelector("#metadataWarnings"),
  dateHelp: document.querySelector("#dateHelp"),
  dateTime: document.querySelector("#photoDateTime"),
  boldDate: document.querySelector("#boldDate"),
  calendarHint: document.querySelector("#calendarHint"),
  formattedDate: document.querySelector("#formattedDate"),
  panjikaNotice: document.querySelector("#panjikaNotice"),
  signatureStatus: document.querySelector("#signatureStatus"),
  emptyPreview: document.querySelector("#emptyPreview"),
  photoFrame: document.querySelector("#photoFrame"),
  photoPreview: document.querySelector("#photoPreview"),
  watermark: document.querySelector("#watermark"),
  watermarkDate: document.querySelector("#watermarkDate"),
  signaturePreview: document.querySelector("#signaturePreview"),
};

let currentObjectUrl = null;
let signatureRequest = 0;
let metadataRequest = 0;
let metadataAbort = null;
let metadataPending = false;
let manualDateEdited = false;


// --------------------------------------------------
// Bengali digit conversion
// --------------------------------------------------

function toBengaliDigits(value) {
  return String(value).replace(
    /[0-9]/g,
    (digit) => BN_DIGITS[Number(digit)]
  );
}

function pad2(number) {
  return String(number).padStart(2, "0");
}


// --------------------------------------------------
// Radio button helpers
// --------------------------------------------------

function getSelected(name) {
  return document.querySelector(
    `input[name="${name}"]:checked`
  )?.value;
}

function setSelected(name, value) {
  const input = document.querySelector(
    `input[name="${name}"][value="${value}"]`
  );

  if (input) {
    input.checked = true;
  }
}

elements.boldDate.addEventListener("change", () => {
  elements.watermarkDate.classList.toggle(
    "is-bold",
    elements.boldDate.checked
  );
});

// --------------------------------------------------
// Date and time helpers
// --------------------------------------------------

// Construct a local datetime-local value
// without converting the time to UTC.

function localDateTimeValue(date) {
  return (
    `${date.getFullYear()}-` +
    `${pad2(date.getMonth() + 1)}-` +
    `${pad2(date.getDate())}T` +
    `${pad2(date.getHours())}:` +
    `${pad2(date.getMinutes())}`
  );
}

function getPreviewDate() {
  const value = elements.dateTime.value;

  if (!value) {
    return null;
  }

  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);

  if (!parts) {
    return null;
  }

  const [, year, month, day, hour, minute] = parts.map(Number);

  const parsed = new Date(
    year,
    month - 1,
    day,
    hour,
    minute
  );

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }

  return parsed;
}


// --------------------------------------------------
// Bengali time period
// --------------------------------------------------

function bengaliDayPeriod(hour) {
  if (hour >= 4 && hour < 6) {
    return "ভোর";
  }

  if (hour >= 6 && hour < 12) {
    return "সকাল";
  }

  if (hour >= 12 && hour < 15) {
    return "দুপুর";
  }

  if (hour >= 15 && hour < 18) {
    return "বিকেল";
  }

  if (hour >= 18 && hour < 20) {
    return "সন্ধ্যা";
  }

  return "রাত";
}


// --------------------------------------------------
// Date formatting
// --------------------------------------------------

function formatDate(date, language, calendar) {
  if (!date) {
    return "Select a valid preview date and time";
  }

  const h12 = date.getHours() % 12 || 12;

  // English Gregorian calendar
  if (language === "en") {
    const amPm = date.getHours() < 12 ? "AM" : "PM";

    return (
      `${MONTHS_EN[date.getMonth()]} ` +
      `${pad2(date.getDate())}, ` +
      `${date.getFullYear()} · ` +
      `${h12}:${pad2(date.getMinutes())} ${amPm}`
    );
  }

  // Traditional West Bengal Panjika
  // Accurate conversion will be implemented in Step 04.
  if (calendar === "panjika") {
    return (
      `পঞ্জিকা তারিখ ধাপ ৪-এ যুক্ত হবে · ` +
      `${bengaliDayPeriod(date.getHours())} ` +
      `${toBengaliDigits(h12)}:` +
      `${toBengaliDigits(pad2(date.getMinutes()))}`
    );
  }

  // Bengali language with Gregorian date
  // Time uses the 24-hour format.

  return (
    `${toBengaliDigits(date.getDate())} ` +
    `${MONTHS_BN_GREGORIAN[date.getMonth()]}, ` +
    `${toBengaliDigits(date.getFullYear())} · ` +
    `${toBengaliDigits(pad2(date.getHours()))}:` +
    `${toBengaliDigits(pad2(date.getMinutes()))}`
  );
}


// --------------------------------------------------
// Language and calendar controls
// --------------------------------------------------

function updateControls() {
  const language = getSelected("language");

  const panjikaInput = document.querySelector(
    'input[name="calendar"][value="panjika"]'
  );

  const bengali = language === "bn";

  panjikaInput.disabled = !bengali;

  if (!bengali) {
    setSelected("calendar", "gregorian");
  }

  elements.calendarHint.textContent = bengali
    ? "West Bengal / Indian traditional Panjika (not Bangladesh)."
    : "Switch to বাংলা to select the traditional Bengali calendar.";

  elements.panjikaNotice.hidden = !(
    bengali &&
    getSelected("calendar") === "panjika"
  );

  updateDatePreview();
}


// --------------------------------------------------
// Live date preview
// --------------------------------------------------

function updateDatePreview() {
  const value = formatDate(
    getPreviewDate(),
    getSelected("language"),
    getSelected("calendar")
  );

  elements.formattedDate.textContent = value;
  elements.watermarkDate.textContent = value;

  const isBn = getSelected("language") === "bn";

  elements.formattedDate.lang = isBn ? "bn" : "en";
  elements.watermarkDate.lang = isBn ? "bn" : "en";
}


// --------------------------------------------------
// Signature preview
// --------------------------------------------------

// Extract signature color and remove transparent padding.
// Original PNG files are never modified.

function analyzeSignature(image) {
  const canvas = document.createElement("canvas");

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  if (!ctx) {
    return { croppedUrl: image.src, color: null };
  }

  ctx.drawImage(image, 0, 0);

  const { data } = ctx.getImageData(
    0, 0, canvas.width, canvas.height
  );

  let left = canvas.width;
  let top = canvas.height;
  let right = -1;
  let bottom = -1;

  const red = new Float64Array(256);
  const green = new Float64Array(256);
  const blue = new Float64Array(256);

  let total = 0;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const at = 4 * (y * canvas.width + x);
      const alpha = data[at + 3];

      if (alpha >= 32) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }

      if (alpha >= 96) {
        red[data[at]] += alpha;
        green[data[at + 1]] += alpha;
        blue[data[at + 2]] += alpha;
        total += alpha;
      }
    }
  }

  if (right < left || bottom < top) {
    logger.warn("Signature has no visible pixels");
    return { croppedUrl: image.src, color: null };
  }

  function weightedMedian(histogram) {
    let running = 0;

    for (let i = 0; i < 256; i++) {
      running += histogram[i];

      if (running >= total / 2) {
        return i;
      }
    }

    return 0;
  }

  const color = total > 0
    ? `rgb(${weightedMedian(red)}, ${weightedMedian(green)}, ${weightedMedian(blue)})`
    : null;

  const pad = Math.max(
    3,
    Math.ceil(Math.min(canvas.width, canvas.height) * 0.01)
  );

  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(canvas.width - 1, right + pad);
  bottom = Math.min(canvas.height - 1, bottom + pad);

  const width = right - left + 1;
  const height = bottom - top + 1;

  const cropped = document.createElement("canvas");
  cropped.width = width;
  cropped.height = height;

  cropped.getContext("2d").drawImage(
    canvas,
    left, top, width, height,
    0, 0, width, height
  );

  logger.debug("Signature analyzed", {
    source: `${canvas.width}x${canvas.height}`,
    cropped: `${width}x${height}`,
    ink: color
  });

  return {
    croppedUrl: cropped.toDataURL("image/png"),
    color
  };
}

function updateSignature() {
  const choice = getSelected("signature") || "light";
  const file = `signature_${choice}.png`;
  const request = ++signatureRequest;
  const image = elements.signaturePreview;

  elements.watermark.classList.toggle(
    "watermark-light", choice === "light"
  );

  elements.watermark.classList.toggle(
    "watermark-dark", choice === "dark"
  );

  elements.watermark.style.removeProperty(
    "--signature-text-color"
  );

  image.hidden = true;
  image.removeAttribute("src");

  elements.signatureStatus.textContent = `Loading ${file}…`;

  logger.info("Signature selected", { style: choice });

  const source = new Image();

  source.onload = () => {
    if (request !== signatureRequest) return;

    let appearance;

    try {
      appearance = analyzeSignature(source);
    } catch (error) {
      logger.warn("Signature analysis failed", error);

      appearance = {
        croppedUrl: source.src,
        color: null
      };
    }

    if (appearance.color) {
      elements.watermark.style.setProperty(
        "--signature-text-color",
        appearance.color
      );
    }

    image.onload = () => {
      if (request !== signatureRequest) return;

      image.hidden = false;

      elements.signatureStatus.textContent =
        `Loaded ${file}; date color matched to signature ink.`;

      logger.info("Signature ready", {
        file,
        ink: appearance.color
      });
    };

    image.onerror = () => {
      if (request !== signatureRequest) return;

      image.hidden = true;
      elements.signatureStatus.textContent =
        `Could not display ${file}.`;

      logger.error("Signature preview failed", { file });
    };

    image.src = appearance.croppedUrl;
  };

  source.onerror = () => {
    if (request !== signatureRequest) return;

    image.hidden = true;

    elements.signatureStatus.textContent =
      `Missing ${file} in app/static/images/.`;

    logger.warn("Signature asset missing", { file });
  };

  source.src = `../static/images/${file}`;
}


// --------------------------------------------------
// Human-readable file size
// --------------------------------------------------

function humanSize(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}


// --------------------------------------------------
// Metadata request management
// --------------------------------------------------

function resetMetadataRequest() {
  ++metadataRequest;

  if (metadataAbort) {
    metadataAbort.abort();
  }

  metadataAbort = null;
  metadataPending = false;
}


// --------------------------------------------------
// Metadata status messages
// --------------------------------------------------

function metadataNotice(
  title,
  details = "",
  warnings = "",
  isError = false
) {
  elements.metadataPanel.hidden = false;

  elements.metadataPanel.classList.toggle(
    "is-error",
    isError
  );

  elements.metadataStatus.textContent = title;
  elements.metadataDetails.textContent = details;
  elements.metadataWarnings.textContent = warnings;
}


// --------------------------------------------------
// Extract image metadata using FastAPI
// --------------------------------------------------

async function readPhotoMetadata(file) {
  const requestId = metadataRequest;

  const controller = new AbortController();

  metadataAbort = controller;
  metadataPending = true;

  const payload = new FormData();

  payload.append("file", file, file.name);

  try {
    const response = await fetch(
      "/api/image/metadata",
      {
        method: "POST",
        body: payload,
        signal: controller.signal,
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error(
        "Metadata service returned an invalid response."
      );
    }

    if (!response.ok) {
      throw new Error(
        data.detail ||
        `Metadata request failed (${response.status}).`
      );
    }

    // NEW: Log successful metadata response
    logger.info("Metadata response", {
      status: response.status,
      hasTimestamp: Boolean(data.captured_at),
      dateSource: data.date_source || null
    });

    // Ignore responses belonging to old uploads.
    if (requestId !== metadataRequest) {
      return;
    }

    // Automatically populate capture date.
    if (data.captured_at) {
      if (!manualDateEdited) {
        elements.dateTime.value = data.captured_at;
      }

      elements.dateHelp.textContent = manualDateEdited
        ? `EXIF ${data.date_source} detected. Your manually entered date/time was kept.`
        : `Using EXIF ${data.date_source}. The camera's recorded time is not converted to the server timezone. You can edit it.`;
    } else {
      if (!manualDateEdited) {
        elements.dateTime.value = "";
      }

      elements.dateHelp.textContent =
        "No reliable photo date found. Please enter its date/time manually; we won't use today's date automatically.";
    }

    updateDatePreview();

    // GPS details, if available.
    const gps = data.gps
      ? (
          ` · GPS: ` +
          `${Number(data.gps.latitude).toFixed(6)}, ` +
          `${Number(data.gps.longitude).toFixed(6)}`
        )
      : " · No GPS coordinates";

    // EXIF timezone, if available.
    const offset = data.timezone_offset
      ? ` · UTC${data.timezone_offset}`
      : " · Camera timezone unknown";

    const details =
      `${data.image_format} · ` +
      `${data.display_width} × ${data.display_height} · ` +
      `Orientation ${data.orientation}` +
      gps +
      offset;

    metadataNotice(
      data.captured_at
        ? `EXIF ${data.date_source} found`
        : "No capture date in metadata",
      details,
      (data.warnings || []).join(" ")
    );

  } catch (error) {
    if (
      controller.signal.aborted ||
      requestId !== metadataRequest
    ) {
      return;
    }

    if (!manualDateEdited) {
      elements.dateTime.value = "";
    }

    updateDatePreview();

    elements.dateHelp.textContent =
      "Automatic detection is unavailable. You can still enter the photo date/time manually.";

    // NEW: Log errors to Chrome DevTools
    logger.error("Metadata request failed", error);

    metadataNotice(
      "Metadata could not be read",
      "Manual date/time entry is available.",
      error.message || "Check the API server.",
      true
    );

  } finally {
    if (requestId === metadataRequest) {
      metadataAbort = null;
      metadataPending = false;
    }
  }
}


// --------------------------------------------------
// Clear uploaded photo
// --------------------------------------------------

function clearPhoto() {
  resetMetadataRequest();

  manualDateEdited = false;

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }

  currentObjectUrl = null;

  elements.photoPreview.removeAttribute("src");
  elements.photoInput.value = "";

  elements.photoFrame.hidden = true;
  elements.emptyPreview.hidden = false;
  elements.fileSummary.hidden = true;
  elements.metadataPanel.hidden = true;

  elements.uploadMessage.textContent = "";

  elements.dateTime.value = localDateTimeValue(
    new Date()
  );

  elements.dateHelp.textContent =
    "Choose a photograph to detect its capture time from EXIF. You can always edit this field.";

  updateDatePreview();
}


// --------------------------------------------------
// Load and validate selected photo
// --------------------------------------------------

function loadPhoto(file) {
  if (!file) {
    logger.info("File picker closed without selection");
    return;
  }

  // NEW: Log selected image details
  logger.info("Image selected", {
    name: file.name,
    type: file.type,
    bytes: file.size
  });

  const supportedType = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ].includes(file.type);

  if (
    !supportedType &&
    !SUPPORTED_EXTENSIONS.test(file.name)
  ) {
    elements.uploadMessage.textContent =
      "Choose a JPEG, PNG, WebP, HEIC, or HEIF image.";

    return;
  }

  if (file.size === 0) {
    elements.uploadMessage.textContent =
      "This file is empty. Choose another image.";

    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    elements.uploadMessage.textContent =
      "Maximum photo size is 50 MB.";

    return;
  }

  // Clear the previously selected photo.
  clearPhoto();

  elements.dateTime.value = "";

  elements.dateHelp.textContent =
    "Reading the original image metadata…";

  updateDatePreview();

  metadataNotice(
    "Reading EXIF metadata…",
    "The image is checked on the server and is not saved to the gallery or a database."
  );

  elements.fileName.textContent = file.name;
  elements.fileDetails.textContent = humanSize(file.size);
  elements.fileSummary.hidden = false;

  const nextUrl = URL.createObjectURL(file);

  currentObjectUrl = nextUrl;

  // Browser image preview.
  elements.photoPreview.onload = () => {
    if (currentObjectUrl !== nextUrl) {
      return;
    }

    elements.fileDetails.textContent =
      `${humanSize(file.size)} · ` +
      `${elements.photoPreview.naturalWidth} × ` +
      `${elements.photoPreview.naturalHeight}`;

    elements.photoFrame.hidden = false;
    elements.emptyPreview.hidden = true;

    // NEW: Confirm that the image rendered
    logger.info("Photo preview loaded", {
      width: elements.photoPreview.naturalWidth,
      height: elements.photoPreview.naturalHeight
    });
  };

  elements.photoPreview.onerror = () => {
    if (currentObjectUrl !== nextUrl) {
      return;
    }

    elements.photoFrame.hidden = true;
    elements.emptyPreview.hidden = false;

    elements.uploadMessage.textContent =
      "Browser preview unavailable for this format. EXIF metadata can still be extracted; HEIC preview conversion comes in a later step.";

    // NEW: Capture browser decoding failures
    logger.error("Browser image preview failed", {
      name: file.name,
      type: file.type
    });
  };

  elements.photoPreview.src = nextUrl;

  // Request original capture metadata.
  void readPhotoMetadata(file);
}


// --------------------------------------------------
// Drag and drop event handling
// --------------------------------------------------

// Prevent the browser from opening dropped image files.

window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types?.includes("Files")) {
    event.preventDefault();
  }
});

window.addEventListener("drop", (event) => {
  if (event.dataTransfer?.types?.includes("Files")) {
    event.preventDefault();
  }
});

for (const type of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(type, (event) => {
    event.preventDefault();

    elements.dropZone.classList.add("drag-active");
  });
}

for (const type of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(type, (event) => {
    event.preventDefault();

    elements.dropZone.classList.remove("drag-active");
  });
}

elements.dropZone.addEventListener("drop", (event) => {
  const files = Array.from(
    event.dataTransfer?.files ?? []
  );

  if (files.length) {
    loadPhoto(files[0]);
  }
});


// --------------------------------------------------
// Click-to-upload support
// --------------------------------------------------

elements.dropZone.addEventListener("click", (event) => {
  // Ignore clicks from the actual file input.
  if (event.target === elements.photoInput) return;

  logger.info("Opening file chooser");
  elements.photoInput.click();
});

elements.dropZone.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" ||
    event.key === " "
  ) {
    event.preventDefault();
    elements.photoInput.click();
  }
});

elements.photoInput.addEventListener("change", () => {
  loadPhoto(elements.photoInput.files?.[0]);
});


// --------------------------------------------------
// Remove photo
// --------------------------------------------------

elements.removePhoto.addEventListener(
  "click",
  clearPhoto
);


// --------------------------------------------------
// Manual date/time editing
// --------------------------------------------------

elements.dateTime.addEventListener("input", () => {
  if (metadataPending) {
    manualDateEdited = true;
  }

  updateDatePreview();
});


// --------------------------------------------------
// Language and calendar toggle events
// --------------------------------------------------

for (
  const input of document.querySelectorAll(
    'input[name="language"], input[name="calendar"]'
  )
) {
  input.addEventListener(
    "change",
    updateControls
  );
}


// --------------------------------------------------
// Signature toggle events
// --------------------------------------------------

for (
  const input of document.querySelectorAll(
    'input[name="signature"]'
  )
) {
  input.addEventListener(
    "change",
    updateSignature
  );
}


// --------------------------------------------------
// Release temporary browser object URL
// --------------------------------------------------

window.addEventListener("pagehide", () => {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
});


// --------------------------------------------------
// Initialize application
// --------------------------------------------------

elements.dateTime.value = localDateTimeValue(
  new Date()
);

updateControls();
updateSignature();
