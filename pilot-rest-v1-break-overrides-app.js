"use strict";

const MINUTES_PER_DAY = 1440;
const SHARED_SCHEDULE_VERSION = 3;
const SETTINGS_KEY = "pilot-rest-settings-v1";
const INPUTS_KEY = "pilot-rest-inputs-v1";
const DEFAULT_SETTINGS = Object.freeze({
  defaultModel: "burn",
  crewCount: 3,
  breaksPerPilot: 1,
  alarmOffset: 15,
  climbModifier: 20,
  descentModifier: 40,
  burnBuffer: 0,
  tocModifier: 5,
  todModifier: 15,
  acBuffer: 0,
  roundToFive: false,
  rememberInputs: true
});

const els = Object.fromEntries(
  [
    "calculatorView", "settingsView", "calculatorForm", "settingsForm", "burnModelFields",
    "acModelFields", "activeModelName", "startTimeLabel", "burnHours", "burnMinutes",
    "tocHours", "tocMinutes", "todHours", "todMinutes", "startHours", "startMinutes", "firstOverrideEnabled",
    "firstOverrideHours", "firstOverrideMinutes", "secondOverridePanel", "secondOverrideEnabled",
    "secondOverrideHours", "secondOverrideMinutes", "currentUtc", "deviceClock",
    "deviceOffset", "deviceMessage", "usableRest", "totalPerPilot", "periodUsed", "slotCount",
    "scheduleContext", "scheduleBody", "shareStatus", "installStatus", "copyButton",
    "shareAppButton", "downloadButton", "shareButton", "resetButton", "startNowButton",
    "openSettingsButton", "settingsModel", "settingsModelState", "settingsCrew",
    "settingsBreaks", "settingsAlarmOffset", "rememberInputs", "settingsClimb",
    "settingsDescent", "settingsBurnBuffer", "settingsTocModifier", "settingsTodModifier",
    "settingsAcBuffer", "roundToFive", "roundFiveState", "saveSettingsButton",
    "resetSettingsButton", "settingsStatus"
  ].map((id) => [id, document.querySelector(`#${id}`)])
);

let settings = loadSettings();
let activeModel = settings.defaultModel;
let activeFlightDate = todayUtcIsoDate();
let activeBufferOverride = null;
let activeModifierOverride = null;
let activeRoundingOverride = null;
let actualStartWasManuallyEdited = false;
let latestResult = null;

init();

function init() {
  populatePickers();
  hydrateSettingsForm(settings);
  hydrateCalculatorDefaults(false);
  const importedSchedule = importSharedSchedule();
  if (!importedSchedule && settings.rememberInputs) {
    restoreRememberedInputs();
  }
  bindEvents();
  updateModelUi();
  registerServiceWorker();
  render();
  if (importedSchedule) {
    setStatus("Shared schedule imported. Adjust Alarm Offset for this device.");
  }
  setInterval(updateDeviceClock, 15000);
}

function populatePickers() {
  [
    [els.startHours, els.startMinutes],
    [els.tocHours, els.tocMinutes],
    [els.todHours, els.todMinutes]
  ].forEach(([hours, minutes]) => populateClockPicker(hours, minutes));
  [
    [els.burnHours, els.burnMinutes],
    [els.firstOverrideHours, els.firstOverrideMinutes],
    [els.secondOverrideHours, els.secondOverrideMinutes]
  ].forEach(([hours, minutes]) => populateDurationPicker(hours, minutes));

  populateMinutePicker(els.settingsClimb, 120);
  populateMinutePicker(els.settingsDescent, 120);
  populateMinutePicker(els.settingsBurnBuffer, 120);
  populateMinutePicker(els.settingsTocModifier, 120);
  populateMinutePicker(els.settingsTodModifier, 120);
  populateMinutePicker(els.settingsAcBuffer, 120);
  populateAlarmPicker(els.settingsAlarmOffset);
}

