"use strict";

// Step 02: client-side UI/layout preview only. No EXIF extraction, Panjika
// conversion, server upload, image rendering/export, or OCR happens here.
// The backend modules introduced in subsequent steps will supply those features.

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_BN_GREGORIAN = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i;

const elements = {
  dropZone: document.querySelector("#dropZone"),
  photoInput: document.querySelector("#photoInput"),
  fileSummary: document.querySelector("#fileSummary"),
  fileName: document.querySelector("#fileName"),
  fileDetails: document.querySelector("#fileDetails"),
  removePhoto: document.querySelector("#removePhoto"),
  uploadMessage: document.querySelector("#uploadMessage"),
  dateTime: document.querySelector("#photoDateTime"),
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

function toBengaliDigits(value) {
  return String(value).replace(/[0-9]/g, (digit) => BN_DIGITS[Number(digit)]);
}

function pad2(number) {
  return String(number).padStart(2, "0");
}

function getSelected(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function setSelected(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

// Construct a local datetime-local value without UTC conversion.
function localDateTimeValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function getPreviewDate() {
  const value = elements.dateTime.value;
  if (!value) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute] = parts.map(Number);
  const parsed = new Date(year, month - 1, day, hour, minute);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day || parsed.getHours() !== hour ||
      parsed.getMinutes() !== minute) return null;
  return parsed;
}

function bengaliDayPeriod(hour) {
  if (hour >= 4 && hour < 6) return "ভোর";
  if (hour >= 6 && hour < 12) return "সকাল";
  if (hour >= 12 && hour < 15) return "দুপুর";
  if (hour >= 15 && hour < 18) return "বিকেল";
  if (hour >= 18 && hour < 20) return "সন্ধ্যা";
  return "রাত";
}

function formatDate(date, language, calendar) {
  if (!date) return "Select a valid preview date and time";

  const h12 = date.getHours() % 12 || 12;
  if (language === "en") {
    const amPm = date.getHours() < 12 ? "AM" : "PM";
    return `${MONTHS_EN[date.getMonth()]} ${pad2(date.getDate())}, ${date.getFullYear()} · ${h12}:${pad2(date.getMinutes())} ${amPm}`;
  }

  if (calendar === "panjika") {
    // Never misrepresent an unverified Bangladesh or approximate date as
    // the West Bengal traditional Panjika date.
    return `পঞ্জিকা তারিখ ধাপ ৪-এ যুক্ত হবে · ${bengaliDayPeriod(date.getHours())} ${toBengaliDigits(h12)}:${toBengaliDigits(pad2(date.getMinutes()))}`;
  }

  return `${toBengaliDigits(date.getDate())} ${MONTHS_BN_GREGORIAN[date.getMonth()]}, ${toBengaliDigits(date.getFullYear())} · ${toBengaliDigits(pad2(date.getHours()))}:${toBengaliDigits(pad2(date.getMinutes()))}`;
}

function updateControls() {
  const language = getSelected("language");
  const panjikaInput = document.querySelector('input[name="calendar"][value="panjika"]');
  const bengali = language === "bn";
  panjikaInput.disabled = !bengali;
  if (!bengali) setSelected("calendar", "gregorian");
  elements.calendarHint.textContent = bengali
    ? "West Bengal / Indian traditional Panjika (not Bangladesh)."
    : "Switch to বাংলা to select the traditional Bengali calendar.";
  elements.panjikaNotice.hidden = !(bengali && getSelected("calendar") === "panjika");
  updateDatePreview();
}

function updateDatePreview() {
  const value = formatDate(getPreviewDate(), getSelected("language"), getSelected("calendar"));
  elements.formattedDate.textContent = value;
  elements.watermarkDate.textContent = value;
  const isBn = getSelected("language") === "bn";
  elements.formattedDate.lang = isBn ? "bn" : "en";
  elements.watermarkDate.lang = isBn ? "bn" : "en";
}

function updateSignature() {
  const choice = getSelected("signature");
  const file = `signature_${choice}.png`;
  const image = elements.signaturePreview;
  const request = ++signatureRequest;
  elements.watermark.classList.toggle("watermark-light", choice === "light");
  elements.watermark.classList.toggle("watermark-dark", choice === "dark");
  image.hidden = true;
  elements.signatureStatus.textContent = `Looking for app/static/images/${file}…`;
  image.onload = () => {
    if (request !== signatureRequest) return;
    image.hidden = false;
    elements.signatureStatus.textContent = `Loaded ${file}. The original transparent PNG is used.`;
  };
  image.onerror = () => {
    if (request !== signatureRequest) return;
    image.hidden = true;
    elements.signatureStatus.textContent = `Add your ${file} to app/static/images/ to display it in the preview.`;
  };
  // Resolves correctly from app/templates/index.html locally or served at /.
  image.src = `../static/images/${file}`;
}

function humanSize(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function clearPhoto() {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
  elements.photoPreview.removeAttribute("src");
  elements.photoInput.value = "";
  elements.photoFrame.hidden = true;
  elements.emptyPreview.hidden = false;
  elements.fileSummary.hidden = true;
  elements.uploadMessage.textContent = "";
}

function loadPhoto(file) {
  if (!file) return;
  const supportedType = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.type);
  if (!supportedType && !SUPPORTED_EXTENSIONS.test(file.name)) {
    elements.uploadMessage.textContent = "Choose a JPEG, PNG, WebP, HEIC, or HEIF image.";
    return;
  }
  if (file.size === 0) {
    elements.uploadMessage.textContent = "This file is empty. Choose another image.";
    return;
  }
  clearPhoto();
  elements.fileName.textContent = file.name;
  elements.fileDetails.textContent = humanSize(file.size);
  elements.fileSummary.hidden = false;
  const nextUrl = URL.createObjectURL(file);
  currentObjectUrl = nextUrl;

  elements.photoPreview.onload = () => {
    if (currentObjectUrl !== nextUrl) return;
    elements.fileDetails.textContent = `${humanSize(file.size)} · ${elements.photoPreview.naturalWidth} × ${elements.photoPreview.naturalHeight}`;
    elements.photoFrame.hidden = false;
    elements.emptyPreview.hidden = true;
  };
  elements.photoPreview.onerror = () => {
    if (currentObjectUrl !== nextUrl) return;
    elements.photoFrame.hidden = true;
    elements.emptyPreview.hidden = false;
    elements.uploadMessage.textContent = "This browser couldn't display the selected image. HEIC/HEIF conversion will be handled by the backend in a later step; try JPEG or PNG for now.";
  };
  elements.photoPreview.src = nextUrl;
}

// Prevent the browser from navigating away if a photo is dropped outside the box.
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
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
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) loadPhoto(files[0]);
});
elements.dropZone.addEventListener("click", () => elements.photoInput.click());
elements.dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.photoInput.click();
  }
});
elements.photoInput.addEventListener("change", () => loadPhoto(elements.photoInput.files?.[0]));
elements.removePhoto.addEventListener("click", clearPhoto);
elements.dateTime.addEventListener("input", updateDatePreview);
for (const input of document.querySelectorAll('input[name="language"], input[name="calendar"]')) {
  input.addEventListener("change", updateControls);
}
for (const input of document.querySelectorAll('input[name="signature"]')) {
  input.addEventListener("change", updateSignature);
}
window.addEventListener("pagehide", () => {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
});

elements.dateTime.value = localDateTimeValue(new Date());
updateControls();
updateSignature();
