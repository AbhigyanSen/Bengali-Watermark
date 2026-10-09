
"use strict";

// Bengali Watermark Studio — Version 1.5.1
// Mobile-first editor, independent watermark layers,
// responsive preview and full-resolution downloads.

(() => {
  const $ = id => document.getElementById(id);

  const ui = Object.fromEntries([
    'photoInput',
    'choosePhoto',
    'replacePhoto',
    'removePhoto',
    'photoFrame',
    'photoPreview',
    'emptyPreview',
    'previewStage',
    'signaturePreview',
    'watermarkDate',
    'watermarkLocation',
    'fileName',
    'fileDetails',
    'uploadMessage',
    'metadataPanel',
    'metadataStatus',
    'metadataDetails',
    'metadataWarnings',
    'photoDateTime',
    'dateHelp',
    'formattedDate',
    'dateText',
    'boldDate',
    'panjikaToggle',
    'showLocation',
    'locationSummary',
    'locationText',
    'downloadButton',
    'downloadLabel',
    'downloadStatus',
    'panjikaNotice',
    'calendarHint',
    'signatureStatus',
    'fontGroups',
    'fontChosen',
    'fontHelp',
    'freeMove',
    'resetPosition',
    'orientationTip',
    'dismissOrientationTip'
  ].map(id => [id, $(id)]));

  const optionalUi = new Set([
    'orientationTip',
    'dismissOrientationTip'
  ]);

  const missing = Object.entries(ui)
    .filter(([id, el]) => !el && !optionalUi.has(id))
    .map(([id]) => id);

  if (missing.length) {
    console.error(
      '[BengaliWatermark] Missing UI elements:',
      missing
    );
    return;
  }

  const log = (...args) =>
    console.info('[BengaliWatermark]', ...args);

  const DIGITS = '০১২৩৪৫৬৭৮৯';

  const EN = [
    'January', 'February', 'March',
    'April', 'May', 'June',
    'July', 'August', 'September',
    'October', 'November', 'December'
  ];

  const BN = [
    'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ',
    'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর',
    'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
  ];

  const pad = number =>
    String(number).padStart(2, '0');

  const bn = value =>
    String(value).replace(
      /\d/g,
      d => DIGITS[Number(d)]
    );

  const selected = name =>
    document.querySelector(
      `input[name="${name}"]:checked`
    )?.value || '';

  const clamp = (n, lo, hi) =>
    Math.min(hi, Math.max(lo, n));

  const els = {
    signature: ui.signaturePreview,
    date: ui.watermarkDate,
    location: ui.watermarkLocation
  };

  let file = null;
  let objectUrl = null;

  // Separate URL for browser-compatible image previews.
  let compatiblePreviewUrl = null;
  let previewAbort = null;
  let usingCompatiblePreview = false;

  let photoRequest = 0;
  let metaAbort = null;

  let metaPending = false;
  let manualDateEdited = false;
  let gpsText = '';

  let signatureRequest = 0;
  let dateRequest = 0;
  let dateAbort = null;

  let dateReady = false;
  let exporting = false;
  let activeCaption = '';

  let fontCatalog = null;
  let activeFont = {
    en: null,
    bn: null
  };

  const fontFaces = new Map();
  let fontFaceCounter = 0;

  const positions = {
    signature: null,
    date: null,
    location: null
  };

  let layoutQueued = false;

  // --------------------------------------------------
  // DATE AND TIME HELPERS
  // --------------------------------------------------

  function localValue(date) {
    return (
      `${date.getFullYear()}-` +
      `${pad(date.getMonth() + 1)}-` +
      `${pad(date.getDate())}T` +
      `${pad(date.getHours())}:` +
      `${pad(date.getMinutes())}`
    );
  }

  function parseDate() {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
        .exec(ui.photoDateTime.value);

    if (!match) return null;

    const [, year, month, day, hour, minute] =
      match.map(Number);

    const dt = new Date(
      year,
      month - 1,
      day,
      hour,
      minute
    );

    return (
      dt.getFullYear() === year &&
      dt.getMonth() === month - 1 &&
      dt.getDate() === day &&
      dt.getHours() === hour &&
      dt.getMinutes() === minute
    ) ? dt : null;
  }

  function gregorian(dt, language) {
    if (!dt) return '';

    const hour = dt.getHours();
    const minute = pad(dt.getMinutes());

    if (language === 'en') {
      return (
        `${EN[dt.getMonth()]} ` +
        `${pad(dt.getDate())}, ` +
        `${dt.getFullYear()} · ` +
        `${hour % 12 || 12}:${minute} ` +
        `${hour < 12 ? 'AM' : 'PM'}`
      );
    }

    return (
      `${bn(dt.getDate())} ` +
      `${BN[dt.getMonth()]}, ` +
      `${bn(dt.getFullYear())} · ` +
      `${bn(pad(hour))}:${bn(minute)}`
    );
  }

  function showCaption(value, ready) {
    activeCaption = value;

    ui.formattedDate.textContent =
      value || 'Set a photo date in Advanced';

    ui.watermarkDate.textContent = value;

    ui.watermarkDate.lang =
      ui.formattedDate.lang =
      selected('language') || 'en';

    dateReady = ready;

    scheduleLayout();
    refreshDownload();
  }

  // --------------------------------------------------
  // LIVE DATE PREVIEW
  // --------------------------------------------------

  async function updateDate() {
    dateRequest++;

    dateAbort?.abort();
    dateAbort = null;

    const token = dateRequest;

    const dt = parseDate();
    const language = selected('language');
    const calendar = selected('calendar');
    const custom = ui.dateText.value.trim();

    ui.panjikaNotice.hidden = true;

    if (!dt) {
      showCaption(
        'Choose a valid date in Advanced',
        false
      );
      return;
    }

    if (custom) {
      showCaption(custom, true);
      return;
    }

    if (
      language !== 'bn' ||
      calendar !== 'panjika'
    ) {
      showCaption(
        gregorian(dt, language),
        true
      );
      return;
    }

    showCaption(
      'পঞ্জিকা লোড হচ্ছে…',
      false
    );

    const controller = new AbortController();
    dateAbort = controller;

    try {
      const params = new URLSearchParams({
        captured_at: ui.photoDateTime.value,
        language: 'bn',
        calendar: 'panjika'
      });

      const response = await fetch(
        `/api/image/format-date?${params}`,
        { signal: controller.signal }
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof body.detail === 'string'
            ? body.detail
            : `HTTP ${response.status}`
        );
      }

      if (token !== dateRequest) return;

      showCaption(body.formatted, true);

    } catch (error) {
      if (
        controller.signal.aborted ||
        token !== dateRequest
      ) {
        return;
      }

      showCaption(
        'পঞ্জিকা তারিখ পাওয়া যায়নি',
        false
      );

      ui.panjikaNotice.hidden = false;
      ui.panjikaNotice.textContent =
        error.message;

    } finally {
      if (token === dateRequest) {
        dateAbort = null;
      }
    }
  }

  function updateCalendarControls() {
    const bnLang =
      selected('language') === 'bn';

    const panjika = document.querySelector(
      'input[name="calendar"][value="panjika"]'
    );

    panjika.disabled = !bnLang;

    if (!bnLang) {
      document.querySelector(
        'input[name="calendar"][value="gregorian"]'
      ).checked = true;
    }

    // Show the calendar toggle only for Bengali dates.
    ui.panjikaToggle.parentElement.hidden = !bnLang;
    ui.panjikaToggle.checked = bnLang && panjika.checked;

    ui.calendarHint.textContent = bnLang
      ? 'Traditional West Bengal Panjika (verified for 2025–2026).'
      : 'Choose বাংলা to enable the West Bengal Panjika.';

    void updateFontForLanguage();
    void updateDate();
  }

  // --------------------------------------------------
  // FONT COLLECTION
  // --------------------------------------------------

  function languageFolder() {
    return selected('language') === 'bn'
      ? 'bengali'
      : 'english';
  }

  function allVariants(folder) {
    return (
      fontCatalog?.groups?.[folder] || []
    ).flatMap(group => group.variants);
  }

  async function loadFont(folder, item) {
    const key = `${folder}/${item.name}`;

    if (fontFaces.has(key)) {
      return fontFaces.get(key);
    }

    const family =
      `watermark_font_${++fontFaceCounter}`;

    const promise = (async () => {
      const face = new FontFace(
        family,
        `url(${JSON.stringify(item.url)})`
      );

      const loaded = await face.load();

      document.fonts.add(loaded);

      return family;
    })();

    fontFaces.set(key, promise);

    return promise;
  }

  function displaySample(el, folder, variant) {
    loadFont(folder, variant)
      .then(family => {
        if (el.isConnected) {
          el.style.fontFamily =
            `"${family}", sans-serif`;
        }
      })
      .catch(() => {
        if (el.isConnected) {
          el.textContent +=
            ' (preview unavailable)';
        }
      });
  }

  function createFontPicker() {
    ui.fontGroups.replaceChildren();

    const folder = languageFolder();

    const groups =
      fontCatalog?.groups?.[folder] || [];

    const current =
      activeFont[selected('language')];

    ui.fontChosen.textContent =
      current || 'System fallback';

    if (!groups.length) {
      const empty = document.createElement('p');

      empty.className = 'empty-fonts';

      empty.textContent =
        `No fonts in app/static/fonts/${folder}/. ` +
        'Add .ttf or .otf files and restart or refresh.';

      ui.fontGroups.append(empty);
      return;
    }

    const example = fontCatalog.samples[folder];

    for (const group of groups) {
      const details =
        document.createElement('details');

      details.className = 'family';

      const summary =
        document.createElement('summary');

      const title =
        document.createElement('span');

      title.className = 'family-name';

      const name =
        document.createElement('strong');

      name.textContent = group.family;

      const sample =
        document.createElement('span');

      sample.className = 'font-sample';
      sample.textContent = example;

      title.append(name, sample);

      const arrow =
        document.createElement('span');

      arrow.className = 'arrow';
      arrow.textContent = '›';

      summary.append(title, arrow);
      details.append(summary);

      displaySample(
        sample,
        folder,
        group.variants[0]
      );

      const variants =
        document.createElement('div');

      variants.className = 'variants';

      for (const variant of group.variants) {
        const button =
          document.createElement('button');

        button.type = 'button';

        button.className =
          `variant${
            variant.name === current
              ? ' active'
              : ''
          }`;

        const label =
          document.createElement('span');

        label.className = 'variant-label';
        label.textContent = variant.variant;

        if (variant.name === current) {
          const flag =
            document.createElement('span');

          flag.textContent = '✓ Selected';
          label.append(flag);
        }

        const line =
          document.createElement('span');

        line.className = 'font-sample';
        line.textContent = example;

        const filename =
          document.createElement('small');

        filename.textContent = variant.name;
        filename.style.overflowWrap =
          'anywhere';

        button.append(
          label,
          line,
          filename
        );

        button.addEventListener(
          'click',
          () => {
            void chooseFont(folder, variant);
          }
        );

        variants.append(button);

        // Load individual variants only when expanded.
        details.addEventListener(
          'toggle',
          () => {
            if (details.open) {
              displaySample(
                line,
                folder,
                variant
              );
            }
          }
        );
      }

      details.append(variants);

      if (
        group.variants.some(
          variant => variant.name === current
        )
      ) {
        details.open = true;
      }

      ui.fontGroups.append(details);
    }
  }

  async function chooseFont(folder, variant) {
    const lang =
      folder === 'bengali'
        ? 'bn'
        : 'en';

    activeFont[lang] = variant.name;

    createFontPicker();

    await applyFont(lang);
  }

  async function applyFont(
    lang = selected('language')
  ) {
    const folder =
      lang === 'bn'
        ? 'bengali'
        : 'english';

    const requested = activeFont[lang];

    const variant = allVariants(folder).find(
      item => item.name === requested
    );

    if (!variant) {
      ui.watermarkDate.style.fontFamily = '';
      ui.watermarkLocation.style.fontFamily = '';

      scheduleLayout();
      return;
    }

    try {
      const family = await loadFont(
        folder,
        variant
      );

      if (
        lang !== selected('language') ||
        requested !== activeFont[lang]
      ) {
        return;
      }

      ui.watermarkDate.style.fontFamily =
        `"${family}", "Noto Sans Bengali", sans-serif`;

      ui.watermarkDate.style.fontWeight =
        ui.boldDate.checked
          ? '700'
          : '200';

      ui.watermarkLocation.style.fontWeight =
        '400';

      await applyLocationFont();

      scheduleLayout();

    } catch (error) {
      ui.fontHelp.textContent =
        `Cannot preview ${variant.name}: ` +
        error.message;

      ui.watermarkDate.style.fontFamily = '';
      ui.watermarkLocation.style.fontFamily = '';
    }
  }

  function locationLanguage() {
    return /[\u0980-\u09ff]/.test(
      currentLocation()
    ) ? 'bn' : 'en';
  }

  async function applyLocationFont() {
    const lang = locationLanguage();

    const folder =
      lang === 'bn'
        ? 'bengali'
        : 'english';

    const chosen = activeFont[lang];

    const variant = allVariants(folder).find(
      item => item.name === chosen
    );

    if (!variant) {
      ui.watermarkLocation.style.fontFamily = '';
      scheduleLayout();
      return;
    }

    try {
      const family = await loadFont(
        folder,
        variant
      );

      if (
        locationLanguage() !== lang ||
        activeFont[lang] !== chosen
      ) {
        return;
      }

      ui.watermarkLocation.style.fontFamily =
        `"${family}", sans-serif`;

      scheduleLayout();

    } catch {
      ui.watermarkLocation.style.fontFamily = '';
      scheduleLayout();
    }
  }

  async function updateFontForLanguage() {
    createFontPicker();
    await applyFont();
  }

  async function fetchFonts() {
    try {
      const response = await fetch(
        '/api/image/fonts'
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      fontCatalog = await response.json();

      for (
        const [folder, lang] of [
          ['english', 'en'],
          ['bengali', 'bn']
        ]
      ) {
        activeFont[lang] =
          fontCatalog.defaults?.[folder] || null;
      }

      await updateFontForLanguage();

      log(
        'Font catalog loaded',
        fontCatalog.defaults
      );

    } catch (error) {
      ui.fontHelp.textContent =
        `Font collection unavailable: ${error.message}`;

      ui.fontGroups.textContent =
        'The watermark will use the server fallback font.';
    }
  }

  // --------------------------------------------------
  // SIGNATURE ANALYSIS
  // --------------------------------------------------

  function analyzeSignature(image) {
    const canvas = document.createElement('canvas');

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const ctx = canvas.getContext('2d', {
      willReadFrequently: true
    });

    if (!ctx) {
      throw new Error('Canvas unavailable.');
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
    let total = 0;

    const channels = [
      new Float64Array(256),
      new Float64Array(256),
      new Float64Array(256)
    ];

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const pos = (
          y * canvas.width + x
        ) * 4;

        const a = pixels[pos + 3];

        if (a >= 32) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }

        if (a >= 96) {
          for (let c = 0; c < 3; c++) {
            channels[c][pixels[pos + c]] += a;
          }

          total += a;
        }
      }
    }

    if (right < left) {
      throw new Error(
        'Signature contains no visible ink.'
      );
    }

    const median = histogram => {
      let n = 0;

      for (let i = 0; i < 256; i++) {
        n += histogram[i];

        if (n >= total / 2) {
          return i;
        }
      }

      return 0;
    };

    const ink = total
      ? `rgb(${channels.map(median).join(',')})`
      : '';

    const margin = Math.max(
      3,
      Math.round(
        Math.min(
          canvas.width,
          canvas.height
        ) * 0.01
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

    const cropped = document.createElement(
      'canvas'
    );

    cropped.width = right - left + 1;
    cropped.height = bottom - top + 1;

    cropped.getContext('2d').drawImage(
      canvas,
      left,
      top,
      cropped.width,
      cropped.height,
      0,
      0,
      cropped.width,
      cropped.height
    );

    return {
      src: cropped.toDataURL('image/png'),
      ink
    };
  }

  function updateSignature() {
    const choice =
      selected('signature') || 'light';

    const request = ++signatureRequest;
    const source = new Image();

    ui.signaturePreview.hidden = true;

    ui.signatureStatus.textContent =
      `Loading ${choice} ink…`;

    ui.photoFrame.style.setProperty(
      '--watermark-color',
      choice === 'light'
        ? 'rgb(196,188,179)'
        : 'rgb(39,43,47)'
    );

    refreshDownload();

    source.onload = () => {
      if (request !== signatureRequest) {
        return;
      }

      try {
        const analysis =
          analyzeSignature(source);

        ui.photoFrame.style.setProperty(
          '--watermark-color',
          analysis.ink
        );

        ui.signaturePreview.onload = () => {
          if (request !== signatureRequest) {
            return;
          }

          ui.signaturePreview.hidden = false;

          ui.signatureStatus.textContent =
            `Using ${choice} signature ink.`;

          scheduleLayout();
          refreshDownload();
        };

        ui.signaturePreview.src =
          analysis.src;

      } catch (error) {
        ui.signatureStatus.textContent =
          error.message;
      }
    };

    source.onerror = () => {
      ui.signatureStatus.textContent =
        `Missing signature_${choice}.png`;

      refreshDownload();
    };

    source.src =
      `/static/images/signature_${choice}.png`;
  }

  // --------------------------------------------------
  // LOCATION
  // --------------------------------------------------

  function currentLocation() {
    if (!ui.showLocation.checked) {
      return '';
    }

    return (
      ui.locationText.value.trim() ||
      gpsText
    );
  }

  function updateLocation() {
    const text = currentLocation();

    ui.watermarkLocation.textContent = text;
    ui.watermarkLocation.hidden = !text;
    ui.watermarkLocation.lang =
      selected('language');

    ui.locationSummary.textContent =
      text || 'Add a place in Advanced or use GPS';

    if (!text) {
      positions.location = null;
    }

    void applyLocationFont();
    scheduleLayout();
  }

  // --------------------------------------------------
  // METADATA
  // --------------------------------------------------

  function metadataNotice(
    title,
    details = '',
    warning = ''
  ) {
    ui.metadataPanel.hidden = false;
    ui.metadataStatus.textContent = title;
    ui.metadataDetails.textContent = details;
    ui.metadataWarnings.textContent = warning;
  }

  function clearPhoto(clearDate = true) {
    ++photoRequest;

    metaAbort?.abort();
    metaAbort = null;
    metaPending = false;
    manualDateEdited = false;

    previewAbort?.abort();
    previewAbort = null;

    if (compatiblePreviewUrl) {
      URL.revokeObjectURL(compatiblePreviewUrl);
    }

    compatiblePreviewUrl = null;
    usingCompatiblePreview = false;

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }

    objectUrl = null;
    file = null;
    gpsText = '';

    ui.photoPreview.onload = null;
    ui.photoPreview.onerror = null;

    ui.photoPreview.removeAttribute('src');

    ui.photoFrame.hidden = true;
    ui.emptyPreview.hidden = false;

    ui.photoInput.value = '';

    ui.fileName.textContent =
      'No photograph selected';

    ui.fileDetails.textContent =
      'Photo is processed temporarily, not stored.';

    ui.uploadMessage.textContent = '';

    ui.metadataPanel.hidden = true;
    ui.removePhoto.disabled = true;

    for (const name of Object.keys(positions)) {
      positions[name] = null;
    }

    ui.locationText.value = '';
    updateLocation();

    if (clearDate) {
      ui.photoDateTime.value = '';

      ui.dateHelp.textContent =
        'Capture time is read from EXIF when available.';

      void updateDate();
    }

    refreshDownload();
  }

  async function fetchMetadata(chosen, token) {
    const controller = new AbortController();

    metaAbort = controller;
    metaPending = true;

    const form = new FormData();

    form.append(
      'file',
      chosen,
      chosen.name
    );

    metadataNotice('Reading camera details…');

    try {
      const response = await fetch(
        '/api/image/metadata',
        {
          method: 'POST',
          body: form,
          signal: controller.signal
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === 'string'
            ? data.detail
            : `HTTP ${response.status}`
        );
      }

      if (token !== photoRequest) {
        return;
      }

      if (!manualDateEdited) {
        ui.photoDateTime.value =
          (data.captured_at || '').slice(0, 16);
      }

      ui.dateHelp.textContent =
        data.captured_at
          ? 'Camera capture time detected; editable here.'
          : 'No EXIF date found. Enter the date manually.';

      gpsText = (
        data.gps &&
        Number.isFinite(Number(data.gps.latitude)) &&
        Number.isFinite(Number(data.gps.longitude))
      )
        ? (
          `${Number(data.gps.latitude).toFixed(5)}, ` +
          `${Number(data.gps.longitude).toFixed(5)}`
        )
        : '';

      updateLocation();

      metadataNotice(
        data.captured_at
          ? 'Camera date detected'
          : 'No EXIF date detected',
        (
          `${data.image_format || 'Photo'} · ` +
          `${data.display_width || '?'} × ` +
          `${data.display_height || '?'}`
        ),
        Array.isArray(data.warnings)
          ? data.warnings.join(' ')
          : ''
      );

      void updateDate();

    } catch (error) {
      if (
        controller.signal.aborted ||
        token !== photoRequest
      ) {
        return;
      }

      if (!manualDateEdited) {
        ui.photoDateTime.value = '';
      }

      ui.dateHelp.textContent =
        'Metadata unavailable. Enter a date manually.';

      metadataNotice(
        'Could not read camera details',
        error.message
      );

      void updateDate();

    } finally {
      if (token === photoRequest) {
        metaAbort = null;
        metaPending = false;
      }
    }
  }


  // ---------------------------------------------
  // HEIC / UNUSUAL JPEG BROWSER PREVIEW
  // ---------------------------------------------

  async function loadCompatiblePreview(chosen, token) {
    previewAbort?.abort();

    const controller = new AbortController();
    previewAbort = controller;

    ui.uploadMessage.textContent =
      'Preparing a compatible photo preview…';

    try {
      const form = new FormData();
      form.append('file', chosen, chosen.name);

      const response = await fetch(
        '/api/image/preview',
        {
          method: 'POST',
          body: form,
          signal: controller.signal
        }
      );

      if (!response.ok) {
        let reason =
          `Preview failed (HTTP ${response.status}).`;

        try {
          const data = await response.json();

          if (typeof data.detail === 'string') {
            reason = data.detail;
          }
        } catch {
          // Keep the HTTP error if JSON is unavailable.
        }

        throw new Error(reason);
      }

      const blob = await response.blob();

      if (
        !blob.size ||
        !blob.type.startsWith('image/')
      ) {
        throw new Error(
          'The server returned an invalid preview image.'
        );
      }

      if (
        token !== photoRequest ||
        controller.signal.aborted
      ) {
        return;
      }

      if (compatiblePreviewUrl) {
        URL.revokeObjectURL(compatiblePreviewUrl);
      }

      compatiblePreviewUrl =
        URL.createObjectURL(blob);

      usingCompatiblePreview = true;

      // Only the preview is converted.
      // The original photo remains in `file`.
      ui.photoPreview.src = compatiblePreviewUrl;

      ui.uploadMessage.textContent = '';

    } catch (error) {
      if (
        controller.signal.aborted ||
        token !== photoRequest
      ) {
        return;
      }

      ui.uploadMessage.textContent =
        error.message || 'Could not preview this image.';

      console.error(
        '[BengaliWatermark] Compatible preview:',
        error
      );

    } finally {
      if (previewAbort === controller) {
        previewAbort = null;
      }
    }
  }


  // --------------------------------------------------
  // PHOTO UPLOAD
  // --------------------------------------------------


  function loadPhoto(chosen) {
    if (!chosen) return;

    const allowed =
      /\.(jpe?g|png|webp|heic|heif)$/i;

    const imageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/pjpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif'
    ];

    if (
      !allowed.test(chosen.name) &&
      !imageTypes.includes(chosen.type)
    ) {
      ui.uploadMessage.textContent =
        'Choose a JPG, JPEG, PNG, WebP, HEIC, or HEIF photograph.';
      return;
    }

    if (
      !chosen.size ||
      chosen.size > 50 * 1024 * 1024
    ) {
      ui.uploadMessage.textContent =
        'Maximum photo size is 50 MB.';
      return;
    }

    clearPhoto(false);

    // The original image is always used for
    // EXIF metadata and final downloading.
    file = chosen;

    const token = photoRequest;

    const appleImage =
      /\.(heic|heif)$/i.test(chosen.name) ||
      ['image/heic', 'image/heif'].includes(chosen.type);

    ui.photoDateTime.value = '';
    void updateDate();

    ui.fileName.textContent = chosen.name;

    ui.fileDetails.textContent =
      `${(chosen.size / 1048576).toFixed(2)} MB`;

    ui.removePhoto.disabled = false;

    objectUrl = URL.createObjectURL(chosen);
    const originalUrl = objectUrl;

    // Photo preview successfully loaded.
    ui.photoPreview.onload = () => {
      if (
        token !== photoRequest ||
        originalUrl !== objectUrl
      ) {
        return;
      }

      ui.photoFrame.hidden = false;
      ui.emptyPreview.hidden = true;

      ui.uploadMessage.textContent = '';

      ui.fileDetails.textContent =
        `${ui.photoPreview.naturalWidth} × ` +
        `${ui.photoPreview.naturalHeight} · ` +
        `${(chosen.size / 1048576).toFixed(2)} MB`;

      scheduleLayout();
      refreshDownload();
    };

    // If the browser cannot display the image,
    // request a converted preview from FastAPI.
    ui.photoPreview.onerror = () => {
      if (token !== photoRequest) {
        return;
      }

      if (!usingCompatiblePreview) {
        void loadCompatiblePreview(chosen, token);
      } else {
        ui.uploadMessage.textContent =
          'The converted preview could not be displayed. ' +
          'Try another photograph.';
      }
    };

    if (appleImage) {
      // Most browsers cannot display HEIC directly.
      void loadCompatiblePreview(chosen, token);
    } else {
      // Native JPEG, PNG and WebP first.
      ui.photoPreview.src = originalUrl;
    }

    // Always read EXIF from the original file.
    void fetchMetadata(chosen, token);
  }

  // --------------------------------------------------
  // RESPONSIVE PREVIEW HEIGHT — VERSION 1.5.1
  // --------------------------------------------------

  function updatePreviewHeight() {
    const css = getComputedStyle(
      ui.previewStage
    );

    const available =
      ui.previewStage.clientHeight -
      parseFloat(css.paddingTop || 0) -
      parseFloat(css.paddingBottom || 0);

    ui.previewStage.style.setProperty(
      '--fit-photo-height',
      `${Math.max(24, available)}px`
    );

    scheduleLayout();
  }

  // --------------------------------------------------
  // FIT LONG TEXT INSIDE THE PHOTO
  // --------------------------------------------------

  function fitPreviewText(element, maxWidth) {
    if (
      element.hidden ||
      !element.textContent
    ) {
      return;
    }

    element.style.fontSize = '';

    let size = parseFloat(
      getComputedStyle(element).fontSize
    );

    while (
      element.scrollWidth > maxWidth &&
      size > 7
    ) {
      size = Math.max(
        7,
        size - 0.5
      );

      element.style.fontSize = `${size}px`;
    }
  }

  // --------------------------------------------------
  // THREE INDEPENDENT WATERMARK POSITIONS
  // --------------------------------------------------

  function frameSize() {
    const rect =
      ui.photoPreview.getBoundingClientRect();

    return {
      w: rect.width,
      h: rect.height
    };
  }

  function place(name, x, y) {
    const el = els[name];
    const { w, h } = frameSize();

    if (!w || !h || el.hidden) {
      return;
    }

    const bounds =
      el.getBoundingClientRect();

    const maxX = Math.max(
      0,
      1 - bounds.width / w
    );

    const maxY = Math.max(
      0,
      1 - bounds.height / h
    );

    const px = clamp(x, 0, maxX);
    const py = clamp(y, 0, maxY);

    el.style.left = `${px * 100}%`;
    el.style.top = `${py * 100}%`;

    return {
      x: px,
      y: py
    };
  }

  function layout() {
    layoutQueued = false;

    if (ui.photoFrame.hidden) {
      return;
    }

    const { w, h } = frameSize();

    if (!w || !h) {
      return;
    }

    const marginX = w * 0.035;
    const marginY = h * 0.035;
    const gap = 1;

    const sig = els.signature;
    const dt = els.date;
    const loc = els.location;

    // Keep both text layers inside narrow previews.
    fitPreviewText(dt, w * 0.92);
    fitPreviewText(loc, w * 0.92);

    const dw = dt.offsetWidth;
    const dh = dt.offsetHeight;
    const sw = sig.offsetWidth;
    const sh = sig.offsetHeight;

    const alignment =
      selected('alignment') || 'left';

    const alignX = elWidth => {
      if (alignment === 'left') {
        return marginX;
      }

      if (alignment === 'center') {
        return (w - elWidth) / 2;
      }

      return w - marginX - elWidth;
    };

    // ---------------------------------------------
    // AUTOMATIC SIGNATURE / TIMESTAMP ALIGNMENT
    // ---------------------------------------------

    const groupWidth = Math.max(sw, dw);
    const groupX = alignX(groupWidth);

    let signatureX = groupX;
    let dateX = groupX;

    // Keep both left-aligned when the timestamp
    // is more than 30% wider than the signature.
    const dateMuchWider = dw > sw * 1.30;

    if (!dateMuchWider) {

      if (sw > dw) {
        // Signature is wider:
        // Center the shorter timestamp beneath it.
        dateX += (sw - dw) / 2;

      } else if (dw > sw) {
        // Timestamp is wider by 30% or less:
        // Center the shorter signature above it.
        signatureX += (dw - sw) / 2;
      }
    }

    const defaultSig = {
      x: signatureX / w,
      y: (
        h - marginY - dh - gap - sh
      ) / h
    };

    const defaultDate = {
      x: dateX / w,
      y: (h - marginY - dh) / h
    };

    const sigPos = positions.signature || defaultSig;
    const datePos = positions.date || defaultDate;

    place(
      'signature',
      sigPos.x,
      sigPos.y
    );

    place(
      'date',
      datePos.x,
      datePos.y
    );

    if (!loc.hidden) {
      const lw = loc.offsetWidth;
      const lh = loc.offsetHeight;

      const defaultLoc = {
        x: (w - marginX - lw) / w,
        y: (h - marginY - lh) / h
      };

      const locPos =
        positions.location || defaultLoc;

      if (!positions.location) {
        // Avoid overlap when date is right-aligned.
        const dateLeft = datePos.x * w;
        const dateRight = dateLeft + dw;
        const locLeft = defaultLoc.x * w;

        if (
          dateRight > locLeft &&
          dateLeft < locLeft + lw &&
          alignment === 'right'
        ) {
          defaultLoc.y = Math.max(
            0,
            (
              sigPos.y * h - lh - gap
            ) / h
          );
        }
      }

      place(
        'location',
        locPos.x,
        locPos.y
      );
    }
  }

  function scheduleLayout() {
    if (layoutQueued) {
      return;
    }

    layoutQueued = true;
    requestAnimationFrame(layout);
  }

  function resetLayout() {
    for (const name of Object.keys(positions)) {
      positions[name] = null;
    }

    scheduleLayout();
  }

  // --------------------------------------------------
  // DRAG ELEMENTS USING MOUSE OR TOUCH
  // --------------------------------------------------

  function startDrag(event) {
    if (
      !ui.freeMove.checked ||
      ui.photoFrame.hidden ||
      event.button > 0
    ) {
      return;
    }

    const element = event.currentTarget;
    const name = element.dataset.drag;

    if (element.hidden) {
      return;
    }

    event.preventDefault();

    const original =
      element.getBoundingClientRect();

    const { w, h } = frameSize();

    const frameRect =
      ui.photoFrame.getBoundingClientRect();

    const offsetX =
      event.clientX - original.left;

    const offsetY =
      event.clientY - original.top;

    try {
      element.setPointerCapture(
        event.pointerId
      );
    } catch {
      // Pointer capture may be unavailable.
    }

    const move = e => {
      const left =
        e.clientX -
        frameRect.left -
        offsetX;

      const top =
        e.clientY -
        frameRect.top -
        offsetY;

      positions[name] = place(
        name,
        left / w,
        top / h
      );
    };

    const done = () => {
      element.removeEventListener(
        'pointermove',
        move
      );

      element.removeEventListener(
        'pointerup',
        done
      );

      element.removeEventListener(
        'pointercancel',
        done
      );
    };

    element.addEventListener(
      'pointermove',
      move
    );

    element.addEventListener(
      'pointerup',
      done
    );

    element.addEventListener(
      'pointercancel',
      done
    );
  }

  // --------------------------------------------------
  // DOWNLOAD BUTTON
  // --------------------------------------------------

  function refreshDownload() {
    ui.downloadButton.disabled = !(
      file &&
      !ui.photoFrame.hidden &&
      !ui.signaturePreview.hidden &&
      ui.signaturePreview.naturalWidth > 0 &&
      dateReady &&
      !exporting
    );
  }

  function geometry() {
    const photo =
      ui.photoPreview.getBoundingClientRect();

    if (!photo.width || !photo.height) {
      throw new Error(
        'Photo preview is not ready.'
      );
    }

    const rect = name =>
      els[name].getBoundingClientRect();

    const xy = name => {
      const r = rect(name);

      return {
        x: clamp(
          (r.left - photo.left) / photo.width,
          0,
          1
        ),
        y: clamp(
          (r.top - photo.top) / photo.height,
          0,
          1
        )
      };
    };

    const sign = xy('signature');
    const date = xy('date');
    const loc = xy('location');

    return {
      signature_width_ratio:
        rect('signature').width / photo.width,

      font_size_ratio:
        parseFloat(
          getComputedStyle(els.date).fontSize
        ) / photo.width,

      location_font_size_ratio:
        parseFloat(
          getComputedStyle(els.location).fontSize
        ) / photo.width,

      signature_x: sign.x,
      signature_y: sign.y,

      date_x: date.x,
      date_y: date.y,

      location_x: loc.x,
      location_y: loc.y
    };
  }

  // --------------------------------------------------
  // FINAL IMAGE EXPORT
  // --------------------------------------------------

  async function download() {
    if (
      ui.downloadButton.disabled ||
      !file
    ) {
      return;
    }

    exporting = true;
    refreshDownload();

    ui.downloadLabel.textContent =
      'Rendering image…';

    ui.downloadStatus.textContent =
      'Preparing full-resolution photo…';

    try {
      const form = new FormData();

      form.append(
        'file',
        file,
        file.name
      );

      const data = {
        captured_at: ui.photoDateTime.value,
        language: selected('language'),
        calendar: selected('calendar'),
        signature: selected('signature'),

        bold: String(
          ui.boldDate.checked
        ),

        font_name:
          activeFont[selected('language')] || '',

        location_font_name:
          activeFont[locationLanguage()] || '',

        location_text: currentLocation(),

        date_text: ui.dateText.value.trim(),

        ...geometry()
      };

      for (
        const [key, value] of Object.entries(data)
      ) {
        form.append(
          key,
          String(value)
        );
      }

      const response = await fetch(
        '/api/image/render',
        {
          method: 'POST',
          body: form
        }
      );

      if (!response.ok) {
        let msg =
          `Rendering failed: HTTP ${response.status}`;

        try {
          const body = await response.json();

          if (typeof body.detail === 'string') {
            msg = body.detail;
          }
        } catch {
          // Retain HTTP status on non-JSON errors.
        }

        throw new Error(msg);
      }

      const mime = (
        response.headers.get(
          'content-type'
        ) || ''
      ).split(';')[0];

      const supported = [
        'image/jpeg',
        'image/png',
        'image/webp'
      ];

      if (!supported.includes(mime)) {
        throw new Error(
          'Invalid image response from server.'
        );
      }

      const blob = await response.blob();

      if (!blob.size) {
        throw new Error(
          'Output image is empty.'
        );
      }

      const ext =
        mime === 'image/png'
          ? 'png'
          : mime === 'image/webp'
            ? 'webp'
            : 'jpg';

      const name = (
        file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[^A-Za-z0-9_-]+/g, '_')
          .slice(0, 70) || 'photo'
      ) + `_watermarked.${ext}`;

      const url =
        URL.createObjectURL(blob);

      const anchor =
        document.createElement('a');

      anchor.href = url;
      anchor.download = name;

      document.body.append(anchor);

      anchor.click();
      anchor.remove();

      setTimeout(
        () => URL.revokeObjectURL(url),
        30000
      );

      ui.downloadStatus.textContent =
        `Download started: ${name}`;

      log(
        'Rendered image',
        blob.size,
        'bytes',
        data
      );

    } catch (error) {
      ui.downloadStatus.textContent =
        error.message;

      console.error(
        '[BengaliWatermark] Export:',
        error
      );

    } finally {
      exporting = false;

      ui.downloadLabel.textContent =
        'Download photograph';

      refreshDownload();
    }
  }

  // --------------------------------------------------
  // PORTRAIT ORIENTATION SUGGESTION
  // --------------------------------------------------

  const advancedPanel = $('advancedPanel');

  const portraitMode =
    window.matchMedia('(orientation: portrait)');

  let orientationHintDismissed = false;

  function refreshOrientationTip() {
    if (!ui.orientationTip) return;

    ui.orientationTip.hidden = !(
      advancedPanel.open &&
      portraitMode.matches &&
      !orientationHintDismissed
    );
  }

  advancedPanel.addEventListener(
    'toggle',
    () => {
      if (advancedPanel.open) {
        orientationHintDismissed = false;
      }

      refreshOrientationTip();
    }
  );

  portraitMode.addEventListener(
    'change',
    refreshOrientationTip
  );

  ui.dismissOrientationTip?.addEventListener(
    'click',
    () => {
      orientationHintDismissed = true;
      refreshOrientationTip();
    }
  );

  // --------------------------------------------------
  // EVENT LISTENERS
  // --------------------------------------------------

  ui.choosePhoto.addEventListener(
    'click',
    () => ui.photoInput.click()
  );

  // Allow clicking anywhere inside the empty photo area.
  ui.emptyPreview.addEventListener('click', event => {
    if (event.target.closest('button')) {
      return;
    }

    ui.photoInput.click();
  });

  ui.replacePhoto.addEventListener(
    'click',
    () => ui.photoInput.click()
  );

  ui.photoInput.addEventListener(
    'change',
    () => {
      if (ui.photoInput.files?.[0]) {
        loadPhoto(
          ui.photoInput.files[0]
        );
      }
    }
  );

  ui.removePhoto.addEventListener(
    'click',
    () => clearPhoto()
  );

  ui.previewStage.addEventListener(
    'dragover',
    e => e.preventDefault()
  );

  ui.previewStage.addEventListener(
    'drop',
    e => {
      e.preventDefault();

      if (e.dataTransfer?.files?.[0]) {
        loadPhoto(
          e.dataTransfer.files[0]
        );
      }
    }
  );

  window.addEventListener(
    'dragover',
    e => {
      if (
        e.dataTransfer?.types?.includes('Files')
      ) {
        e.preventDefault();
      }
    }
  );

  window.addEventListener(
    'drop',
    e => {
      if (
        e.dataTransfer?.types?.includes('Files')
      ) {
        e.preventDefault();
      }
    }
  );

  ui.photoDateTime.addEventListener(
    'input',
    () => {
      if (metaPending) {
        manualDateEdited = true;
      }

      void updateDate();
    }
  );

  ui.dateText.addEventListener(
    'input',
    () => void updateDate()
  );

  ui.locationText.addEventListener(
    'input',
    () => {
      if (ui.locationText.value.trim()) {
        ui.showLocation.checked = true;
      }

      updateLocation();
    }
  );

  ui.showLocation.addEventListener(
    'change',
    updateLocation
  );

  ui.panjikaToggle.addEventListener('change', () => {
    const mode = ui.panjikaToggle.checked
      ? 'panjika'
      : 'gregorian';

    document.querySelector(
      `input[name="calendar"][value="${mode}"]`
    ).checked = true;

    void updateDate();
  });

  ui.boldDate.addEventListener(
    'change',
    () => {
      ui.watermarkDate.classList.toggle(
        'is-bold',
        ui.boldDate.checked
      );

      void applyFont();
      scheduleLayout();
    }
  );

  document.querySelectorAll(
    'input[name="language"],input[name="calendar"]'
  ).forEach(input => {
    input.addEventListener(
      'change',
      () => {
        updateCalendarControls();
        updateLocation();
      }
    );
  });

  document.querySelectorAll(
    'input[name="signature"]'
  ).forEach(input => {
    input.addEventListener(
      'change',
      updateSignature
    );
  });

  document.querySelectorAll(
    'input[name="alignment"]'
  ).forEach(input => {
    input.addEventListener(
      'change',
      resetLayout
    );
  });

  ui.freeMove.addEventListener(
    'change',
    () => {
      ui.photoFrame.classList.toggle(
        'drag-enabled',
        ui.freeMove.checked
      );
    }
  );

  ui.resetPosition.addEventListener(
    'click',
    resetLayout
  );

  for (const el of Object.values(els)) {
    el.addEventListener(
      'pointerdown',
      startDrag
    );
  }

  ui.downloadButton.addEventListener(
    'click',
    () => void download()
  );

  // --------------------------------------------------
  // RESPONSIVE RESIZE OBSERVERS
  // --------------------------------------------------

  if (
    typeof ResizeObserver !== 'undefined'
  ) {
    new ResizeObserver(
      scheduleLayout
    ).observe(ui.photoPreview);

    new ResizeObserver(
      updatePreviewHeight
    ).observe(ui.previewStage);
  }

  window.addEventListener(
    'resize',
    updatePreviewHeight
  );

  requestAnimationFrame(
    updatePreviewHeight
  );

  // --------------------------------------------------
  // CLEANUP
  // --------------------------------------------------

  window.addEventListener(
    'pagehide',
    () => {
      dateAbort?.abort();
      metaAbort?.abort();

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  );

  // --------------------------------------------------
  // STARTUP
  // --------------------------------------------------

  ui.photoDateTime.value =
    localValue(new Date());

  updateCalendarControls();
  updateSignature();
  updateLocation();
  refreshDownload();

  void fetchFonts();

  log(
    'Version 1.5.1 interface initialized'
  );

})();