function populateClockPicker(hoursElement, minutesElement) {
  hoursElement.innerHTML = range(0, 23)
    .map((value) => `<option value="${value}">${String(value).padStart(2, "0")}</option>`)
    .join("");
  minutesElement.innerHTML = range(0, 59)
    .map((value) => `<option value="${value}">${String(value).padStart(2, "0")}</option>`)
    .join("");
}

function populateDurationPicker(hoursElement, minutesElement) {
  hoursElement.innerHTML = range(0, 24)
    .map((value) => `<option value="${value}">${value}</option>`)
    .join("");
  minutesElement.innerHTML = range(0, 59)
    .map((value) => `<option value="${value}">${String(value).padStart(2, "0")}</option>`)
    .join("");
}

function populateMinutePicker(element, maximum) {
  element.innerHTML = range(0, maximum)
    .map((value) => `<option value="${value}">${value} min</option>`)
    .join("");
}

function populateAlarmPicker(element) {
  element.innerHTML = range(0, 59)
    .map((value) => `<option value="${value}">${value === 0 ? "0" : `-${String(value).padStart(2, "0")} min`}</option>`)
    .join("");
}

function bindEvents() {
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  els.openSettingsButton.addEventListener("click", () => switchView("settings"));
  els.calculatorForm.addEventListener("input", handleCalculatorChange);
  els.calculatorForm.addEventListener("change", handleCalculatorChange);
  els.copyButton.addEventListener("click", copySchedule);
  els.shareAppButton.addEventListener("click", shareAppSchedule);
  els.downloadButton.addEventListener("click", downloadPdf);
  els.shareButton.addEventListener("click", sharePdf);
  els.startNowButton.addEventListener("click", () => {
    actualStartWasManuallyEdited = true;
    setStartToCurrentUtc();
    renderAndRemember();
  });
  els.resetButton.addEventListener("click", () => {
    activeFlightDate = todayUtcIsoDate();
    activeBufferOverride = null;
    activeModifierOverride = null;
    activeRoundingOverride = null;
    actualStartWasManuallyEdited = false;
    hydrateCalculatorDefaults(true);
    renderAndRemember();
  });
  els.saveSettingsButton.addEventListener("click", saveSettings);
  els.resetSettingsButton.addEventListener("click", restoreDefaultSettings);
  els.settingsModel.addEventListener("change", updateSettingsSwitchLabels);
  els.roundToFive.addEventListener("change", updateSettingsSwitchLabels);
}

function switchView(view) {
  const showSettings = view === "settings";
  els.calculatorView.classList.toggle("is-hidden", showSettings);
  els.settingsView.classList.toggle("is-hidden", !showSettings);
  document.querySelectorAll(".view-tab").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (showSettings) {
    hydrateSettingsForm(settings);
    els.settingsStatus.textContent = "";
  }
}

function handleCalculatorChange(event) {
  if (event.target === els.startHours || event.target === els.startMinutes) {
    actualStartWasManuallyEdited = true;
  }
  if (
    activeModel === "ac" &&
    !actualStartWasManuallyEdited &&
    [els.tocHours, els.tocMinutes].includes(event.target)
  ) {
    syncActualStartToAdjustedToc();
  }
  updateSecondOverrideVisibility(Number(getRadioValue("breaksPerPilot")));
  renderAndRemember();
}

function hydrateCalculatorDefaults(resetToZero) {
  setClockPicker(els.startHours, els.startMinutes, resetToZero ? 0 : 12 * 60 + 55);
  setDurationPicker(els.burnHours, els.burnMinutes, resetToZero ? 0 : 9 * 60);
  setClockPicker(els.tocHours, els.tocMinutes, resetToZero ? 0 : 8 * 60 + 55);
  setClockPicker(els.todHours, els.todMinutes, resetToZero ? 0 : 12 * 60 + 15);
  setRadioValue("crewCount", settings.crewCount);
  setRadioValue("breaksPerPilot", settings.breaksPerPilot);
  setOverridePicker(els.firstOverrideEnabled, els.firstOverrideHours, els.firstOverrideMinutes, null);
  setOverridePicker(els.secondOverrideEnabled, els.secondOverrideHours, els.secondOverrideMinutes, null);
  updateSecondOverrideVisibility(settings.breaksPerPilot);
  if (activeModel === "ac" && !resetToZero) {
    syncActualStartToAdjustedToc();
  }
}

