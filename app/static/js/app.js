
"use strict";

// Bengali Watermark Studio — Step 4.
// Compatible with Step 4 HTML, CSS, and FastAPI endpoints.
// Final image download will be connected in Step 5.

(() => {
  const LOG = "[BengaliWatermark]";

  const log = {
    info: (...args) => console.info(LOG, ...args),
    warn: (...args) => console.warn(LOG, ...args),
    error: (...args) => console.error(LOG, ...args),
  };

  const EN_MONTHS = [
    "January", "February", "March", "April",
    "May", "June", "July", "August",
    "September", "October", "November", "December",
  ];

  const BN_MONTHS = [
    "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল",
    "মে", "জুন", "জুলাই", "আগস্ট",
    "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
  ];

  const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
  const MAX_BYTES = 50 * 1024 * 1024;
  const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i;

  const IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ]);

  // ---------------------------------------------
  // DOM ELEMENTS
  // ---------------------------------------------

  const ids = [
    "dropZone",
    "photoInput",
    "fileSummary",
    "fileName",
    "fileDetails",
    "removePhoto",
    "uploadMessage",
    "metadataPanel",
    "metadataStatus",
    "metadataDetails",
    "metadataWarnings",
    "dateHelp",
    "photoDateTime",
    "boldDate",
    "calendarHint",
    "formattedDate",
    "panjikaNotice",
    "signatureStatus",
    "emptyPreview",
    "photoFrame",
    "photoPreview",
    "watermark",
    "watermarkDate",
    "signaturePreview",
    "downloadButton",
    "downloadLabel",
    "downloadStatus",
  ];

  const ui = Object.fromEntries(
    ids.map(id => [id, document.getElementById(id)])
  );

  const missing = ids.filter(id => !ui[id]);

  if (missing.length) {
    log.error(
      "Missing HTML element IDs:",
      missing.join(", ")
    );
    return;
  }

  // ---------------------------------------------
  // APPLICATION STATE
  // ---------------------------------------------

  let photoUrl = null;
  let photoFile = null;

  let uploadId = 0;
  let metadataController = null;
  let metadataPending = false;
  let manualDateEdited = false;

  let signatureId = 0;
  let dateId = 0;
  let dateController = null;

  let exporting = false;
  let dateReady = false;

  // ---------------------------------------------
  // GENERAL HELPERS
  // ---------------------------------------------

  const bn = value =>
    String(value).replace(
      /\d/g,
      digit => BN_DIGITS[Number(digit)]
    );

  const pad = value =>
    String(value).padStart(2, "0");

  const choice = name =>
    document.querySelector(
      `input[name="${name}"]:checked`
    )?.value;

  // ---------------------------------------------
  // DATE AND TIME HANDLING
  // ---------------------------------------------

  function localDateTime(date) {
    return (
      `${date.getFullYear()}-` +
      `${pad(date.getMonth() + 1)}-` +
      `${pad(date.getDate())}T` +
      `${pad(date.getHours())}:` +
      `${pad(date.getMinutes())}`
    );
  }

  function selectedDate() {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
        .exec(ui.photoDateTime.value);

    if (!match) return null;

    const [
      ,
      year,
      month,
      day,
      hour,
      minute
    ] = match.map(Number);

    const date = new Date(
      year,
      month - 1,
      day,
      hour,
      minute
    );

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute
    ) {
      return null;
    }

    return date;
  }

  // ---------------------------------------------
  // GREGORIAN DATE FORMATTING
  // ---------------------------------------------

  function formatGregorian(date, language) {
    if (!date) {
      return "Enter a valid photo date and time";
    }

    if (language === "en") {
      const hour = date.getHours() % 12 || 12;
      const ampm =
        date.getHours() < 12 ? "AM" : "PM";

      return (
        `${EN_MONTHS[date.getMonth()]} ` +
        `${pad(date.getDate())}, ` +
        `${date.getFullYear()} · ` +
        `${hour}:${pad(date.getMinutes())} ${ampm}`
      );
    }

    return (
      `${bn(date.getDate())} ` +
      `${BN_MONTHS[date.getMonth()]}, ` +
      `${bn(date.getFullYear())} · ` +
      `${bn(pad(date.getHours()))}:` +
      `${bn(pad(date.getMinutes()))}`
    );
  }

  function refreshDownloadButton() {
    const available = Boolean(
      photoFile &&
      !ui.photoFrame.hidden &&
      !ui.signaturePreview.hidden &&
      ui.signaturePreview.naturalWidth > 0 &&
      dateReady &&
      selectedDate() &&
      !exporting
    );

    ui.downloadButton.disabled = !available;
  }

  function showDate(text, ready = Boolean(selectedDate())) {
    ui.formattedDate.textContent = text;
    ui.watermarkDate.textContent = text;

    const language =
      choice("language") === "bn" ? "bn" : "en";

    ui.formattedDate.lang = language;
    ui.watermarkDate.lang = language;

    dateReady = ready;
    refreshDownloadButton();
  }

  // ---------------------------------------------
  // CANCEL PREVIOUS PANJIKA REQUEST
  // ---------------------------------------------

  function cancelDateRequest() {
    dateId += 1;

    if (dateController) {
      dateController.abort();
    }

    dateController = null;
  }

  // ---------------------------------------------
  // LIVE DATE PREVIEW
  // ---------------------------------------------

  async function updateDatePreview() {
    cancelDateRequest();

    const requestId = dateId;
    const date = selectedDate();

    const language = choice("language") || "en";
    const calendar = choice("calendar") || "gregorian";

    // Gregorian date does not require an API call.
    if (
      language !== "bn" ||
      calendar !== "panjika"
    ) {
      showDate(formatGregorian(date, language));
      return;
    }

    if (!date) {
      showDate("পঞ্জিকা দেখতে সঠিক তারিখ লিখুন", false);
      return;
    }

    showDate("পশ্চিমবঙ্গের পঞ্জিকা লোড হচ্ছে…", false);

    const params = new URLSearchParams({
      captured_at: ui.photoDateTime.value,
      language: "bn",
      calendar: "panjika",
    });

    const controller = new AbortController();
    dateController = controller;

    try {
      const response = await fetch(
        `/api/image/format-date?${params}`,
        {
          signal: controller.signal,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : `HTTP ${response.status}`
        );
      }

      // Ignore outdated API responses.
      if (requestId !== dateId) return;

      if (typeof data.formatted !== "string") {
        throw new Error("Missing formatted date");
      }

      showDate(data.formatted);

      ui.panjikaNotice.textContent =
        "West Bengal / Kolkata Bisuddha Siddhanta " +
        "(supported: 2025–2026).";

      log.info("Panjika date", data.formatted);

    } catch (error) {
      if (
        controller.signal.aborted ||
        requestId !== dateId
      ) {
        return;
      }

      showDate("পঞ্জিকা তারিখ পাওয়া যায়নি", false);

      ui.panjikaNotice.hidden = false;
      ui.panjikaNotice.textContent = error.message;

      log.error(
        "Panjika API failed:",
        error.message
      );

    } finally {
      if (requestId === dateId) {
        dateController = null;
      }
    }
  }

  // ---------------------------------------------
  // LANGUAGE AND CALENDAR CONTROLS
  // ---------------------------------------------

  function updateControls() {
    const language = choice("language") || "en";

    const panjikaRadio = document.querySelector(
      'input[name="calendar"][value="panjika"]'
    );

    if (panjikaRadio) {
      panjikaRadio.disabled = language !== "bn";
    }

    if (language !== "bn") {
      const gregorian = document.querySelector(
        'input[name="calendar"][value="gregorian"]'
      );

      if (gregorian) {
        gregorian.checked = true;
      }
    }

    const isPanjika =
      language === "bn" &&
      choice("calendar") === "panjika";

    ui.panjikaNotice.hidden = !isPanjika;

    ui.panjikaNotice.textContent = isPanjika
      ? "West Bengal Panjika (supported years: 2025–2026)."
      : "";

    ui.calendarHint.textContent =
      language === "bn"
        ? "West Bengal / Indian traditional Panjika (not Bangladesh)."
        : "Switch to বাংলা to select the traditional Bengali calendar.";

    void updateDatePreview();
  }

  // ---------------------------------------------
  // SIGNATURE IMAGE PROCESSING
  // ---------------------------------------------

  // This function analyzes the original PNG,
  // detects its color, and crops transparent
  // padding for the browser preview only.

  function analyzeSignature(image) {
    const canvas = document.createElement("canvas");

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!ctx) {
      throw new Error("Canvas 2D is unavailable");
    }

    ctx.drawImage(image, 0, 0);

    const pixels = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    ).data;

    let left = canvas.width;
    let top = canvas.height;
    let right = -1;
    let bottom = -1;

    const channels = [
      new Float64Array(256),
      new Float64Array(256),
      new Float64Array(256),
    ];

    let weight = 0;

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (
          y * canvas.width + x
        ) * 4;

        const alpha = pixels[i + 3];

        if (alpha >= 32) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }

        if (alpha >= 96) {
          for (let c = 0; c < 3; c++) {
            channels[c][pixels[i + c]] += alpha;
          }

          weight += alpha;
        }
      }
    }

    if (right < left) {
      return {
        url: image.src,
        color: null,
      };
    }

    function median(histogram) {
      let sum = 0;

      for (let i = 0; i < 256; i++) {
        sum += histogram[i];

        if (sum >= weight / 2) {
          return i;
        }
      }

      return 0;
    }

    const color = weight
      ? `rgb(${channels.map(median).join(", ")})`
      : null;

    const margin = Math.max(
      3,
      Math.round(
        Math.min(canvas.width, canvas.height) * 0.01
      )
    );

    left = Math.max(0, left - margin);
    top = Math.max(0, top - margin);

    right = Math.min(
      canvas.width - 1,
      right + margin
    );

    bottom = Math.min(
      canvas.height - 1,
      bottom + margin
    );

    const width = right - left + 1;
    const height = bottom - top + 1;

    const cropped = document.createElement("canvas");

    cropped.width = width;
    cropped.height = height;

    cropped.getContext("2d").drawImage(
      canvas,
      left,
      top,
      width,
      height,
      0,
      0,
      width,
      height
    );

    return {
      url: cropped.toDataURL("image/png"),
      color,
    };
  }

  // ---------------------------------------------
  // SIGNATURE SELECTION
  // ---------------------------------------------

  function updateSignature() {
    const selected =
      choice("signature") || "light";

    const filename = `signature_${selected}.png`;
    const requestId = ++signatureId;

    const image = ui.signaturePreview;

    ui.watermark.classList.toggle(
      "watermark-light",
      selected === "light"
    );

    ui.watermark.classList.toggle(
      "watermark-dark",
      selected === "dark"
    );

    ui.watermark.style.removeProperty(
      "--signature-text-color"
    );

    image.hidden = true;
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");

    ui.signatureStatus.textContent =
      `Loading ${filename}…`;

    const source = new Image();

    source.onload = () => {
      if (requestId !== signatureId) return;

      let result;

      try {
        result = analyzeSignature(source);

      } catch (error) {
        log.warn(
          "Signature analysis failed:",
          error
        );

        result = {
          url: source.src,
          color: null,
        };
      }

      if (result.color) {
        ui.watermark.style.setProperty(
          "--signature-text-color",
          result.color
        );
      }

      image.onload = () => {
        if (requestId !== signatureId) return;

        image.hidden = false;

        ui.signatureStatus.textContent =
          `Loaded ${filename}.`;

        log.info("Signature loaded", {
          filename,
          color: result.color,
        });
      };

      image.onerror = () => {
        if (requestId !== signatureId) return;

        ui.signatureStatus.textContent =
          `Could not show ${filename}.`;

        log.error(
          "Signature preview decoding failed:",
          filename
        );
      };

      image.src = result.url;
    };

    source.onerror = () => {
      if (requestId !== signatureId) return;

      ui.signatureStatus.textContent =
        `Missing ${filename} in app/static/images/.`;

      log.error(
        "Signature missing:",
        filename
      );
    };

    source.src = `/static/images/${filename}`;
  }

  // ---------------------------------------------
  // FILE SIZE FORMATTER
  // ---------------------------------------------

  const sizeLabel = bytes =>
    bytes >= 1048576
      ? `${(bytes / 1048576).toFixed(2)} MB`
      : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;

  // ---------------------------------------------
  // METADATA STATUS DISPLAY
  // ---------------------------------------------

  function metadataStatus(
    title,
    details = "",
    warning = "",
    error = false
  ) {
    ui.metadataPanel.hidden = false;

    ui.metadataPanel.classList.toggle(
      "is-error",
      error
    );

    ui.metadataStatus.textContent = title;
    ui.metadataDetails.textContent = details;
    ui.metadataWarnings.textContent = warning;
  }

  // ---------------------------------------------
  // CLEAR SELECTED PHOTO
  // ---------------------------------------------

  function clearPhoto(resetDate = true) {
    uploadId += 1;

    if (metadataController) {
      metadataController.abort();
    }

    metadataController = null;
    metadataPending = false;
    manualDateEdited = false;
    photoFile = null;

    if (photoUrl) {
      URL.revokeObjectURL(photoUrl);
    }

    photoUrl = null;

    ui.photoPreview.onload = null;
    ui.photoPreview.onerror = null;
    ui.photoPreview.removeAttribute("src");

    ui.photoInput.value = "";

    ui.photoFrame.hidden = true;
    ui.emptyPreview.hidden = false;
    ui.fileSummary.hidden = true;
    ui.metadataPanel.hidden = true;

    ui.uploadMessage.textContent = "";

    if (resetDate) {
      ui.photoDateTime.value =
        localDateTime(new Date());

      ui.dateHelp.textContent =
        "Choose a photo to read the capture date from EXIF; you can edit it.";

      void updateDatePreview();
    }

    log.info("Photo selection cleared");
  }

  // ---------------------------------------------
  // READ PHOTO METADATA
  // ---------------------------------------------

  async function readMetadata(file, requestId) {
    const controller = new AbortController();

    metadataController = controller;
    metadataPending = true;

    const form = new FormData();

    form.append(
      "file",
      file,
      file.name
    );

    log.info(
      "Reading EXIF metadata",
      { file: file.name }
    );

    try {
      const response = await fetch(
        "/api/image/metadata",
        {
          method: "POST",
          body: form,
          signal: controller.signal,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : `HTTP ${response.status}`
        );
      }

      if (requestId !== uploadId) return;

      if (data.captured_at) {
        if (!manualDateEdited) {
          ui.photoDateTime.value =
            data.captured_at.slice(0, 16);
        }

        ui.dateHelp.textContent = manualDateEdited
          ? "EXIF date found. Your manual changes have been preserved."
          : `Capture date from ${data.date_source || "EXIF"}. You may edit it.`;

      } else {
        if (!manualDateEdited) {
          ui.photoDateTime.value = "";
        }

        ui.dateHelp.textContent =
          "No original capture time found. Enter the correct date manually.";
      }

      void updateDatePreview();

      const dimensions =
        data.display_width && data.display_height
          ? `${data.display_width} × ${data.display_height}`
          : "Size unavailable";

      const gps =
        data.gps &&
        Number.isFinite(Number(data.gps.latitude)) &&
        Number.isFinite(Number(data.gps.longitude))
          ? ` · GPS: ${Number(data.gps.latitude).toFixed(5)}, ${Number(data.gps.longitude).toFixed(5)}`
          : " · No GPS";

      metadataStatus(
        data.captured_at
          ? "Original capture date detected"
          : "No EXIF capture date",
        `${data.image_format || "Image"} · ${dimensions} · ` +
        `Orientation ${data.orientation || 1}${gps}`,
        Array.isArray(data.warnings)
          ? data.warnings.join(" ")
          : ""
      );

      log.info("Metadata parsed", {
        source: data.date_source,
        date: data.captured_at || null,
      });

    } catch (error) {
      if (
        controller.signal.aborted ||
        requestId !== uploadId
      ) {
        return;
      }

      if (!manualDateEdited) {
        ui.photoDateTime.value = "";
      }

      ui.dateHelp.textContent =
        "Metadata unavailable. Enter the photo date manually.";

      void updateDatePreview();

      metadataStatus(
        "Metadata request failed",
        "Manual date entry is available.",
        error.message || "Check the API server.",
        true
      );

      log.error(
        "Metadata API failed:",
        error
      );

    } finally {
      if (requestId === uploadId) {
        metadataPending = false;
        metadataController = null;
      }
    }
  }

  // ---------------------------------------------
  // LOAD PHOTO
  // ---------------------------------------------

  function loadPhoto(file) {
    if (!file) return;

    if (
      !IMAGE_TYPES.has(file.type) &&
      !IMAGE_EXTENSIONS.test(file.name)
    ) {
      ui.uploadMessage.textContent =
        "Choose a JPEG, PNG, WebP, HEIC, or HEIF image.";
      return;
    }

    if (!file.size || file.size > MAX_BYTES) {
      ui.uploadMessage.textContent = file.size
        ? "Maximum image size is 50 MB."
        : "The file is empty.";

      return;
    }

    clearPhoto(false);

    photoFile = file;

    const requestId = uploadId;

    ui.photoDateTime.value = "";

    ui.dateHelp.textContent =
      "Reading original photo metadata…";

    void updateDatePreview();

    ui.fileName.textContent = file.name;
    ui.fileDetails.textContent = sizeLabel(file.size);

    ui.fileSummary.hidden = false;

    metadataStatus(
      "Reading EXIF metadata…",
      "Your image is not permanently stored."
    );

    photoUrl = URL.createObjectURL(file);

    const thisUrl = photoUrl;

    // Image loaded successfully.
    ui.photoPreview.onload = () => {
      if (
        requestId !== uploadId ||
        photoUrl !== thisUrl
      ) {
        return;
      }

      ui.fileDetails.textContent =
        `${sizeLabel(file.size)} · ` +
        `${ui.photoPreview.naturalWidth} × ` +
        `${ui.photoPreview.naturalHeight}`;

      ui.photoFrame.hidden = false;
      ui.emptyPreview.hidden = true;

      log.info(
        "Image preview ready",
        { name: file.name }
      );
    };

    // Image could not be decoded by browser.
    ui.photoPreview.onerror = () => {
      if (
        requestId !== uploadId ||
        photoUrl !== thisUrl
      ) {
        return;
      }

      ui.photoFrame.hidden = true;
      ui.emptyPreview.hidden = false;

      ui.uploadMessage.textContent =
        "Your browser cannot preview this format " +
        "(often HEIC). Metadata may still work.";

      log.warn(
        "Image preview could not be decoded",
        {
          name: file.name,
          type: file.type,
        }
      );
    };

    ui.photoPreview.src = thisUrl;

    log.info("Photo selected", {
      name: file.name,
      type: file.type,
      bytes: file.size,
    });

    void readMetadata(file, requestId);
  }


  // ---------------------------------------------
  // STEP 5: EXPORT WATERMARKED IMAGE
  // ---------------------------------------------

  // Use the preview's measured sizes and offsets so the
  // backend scales them to the photograph's full resolution.
  function getWatermarkGeometry() {
    const photo = ui.photoPreview.getBoundingClientRect();
    const signature = ui.signaturePreview.getBoundingClientRect();
    const watermarkStyle = getComputedStyle(ui.watermark);
    const dateStyle = getComputedStyle(ui.watermarkDate);

    if (!photo.width || !photo.height || !signature.width) {
      throw new Error("The photo and signature preview must load first.");
    }

    const ratios = {
      signature_width_ratio: signature.width / photo.width,
      font_size_ratio: parseFloat(dateStyle.fontSize) / photo.width,
      left_ratio: parseFloat(watermarkStyle.left) / photo.width,
      bottom_ratio: parseFloat(watermarkStyle.bottom) / photo.height,
      gap_ratio: (parseFloat(watermarkStyle.rowGap || watermarkStyle.gap) || 0) / photo.height,
    };

    if (Object.values(ratios).some(v => !Number.isFinite(v) || v < 0)) {
      throw new Error("Unable to measure the preview proportions.");
    }

    return ratios;
  }

  async function downloadFinalImage() {
    if (ui.downloadButton.disabled || !photoFile || !selectedDate()) return;

    const originalFile = photoFile;
    exporting = true;
    refreshDownloadButton();
    ui.downloadLabel.textContent = "Rendering photograph…";
    ui.downloadStatus.textContent = "Creating your full-resolution image…";

    try {
      const form = new FormData();
      form.append("file", originalFile, originalFile.name);
      form.append("captured_at", ui.photoDateTime.value);
      form.append("language", choice("language") || "en");
      form.append("calendar", choice("calendar") || "gregorian");
      form.append("signature", choice("signature") || "light");
      form.append("bold", String(ui.boldDate.checked));

      const geometry = getWatermarkGeometry();
      for (const [key, value] of Object.entries(geometry)) {
        form.append(key, String(value));
      }

      log.info("Starting watermark export", {
        file: originalFile.name,
        geometry
      });

      const response = await fetch("/api/image/render", {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        let message = `Render failed (HTTP ${response.status}).`;

        try {
          const result = await response.json();

          if (typeof result.detail === "string") {
            message = result.detail;
          }
        } catch {
          // Keep HTTP message when server error is not JSON.
        }

        throw new Error(message);
      }

      const mime = (
        response.headers.get("content-type") || ""
      ).split(";")[0];

      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
        throw new Error("The server returned an unsupported image format.");
      }

      const output = await response.blob();

      if (!output.size) {
        throw new Error("The exported image is empty.");
      }

      const ext = mime === "image/png"
        ? "png"
        : mime === "image/webp"
          ? "webp"
          : "jpg";

      const name = originalFile.name
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .slice(0, 65) || "photo";

      const downloadName = `${name}_watermarked.${ext}`;

      const url = URL.createObjectURL(output);
      const link = document.createElement("a");

      link.href = url;
      link.download = downloadName;

      document.body.appendChild(link);
      link.click();
      link.remove();

      // Allow time for browsers to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      ui.downloadStatus.textContent =
        `Download started: ${downloadName}`;

      log.info("Export ready", {
        name: downloadName,
        bytes: output.size
      });

    } catch (error) {
      ui.downloadStatus.textContent =
        error.message || "Download failed.";

      log.error("Watermark download failed", error);

    } finally {
      exporting = false;
      ui.downloadLabel.textContent = "Download final image";
      refreshDownloadButton();
    }
  }


  // ---------------------------------------------
  // FILE INPUT EVENTS
  // ---------------------------------------------

  ui.photoInput.addEventListener(
    "change",
    event => {
      const file = event.target.files?.[0];

      if (file) {
        loadPhoto(file);
      }

      // Allow selecting the same file again.
      event.target.value = "";
    }
  );

  ui.dropZone.addEventListener(
    "click",
    () => {
      ui.photoInput.click();
    }
  );

  ui.dropZone.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        ui.photoInput.click();
      }
    }
  );

  // ---------------------------------------------
  // DRAG AND DROP
  // ---------------------------------------------

  for (const type of [
    "dragenter",
    "dragover"
  ]) {
    ui.dropZone.addEventListener(
      type,
      event => {
        event.preventDefault();

        ui.dropZone.classList.add(
          "drag-active"
        );
      }
    );
  }

  for (const type of [
    "dragleave",
    "drop"
  ]) {
    ui.dropZone.addEventListener(
      type,
      event => {
        event.preventDefault();

        ui.dropZone.classList.remove(
          "drag-active"
        );
      }
    );
  }

  ui.dropZone.addEventListener(
    "drop",
    event => {
      const file =
        event.dataTransfer?.files?.[0];

      if (file) {
        loadPhoto(file);
      }
    }
  );

  for (const type of [
    "dragover",
    "drop"
  ]) {
    window.addEventListener(
      type,
      event => {
        if (
          event.dataTransfer?.types?.includes("Files")
        ) {
          event.preventDefault();
        }
      }
    );
  }

  // ---------------------------------------------
  // REMOVE PHOTO
  // ---------------------------------------------

  ui.removePhoto.addEventListener(
    "click",
    () => clearPhoto()
  );

  // ---------------------------------------------
  // MANUAL DATE CHANGES
  // ---------------------------------------------

  ui.photoDateTime.addEventListener(
    "input",
    () => {
      if (metadataPending) {
        manualDateEdited = true;
      }

      void updateDatePreview();
    }
  );

  // ---------------------------------------------
  // LANGUAGE AND CALENDAR TOGGLES
  // ---------------------------------------------

  document.querySelectorAll(
    'input[name="language"], input[name="calendar"]'
  ).forEach(input => {
    input.addEventListener(
      "change",
      updateControls
    );
  });

  // ---------------------------------------------
  // SIGNATURE TOGGLE
  // ---------------------------------------------

  document.querySelectorAll(
    'input[name="signature"]'
  ).forEach(input => {
    input.addEventListener(
      "change",
      updateSignature
    );
  });

  // ---------------------------------------------
  // BOLD DATE TOGGLE
  // ---------------------------------------------

  ui.boldDate.addEventListener(
    "change",
    () => {
      ui.watermarkDate.classList.toggle(
        "is-bold",
        ui.boldDate.checked
      );
    }
  );

  // NEW: Download button
  ui.downloadButton.addEventListener(
    "click", () => void downloadFinalImage()
  );

  // Refresh button availability when the photo
  // or signature finishes loading.
  const downloadObserver = new MutationObserver(refreshDownloadButton);

  downloadObserver.observe(ui.photoFrame, {
    attributes: true,
    attributeFilter: ["hidden"]
  });

  downloadObserver.observe(ui.signaturePreview, {
    attributes: true,
    attributeFilter: ["hidden"]
  });

  // ---------------------------------------------
  // CLEANUP
  // ---------------------------------------------

  window.addEventListener(
    "pagehide",
    () => {
      metadataController?.abort();
      dateController?.abort();

      if (photoUrl) {
        URL.revokeObjectURL(photoUrl);
      }
    }
  );

  // ---------------------------------------------
  // INITIALIZE
  // ---------------------------------------------

  // Today's date is only an initial example.
  // Once a photo is uploaded, its EXIF date
  // replaces this, when available.

  ui.photoDateTime.value =
    localDateTime(new Date());

  ui.watermarkDate.classList.toggle(
    "is-bold",
    ui.boldDate.checked
  );

  updateControls();
  updateSignature();
  refreshDownloadButton();

  log.info("Step 5 frontend initialized");
})();