function updateModelUi() {
  const isAc = activeModel === "ac";
  els.burnModelFields.classList.toggle("is-hidden", isAc);
  els.acModelFields.classList.toggle("is-hidden", !isAc);
  els.activeModelName.textContent = getModelLabel(activeModel);
  els.startTimeLabel.textContent = isAc ? "Actual Start Time (UTC)" : "Start time UTC";
}

function syncActualStartToAdjustedToc() {
  setClockPicker(
    els.startHours,
    els.startMinutes,
    getClockMinutes(els.tocHours, els.tocMinutes) + getCalculationModifiers().toc
  );
}

function setStartToCurrentUtc() {
  const now = new Date();
  els.startHours.value = String(now.getUTCHours());
  els.startMinutes.value = String(now.getUTCMinutes());
  activeFlightDate = todayUtcIsoDate();
}

function updateSecondOverrideVisibility(breaksPerPilot) {
  const visible = breaksPerPilot === 2;
  els.secondOverridePanel.classList.toggle("is-hidden", !visible);
  if (!visible) {
    els.secondOverrideEnabled.checked = false;
  }
}

function readInputs() {
  const modelBuffer = activeModel === "burn" ? settings.burnBuffer : settings.acBuffer;
  const modifiers = getCalculationModifiers();
  return {
    model: activeModel,
    modelLabel: getModelLabel(activeModel),
    flightDate: activeFlightDate,
    startMinutes: getClockMinutes(els.startHours, els.startMinutes),
    burnMinutes: getDurationMinutes(els.burnHours, els.burnMinutes),
    climbModifierMinutes: modifiers.climb,
    descentModifierMinutes: modifiers.descent,
    estimatedTocMinutes: getClockMinutes(els.tocHours, els.tocMinutes),
    estimatedTodMinutes: getClockMinutes(els.todHours, els.todMinutes),
    tocModifierMinutes: modifiers.toc,
    todModifierMinutes: modifiers.tod,
    extraBufferMinutes: activeBufferOverride ?? modelBuffer,
    roundToFive: activeRoundingOverride ?? settings.roundToFive,
    crewCount: Number(getRadioValue("crewCount")),
    breaksPerPilot: Number(getRadioValue("breaksPerPilot")),
    firstOverrideMinutes: els.firstOverrideEnabled.checked
      ? getDurationMinutes(els.firstOverrideHours, els.firstOverrideMinutes)
      : null,
    secondOverrideMinutes:
      els.secondOverrideEnabled.checked && Number(getRadioValue("breaksPerPilot")) === 2
        ? getDurationMinutes(els.secondOverrideHours, els.secondOverrideMinutes)
        : null,
    alarmOffsetMinutes: -Math.abs(settings.alarmOffset),
    deviceTimeZone: getDeviceTimeZone()
  };
}

function getCalculationModifiers() {
  return activeModifierOverride ?? {
    climb: settings.climbModifier,
    descent: settings.descentModifier,
    toc: settings.tocModifier,
    tod: settings.todModifier
  };
}

function calculateRest(inputs) {
  let usableRestMinutes;
  let adjustedTocMinutes = null;
  let adjustedTodMinutes = null;
  if (inputs.model === "burn") {
    usableRestMinutes = Math.max(
      inputs.burnMinutes - inputs.climbModifierMinutes - inputs.descentModifierMinutes - inputs.extraBufferMinutes,
      0
    );
  } else {
    adjustedTocMinutes = inputs.estimatedTocMinutes + inputs.tocModifierMinutes;
    adjustedTodMinutes = inputs.estimatedTodMinutes - inputs.todModifierMinutes;
    usableRestMinutes = Math.max(
      calculateWindowMinutes(adjustedTocMinutes, adjustedTodMinutes) - inputs.extraBufferMinutes,
      0
    );
  }

  const unroundedTotalRestPerPilot = inputs.crewCount === 4
    ? Math.floor(usableRestMinutes / 2)
    : Math.floor(usableRestMinutes / 3);
  const totalRestPerPilot = inputs.roundToFive
    ? roundDownToFive(unroundedTotalRestPerPilot)
    : unroundedTotalRestPerPilot;
  const unroundedCalculatedPeriod = Math.floor(totalRestPerPilot / inputs.breaksPerPilot);
  const calculatedPeriod = inputs.roundToFive
    ? roundDownToFive(unroundedCalculatedPeriod)
    : unroundedCalculatedPeriod;
  const restGroupCount = inputs.crewCount === 4 ? 2 : 3;
  const slotCount = restGroupCount * inputs.breaksPerPilot;
  const firstBreakDuration = inputs.firstOverrideMinutes ?? calculatedPeriod;
  const secondBreakDuration = inputs.breaksPerPilot === 2
    ? (inputs.secondOverrideMinutes ?? Math.max(totalRestPerPilot - firstBreakDuration, 0))
    : null;
  const restPeriodSummary = inputs.breaksPerPilot === 2
    ? `${formatDuration(firstBreakDuration)} / ${formatDuration(secondBreakDuration)}`
    : formatDuration(firstBreakDuration);
  let restCursorUtc = dateAndMinutesToUtc(inputs.flightDate, inputs.startMinutes);
  const rows = Array.from({ length: slotCount }, (_, index) => {
    const durationMinutes = inputs.breaksPerPilot === 2 && index >= restGroupCount
      ? secondBreakDuration
      : firstBreakDuration;
    const restStartUtc = restCursorUtc;
    const restEndUtc = addMinutes(restStartUtc, durationMinutes);
    const deviceAlarm = addMinutes(restEndUtc, inputs.alarmOffsetMinutes);
    restCursorUtc = restEndUtc;
    return { label: `Break ${index + 1}`, restStartUtc, restEndUtc, deviceAlarm, durationMinutes };
  });
  return {
    inputs, usableRestMinutes, adjustedTocMinutes, adjustedTodMinutes, totalRestPerPilot,
    calculatedPeriod, firstBreakDuration, secondBreakDuration, restPeriodSummary, slotCount, rows
  };
}

function renderAndRemember() {
  render();
  rememberInputs();
}

function render() {
  latestResult = calculateRest(readInputs());
  els.usableRest.textContent = formatDuration(latestResult.usableRestMinutes);
  els.totalPerPilot.textContent = formatDuration(latestResult.totalRestPerPilot);
  els.periodUsed.textContent = latestResult.restPeriodSummary;
  els.slotCount.textContent = String(latestResult.slotCount);
  els.scheduleContext.textContent = buildScheduleContext(latestResult);
  els.scheduleBody.innerHTML = latestResult.rows.map((row) => `<tr>
    <td>${row.label}</td><td>${formatUtcTime(row.restStartUtc)}</td><td>${formatUtcTime(row.restEndUtc)}</td>
    <td>${formatDeviceTime(row.deviceAlarm)}</td><td>${formatDuration(row.durationMinutes)}</td>
  </tr>`).join("");
  updateDeviceClock();
  els.shareStatus.textContent = "";
}

function buildScheduleContext(result) {
  const device = `${result.inputs.deviceTimeZone} (${formatOffsetForDate(new Date())})`;
  const rounding = result.inputs.roundToFive ? " Calculated rest rounded down to 5 minutes." : "";
  if (result.inputs.model === "burn") {
    return `${result.inputs.modelLabel}: ${formatDuration(result.inputs.burnMinutes)} minus ${result.inputs.climbModifierMinutes} min climb, ${result.inputs.descentModifierMinutes} min descent${formatExtraBuffer(result.inputs.extraBufferMinutes)}.${rounding} Device alarms use ${device}.`;
  }
  return `${result.inputs.modelLabel}: ${formatClockMinutes(result.adjustedTocMinutes)} to ${formatClockMinutes(result.adjustedTodMinutes)} UTC${formatExtraBuffer(result.inputs.extraBufferMinutes)}.${rounding} Device alarms use ${device}.`;
}

function formatExtraBuffer(minutes) {
  return minutes > 0 ? ` and ${minutes} min additional buffer` : "";
}

function updateDeviceClock() {
  const now = new Date();
  els.deviceClock.textContent = formatDeviceTime(now);
  els.currentUtc.textContent = formatUtcClock(now);
  els.deviceOffset.textContent = formatOffsetForDate(now);
  els.deviceMessage.textContent = "Device alarm times are calculated from the current device clock.";
}

function hydrateSettingsForm(value) {
  els.settingsModel.checked = value.defaultModel === "ac";
  els.settingsCrew.value = String(value.crewCount);
  els.settingsBreaks.value = String(value.breaksPerPilot);
  els.settingsAlarmOffset.value = String(value.alarmOffset);
  els.rememberInputs.checked = value.rememberInputs;
  els.settingsClimb.value = String(value.climbModifier);
  els.settingsDescent.value = String(value.descentModifier);
  els.settingsBurnBuffer.value = String(value.burnBuffer);
  els.settingsTocModifier.value = String(value.tocModifier);
  els.settingsTodModifier.value = String(value.todModifier);
  els.settingsAcBuffer.value = String(value.acBuffer);
  els.roundToFive.checked = value.roundToFive;
  updateSettingsSwitchLabels();
}

function updateSettingsSwitchLabels() {
  els.settingsModelState.textContent = els.settingsModel.checked ? "TOC / TOD" : "Burn Time";
  els.roundFiveState.textContent = els.roundToFive.checked
    ? "Round down to nearest 5 minutes"
    : "Exact minutes";
}

function readSettingsForm() {
  return normalizeSettings({
    defaultModel: els.settingsModel.checked ? "ac" : "burn",
    crewCount: Number(els.settingsCrew.value),
    breaksPerPilot: Number(els.settingsBreaks.value),
    alarmOffset: Number(els.settingsAlarmOffset.value),
    rememberInputs: els.rememberInputs.checked,
    climbModifier: Number(els.settingsClimb.value),
    descentModifier: Number(els.settingsDescent.value),
    burnBuffer: Number(els.settingsBurnBuffer.value),
    tocModifier: Number(els.settingsTocModifier.value),
    todModifier: Number(els.settingsTodModifier.value),
    acBuffer: Number(els.settingsAcBuffer.value),
    roundToFive: els.roundToFive.checked
  });
}

function saveSettings() {
  settings = readSettingsForm();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  activeModel = settings.defaultModel;
  activeBufferOverride = null;
  activeModifierOverride = null;
  activeRoundingOverride = null;
  actualStartWasManuallyEdited = false;
  hydrateCalculatorDefaults(false);
  updateModelUi();
  renderAndRemember();
  switchView("calculator");
  setStatus("Settings saved and applied.");
}

function restoreDefaultSettings() {
  settings = { ...DEFAULT_SETTINGS };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  localStorage.removeItem(INPUTS_KEY);
  activeModel = settings.defaultModel;
  activeBufferOverride = null;
  activeModifierOverride = null;
  activeRoundingOverride = null;
  actualStartWasManuallyEdited = false;
  hydrateSettingsForm(settings);
  hydrateCalculatorDefaults(false);
  updateModelUi();
  render();
  els.settingsStatus.textContent = "Default settings restored.";
}

function loadSettings() {
  try {
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function normalizeSettings(value) {
  const bounded = (number, maximum, fallback) => Number.isFinite(number)
    ? Math.min(Math.max(Math.round(number), 0), maximum)
    : fallback;
  return {
    defaultModel: value.defaultModel === "ac" ? "ac" : "burn",
    crewCount: Number(value.crewCount) === 4 ? 4 : 3,
    breaksPerPilot: Number(value.breaksPerPilot) === 2 ? 2 : 1,
    alarmOffset: bounded(Number(value.alarmOffset), 59, DEFAULT_SETTINGS.alarmOffset),
    climbModifier: bounded(Number(value.climbModifier), 120, DEFAULT_SETTINGS.climbModifier),
    descentModifier: bounded(Number(value.descentModifier), 120, DEFAULT_SETTINGS.descentModifier),
    burnBuffer: bounded(Number(value.burnBuffer), 120, DEFAULT_SETTINGS.burnBuffer),
    tocModifier: bounded(Number(value.tocModifier), 120, DEFAULT_SETTINGS.tocModifier),
    todModifier: bounded(Number(value.todModifier), 120, DEFAULT_SETTINGS.todModifier),
    acBuffer: bounded(Number(value.acBuffer), 120, DEFAULT_SETTINGS.acBuffer),
    roundToFive: value.roundToFive === true,
    rememberInputs: value.rememberInputs !== false
  };
}

function rememberInputs() {
  if (!settings.rememberInputs || !latestResult) {
    if (!settings.rememberInputs) localStorage.removeItem(INPUTS_KEY);
    return;
  }
  localStorage.setItem(INPUTS_KEY, JSON.stringify(buildSharedPayload(latestResult.inputs)));
}

function restoreRememberedInputs() {
  try {
    const payload = upgradeSharedPayload(JSON.parse(localStorage.getItem(INPUTS_KEY) || "null"));
    if (isValidSharedPayload(payload)) {
      payload.d = todayUtcIsoDate();
      applySharedPayload(payload);
    }
  } catch {
    localStorage.removeItem(INPUTS_KEY);
  }
}

async function copySchedule() {
  if (!latestResult) return;
  try {
    await navigator.clipboard.writeText(buildPdfLines(latestResult).join("\n"));
    setStatus("Schedule copied.");
  } catch {
    setStatus("Copy is unavailable in this browser.");
  }
}

async function shareAppSchedule() {
  if (!latestResult) return;
  const url = buildSharedScheduleUrl(latestResult.inputs);
  const shareData = { title: "Pilot Rest Schedule", text: `Open this ${latestResult.inputs.modelLabel} schedule in Pilot Rest Calculator.`, url };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
      setStatus("Share sheet opened. Choose AirDrop to send the app schedule.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    setStatus("App schedule link copied.");
  } catch {
    setStatus("App schedule sharing is unavailable in this browser.");
  }
}

function buildSharedScheduleUrl(inputs) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("schedule", encodeSharedPayload(buildSharedPayload(inputs)));
  return url.toString();
}

function buildSharedPayload(inputs) {
  return {
    v: SHARED_SCHEDULE_VERSION, m: inputs.model, d: inputs.flightDate, s: inputs.startMinutes,
    b: inputs.burnMinutes, cm: inputs.climbModifierMinutes, dm: inputs.descentModifierMinutes,
    tc: inputs.estimatedTocMinutes, td: inputs.estimatedTodMinutes, tcm: inputs.tocModifierMinutes,
    tdm: inputs.todModifierMinutes, x: inputs.extraBufferMinutes, c: inputs.crewCount,
    n: inputs.breaksPerPilot, o1: inputs.firstOverrideMinutes, o2: inputs.secondOverrideMinutes,
    r: inputs.roundToFive
  };
}

function importSharedSchedule() {
  const encoded = new URLSearchParams(window.location.search).get("schedule");
  if (!encoded) return false;
  try {
    const payload = upgradeSharedPayload(decodeSharedPayload(encoded));
    if (!isValidSharedPayload(payload)) throw new Error("Invalid payload");
    applySharedPayload(payload);
    return true;
  } catch {
    window.setTimeout(() => setStatus("This shared schedule link is invalid or incomplete."), 0);
    return false;
  }
}

function upgradeSharedPayload(payload) {
  if (payload?.v === 2) {
    return { ...payload, v: SHARED_SCHEDULE_VERSION, r: false };
  }
  if (payload?.v !== 1) return payload;
  return {
    v: SHARED_SCHEDULE_VERSION,
    m: "burn",
    d: payload.d,
    s: payload.s,
    b: payload.b,
    cm: 20,
    dm: 40,
    tc: 8 * 60 + 55,
    td: 12 * 60 + 15,
    tcm: settings.tocModifier,
    tdm: settings.todModifier,
    x: settings.burnBuffer,
    c: payload.c,
    n: payload.n,
    o1: payload.o1,
    o2: payload.o2,
    r: false
  };
}

function applySharedPayload(payload) {
  activeModel = payload.m;
  activeFlightDate = payload.d;
  activeBufferOverride = payload.x;
  activeModifierOverride = {
    climb: payload.cm,
    descent: payload.dm,
    toc: payload.tcm,
    tod: payload.tdm
  };
  activeRoundingOverride = payload.r;
  actualStartWasManuallyEdited = true;
  setClockPicker(els.startHours, els.startMinutes, payload.s);
  setDurationPicker(els.burnHours, els.burnMinutes, payload.b);
  setClockPicker(els.tocHours, els.tocMinutes, payload.tc);
  setClockPicker(els.todHours, els.todMinutes, payload.td);
  setRadioValue("crewCount", payload.c);
  setRadioValue("breaksPerPilot", payload.n);
  setOverridePicker(els.firstOverrideEnabled, els.firstOverrideHours, els.firstOverrideMinutes, payload.o1);
  setOverridePicker(els.secondOverrideEnabled, els.secondOverrideHours, els.secondOverrideMinutes, payload.o2);
  updateSecondOverrideVisibility(payload.n);
  updateModelUi();
}

function isValidSharedPayload(payload) {
  const minute = (value, maximum = 1499) => Number.isInteger(value) && value >= 0 && value <= maximum;
  const override = (value) => value === null || minute(value);
  return payload?.v === SHARED_SCHEDULE_VERSION && ["burn", "ac"].includes(payload.m) &&
    /^\d{4}-\d{2}-\d{2}$/.test(payload.d || "") && minute(payload.s, 1439) &&
    minute(payload.b) && minute(payload.cm, 120) && minute(payload.dm, 120) &&
    minute(payload.tc, 1439) && minute(payload.td, 1439) && minute(payload.tcm, 120) &&
    minute(payload.tdm, 120) && minute(payload.x, 120) && [3, 4].includes(payload.c) &&
    [1, 2].includes(payload.n) && override(payload.o1) && override(payload.o2) &&
    typeof payload.r === "boolean" && (payload.n === 2 || payload.o2 === null);
}

function encodeSharedPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeSharedPayload(encoded) {
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
}

function downloadPdf() {
  if (!latestResult) return;
  savePdfFile(createPdfFile(latestResult));
  setStatus("PDF downloaded.");
}

async function sharePdf() {
  if (!latestResult) return;
  const file = createPdfFile(latestResult);
  const data = { title: "Pilot Rest Schedule", text: `${latestResult.inputs.modelLabel} pilot rest schedule PDF`, files: [file] };
  if (navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      setStatus("Share sheet opened.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  savePdfFile(file);
  setStatus("PDF sharing is unavailable here, so the PDF was downloaded.");
}

function createPdfFile(result) {
  return new File([buildSimplePdf(buildPdfLines(result))], `pilot-rest-schedule-${todayUtcIsoDate().replaceAll("-", "")}.pdf`, { type: "application/pdf" });
}

function savePdfFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildPdfLines(result) {
  const input = result.inputs;
  const modelLines = input.model === "burn"
    ? [
        `Burn time: ${formatDuration(input.burnMinutes)}`,
        `Climb modifier: -${input.climbModifierMinutes} minutes`,
        `Descent modifier: -${input.descentModifierMinutes} minutes`
      ]
    : [
        `Estimated TOC: ${formatClockMinutes(input.estimatedTocMinutes)} UTC`,
        `TOC modifier: +${input.tocModifierMinutes} minutes`,
        `Estimated TOD: ${formatClockMinutes(input.estimatedTodMinutes)} UTC`,
        `TOD modifier: -${input.todModifierMinutes} minutes`,
        `Adjusted window: ${formatClockMinutes(result.adjustedTocMinutes)} to ${formatClockMinutes(result.adjustedTodMinutes)} UTC`
      ];
  const lines = [
    "PILOT REST SCHEDULE", "", `Calculation model: ${input.modelLabel}`, ...modelLines,
    `Additional buffer: -${input.extraBufferMinutes} minutes`, `Usable rest: ${formatDuration(result.usableRestMinutes)}`,
    `Five-minute rounding: ${input.roundToFive ? "On" : "Off"}`,
    `Start UTC: ${formatClockMinutes(input.startMinutes)} UTC`, `Crew: ${input.crewCount}`,
    `Breaks per pilot: ${input.breaksPerPilot}`, `Rest period used: ${result.restPeriodSummary}`,
    `Device time zone: ${input.deviceTimeZone} (${formatOffsetForDate(new Date())})`,
    `Alarm offset: ${input.alarmOffsetMinutes} minutes`, "",
    "Break     Rest Start UTC      Rest End UTC        Device Alarm     Duration",
    "-----     --------------      ------------        ------------     --------"
  ];
  result.rows.forEach((row) => lines.push([
    row.label.padEnd(9), formatUtcTime(row.restStartUtc).padEnd(20),
    formatUtcTime(row.restEndUtc).padEnd(20), formatDeviceTime(row.deviceAlarm).padEnd(17),
    formatDuration(row.durationMinutes)
  ].join("")));
  return lines;
}

function buildSimplePdf(lines) {
  const content = ["BT", "/F1 12 Tf", "54 756 Td", "16 TL", ...lines.map(escapePdfText)
    .flatMap((line, index) => index === 0 ? [`(${line}) Tj`] : ["T*", `(${line}) Tj`]), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function escapePdfText(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function setOverridePicker(enabled, hours, minutes, totalMinutes) {
  enabled.checked = totalMinutes !== null;
  setDurationPicker(hours, minutes, totalMinutes ?? 0);
}

function getModelLabel(model) {
  return model === "ac" ? "TOC / TOD" : "Burn Time";
}

function roundDownToFive(minutes) {
  return Math.floor(minutes / 5) * 5;
}

function setClockPicker(hours, minutes, totalMinutes) {
  const normalized = normalizeClock(totalMinutes);
  hours.value = String(Math.floor(normalized / 60));
  minutes.value = String(normalized % 60);
}

function setDurationPicker(hours, minutes, totalMinutes) {
  hours.value = String(Math.floor(totalMinutes / 60));
  minutes.value = String(totalMinutes % 60);
}

function getClockMinutes(hours, minutes) {
  return Number(hours.value) * 60 + Number(minutes.value);
}

function getDurationMinutes(hours, minutes) {
  return Number(hours.value) * 60 + Number(minutes.value);
}

function calculateWindowMinutes(start, end) {
  const duration = end - start;
  return duration < 0 ? duration + MINUTES_PER_DAY : duration;
}

function normalizeClock(minutes) {
  return ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function formatDuration(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function formatClockMinutes(minutes) {
  const normalized = normalizeClock(minutes);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function formatUtcTime(date) { return `${formatUtcClock(date)} UTC`; }
function formatUtcClock(date) { return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`; }
function formatDeviceTime(date) { return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", hour12: false }).format(date); }
function formatOffsetForDate(date) {
  const offset = -date.getTimezoneOffset();
  const absolute = Math.abs(offset);
  return `UTC${offset >= 0 ? "+" : "-"}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}
function dateAndMinutesToUtc(isoDate, minutes) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, minutes, 0, 0));
}
function addMinutes(date, minutes) { return new Date(date.getTime() + minutes * 60000); }
function range(start, end) { return Array.from({ length: end - start + 1 }, (_, index) => start + index); }
function setRadioValue(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
}
function getRadioValue(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value; }
function todayUtcIsoDate() { return new Date().toISOString().slice(0, 10); }
function getDeviceTimeZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Device local time"; }
function byteLength(text) { return new TextEncoder().encode(text).length; }
function setStatus(message) { els.shareStatus.textContent = message; }

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    els.installStatus.textContent = "Browser cache only";
    return;
  }
  navigator.serviceWorker.register("./sw.js")
    .then(() => { els.installStatus.textContent = "Offline ready"; })
    .catch(() => { els.installStatus.textContent = "Online only"; });
}
