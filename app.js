const cameraVideo = document.querySelector("#camera-video");
const cameraStage = document.querySelector("#camera-stage");
const cameraPlaceholder = document.querySelector("#camera-placeholder");
const cameraButton = document.querySelector("#camera-toggle");
const cameraStatus = document.querySelector("#camera-status");
const cameraMessage = document.querySelector("#camera-message");
const consentDialog = document.querySelector("#consent-dialog");
const consentAgreement = document.querySelector("#consent-agreement");
const consentAccept = document.querySelector("#consent-accept");
const consentStatus = document.querySelector("#consent-status");
const consentIndicator = document.querySelector("#consent-indicator");
const reviewConsentButton = document.querySelector("#review-consent");
const withdrawConsentButton = document.querySelector("#withdraw-consent");
const startButton = document.querySelector("#start-session");
const endButton = document.querySelector("#end-session");
const recordingLabel = document.querySelector("#recording-label");
const promptList = document.querySelector("#prompt-list");
const promptCount = document.querySelector("#prompt-count");
const progressValue = document.querySelector("#progress-value");
const progressBar = document.querySelector("#progress-bar");
const currentPromptLabel = document.querySelector("#current-prompt-label");
const previousButton = document.querySelector("#previous-prompt");
const nextButton = document.querySelector("#next-prompt");
const questionDialog = document.querySelector("#question-dialog");
const questionForm = document.querySelector("#question-form");
const questionInput = document.querySelector("#question-input");
const mediaUpload = document.querySelector("#media-upload");
const notesInput = document.querySelector("#notes");
const saveStatus = document.querySelector("#save-status");
const deleteSessionButton = document.querySelector("#delete-session");
const storageStatus = document.querySelector("#storage-status");

let cameraStream = null;
let sessionActive = false;
let consentGranted = false;
let currentPrompt = 0;
let mediaObjectUrl = null;
let saveTimer = null;
let saveQueue = Promise.resolve();
let deletingSavedCopy = false;

const promptCards = () => [...promptList.querySelectorAll(".prompt-card")];

function updatePrompts() {
  const cards = promptCards();
  currentPrompt = Math.min(Math.max(currentPrompt, 0), Math.max(cards.length - 1, 0));
  cards.forEach((card, index) => {
    card.classList.toggle("active-prompt", index === currentPrompt);
  });
  const shown = String(currentPrompt + 1).padStart(2, "0");
  promptCount.textContent = String(cards.length).padStart(2, "0");
  progressValue.innerHTML = `${shown} <span>/</span> ${String(cards.length).padStart(2, "0")}`;
  progressBar.style.width = `${cards.length ? ((currentPrompt + 1) / cards.length) * 100 : 0}%`;
  currentPromptLabel.textContent = cards.length ? `Prompt ${currentPrompt + 1} of ${cards.length}` : "No prompts yet";
  previousButton.disabled = currentPrompt === 0;
  nextButton.disabled = cards.length < 2 || currentPrompt >= cards.length - 1;
}

function updateSessionControls() {
  startButton.disabled = sessionActive;
  endButton.disabled = !sessionActive;
  recordingLabel.classList.toggle("is-visible", sessionActive && Boolean(cameraStream));
  startButton.innerHTML = sessionActive
    ? '<span class="record-dot" aria-hidden="true"></span> Session in progress'
    : '<span class="record-dot" aria-hidden="true"></span> Start session';
}

function updateConsentStatus() {
  consentStatus.textContent = consentGranted
    ? "Participant reviewed and agreed · can withdraw at any time"
    : "Consent needed before camera access";
  consentIndicator.textContent = consentGranted ? "✓" : "!";
  consentIndicator.classList.toggle("consent-approved", consentGranted);
  reviewConsentButton.textContent = consentGranted ? "Review consent" : "Review & consent";
}

function updateStorageStatus(message, connected = false) {
  const dot = document.createElement("span");
  dot.className = "footer-dot";
  dot.classList.toggle("storage-offline", !connected);
  storageStatus.replaceChildren(dot, document.createTextNode(` ${message}`));
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Local backend returned an invalid response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(result.error ?? `Local backend request failed (${response.status}).`);
  }
  return result;
}

function sessionPromptData() {
  return promptCards().map((card) => ({
    type: card.dataset.promptType ?? "question",
    text: card.dataset.promptType === "media"
      ? "Show a picture or short video"
      : card.dataset.promptText ?? card.querySelector(".prompt-body p").textContent,
  }));
}

function createPromptCard(prompt, index) {
  const card = document.createElement("article");
  card.className = `prompt-card${prompt.type === "media" ? " media-prompt" : ""}`;
  card.dataset.promptType = prompt.type;
  card.dataset.promptText = prompt.text;

  const number = document.createElement("span");
  number.className = "prompt-number";
  number.textContent = String(index + 1).padStart(2, "0");

  const body = document.createElement("div");
  body.className = "prompt-body";
  const type = document.createElement("span");
  type.className = "prompt-type";
  const dot = document.createElement("span");
  dot.className = `type-dot ${prompt.type === "media" ? "media-dot" : "question-dot"}`;
  type.append(dot, document.createTextNode(prompt.type === "media" ? " MEDIA STIMULUS" : " QUESTION"));

  const text = document.createElement("p");
  text.textContent = prompt.text;
  body.append(type, text);

  if (prompt.type === "media") {
    const preview = document.createElement("div");
    preview.className = "media-preview";
    preview.id = "media-preview";
    const previewIcon = document.createElement("span");
    previewIcon.setAttribute("aria-hidden", "true");
    previewIcon.textContent = "▧";
    preview.append(previewIcon, document.createTextNode(" Re-select media; files aren't saved"));
    text.id = "media-prompt-label";
    body.append(preview);
  }

  const menu = document.createElement("button");
  menu.className = "prompt-menu";
  menu.type = "button";
  menu.setAttribute("aria-label", `Options for prompt ${number.textContent}`);
  menu.textContent = "···";
  card.append(number, body, menu);
  return card;
}

function restoreSession(session) {
  notesInput.value = session.notes;
  promptList.replaceChildren(...session.prompts.map(createPromptCard));
  currentPrompt = 0;
  updatePrompts();
  const date = new Date(session.expires_at).toLocaleDateString();
  saveStatus.textContent = `Saved on this device · expires ${date}`;
  deleteSessionButton.hidden = false;
}

function saveSession() {
  if (!consentGranted) return Promise.resolve();
  const body = JSON.stringify({ notes: notesInput.value, prompts: sessionPromptData() });
  saveStatus.textContent = "Saving on this device…";
  saveQueue = saveQueue.then(async () => {
    try {
      const { session } = await apiRequest("/api/session", { method: "PUT", body });
      const date = new Date(session.expires_at).toLocaleDateString();
      saveStatus.textContent = `Saved on this device · expires ${date}`;
      deleteSessionButton.hidden = false;
      updateStorageStatus("Saved on this device · expires after 30 days", true);
    } catch (error) {
      console.error("Could not save the session locally.", error);
      saveStatus.textContent = "Not saved · local backend unavailable";
      updateStorageStatus("Local save failed · start server.py to save", false);
    }
  });
  return saveQueue;
}

function scheduleSessionSave() {
  if (deletingSavedCopy) return;
  if (!consentGranted) {
    saveStatus.textContent = "Not saved · participant consent is required";
    return;
  }
  saveStatus.textContent = "Unsaved changes…";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveSession, 500);
}

async function loadOrCreateSession() {
  updateStorageStatus("Connecting to local backend…", false);
  try {
    const { session } = await apiRequest("/api/session");
    if (session) restoreSession(session);
    await saveSession();
  } catch (error) {
    console.error("Could not load the local session.", error);
    saveStatus.textContent = "Not saved · local backend unavailable";
    updateStorageStatus("Local backend unavailable · session stays in this page", false);
  }
}

async function deleteStoredSession() {
  window.clearTimeout(saveTimer);
  await saveQueue;
  return apiRequest("/api/session", { method: "DELETE" });
}

function openConsentDialog() {
  consentAgreement.checked = false;
  consentAccept.disabled = true;
  withdrawConsentButton.hidden = !consentGranted;
  consentAccept.textContent = cameraStream ? "I understand" : "Agree & enable camera";
  consentDialog.showModal();
}

function releaseCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraStage.classList.remove("camera-active");
  cameraPlaceholder.hidden = false;
  cameraButton.innerHTML = '<span class="camera-toggle-icon" aria-hidden="true">◉</span> Enable camera';
  cameraStatus.classList.remove("is-on");
  cameraStatus.innerHTML = "<span></span> Camera off";
  cameraMessage.textContent = "Camera is off. You can turn it back on whenever you like.";
  updateSessionControls();
}

async function requestCamera() {
  if (cameraStream) {
    return true;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraMessage.textContent = "Camera access requires HTTPS or localhost and a supported browser.";
    return false;
  }
  cameraButton.disabled = true;
  cameraMessage.textContent = "Waiting for camera permission…";
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    cameraVideo.srcObject = cameraStream;
    cameraPlaceholder.hidden = true;
    cameraStage.classList.add("camera-active");
    cameraButton.innerHTML = '<span class="camera-toggle-icon" aria-hidden="true">◉</span> Turn camera off';
    cameraStatus.classList.add("is-on");
    cameraStatus.innerHTML = "<span></span> Camera on";
    cameraMessage.textContent = "Live preview only. This prototype does not record, analyze, or upload video.";
    updateSessionControls();
    return true;
  } catch (error) {
    const messages = {
      NotAllowedError: "Camera permission was denied. Allow camera access in your browser settings to continue.",
      NotFoundError: "No camera was found. Connect a camera and try again.",
      NotReadableError: "The camera is already in use by another app. Close it and try again.",
    };
    cameraMessage.textContent = messages[error.name] ?? "Could not start the camera. Check browser permissions and try again.";
    return false;
  } finally {
    cameraButton.disabled = false;
  }
}

cameraButton.addEventListener("click", async () => {
  if (cameraStream) {
    releaseCamera();
    return;
  }
  if (!consentGranted) {
    openConsentDialog();
    return;
  }
  await requestCamera();
});

reviewConsentButton.addEventListener("click", openConsentDialog);

consentAgreement.addEventListener("change", () => {
  consentAccept.disabled = !consentAgreement.checked;
});

startButton.addEventListener("click", () => {
  if (!consentGranted) {
    openConsentDialog();
    return;
  }
  if (!cameraStream) {
    cameraMessage.textContent = "Enable the camera before starting the session.";
    cameraButton.focus();
    return;
  }
  sessionActive = true;
  updateSessionControls();
});

endButton.addEventListener("click", () => {
  sessionActive = false;
  updateSessionControls();
  releaseCamera();
});

document.querySelector("#consent-close").addEventListener("click", () => consentDialog.close());
document.querySelector("#consent-cancel").addEventListener("click", () => consentDialog.close());

consentAccept.addEventListener("click", async () => {
  if (!consentAgreement.checked) return;
  const consentWasAlreadyGranted = consentGranted;
  consentGranted = true;
  updateConsentStatus();
  consentDialog.close();
  if (consentWasAlreadyGranted) {
    if (!cameraStream) await requestCamera();
    return;
  }
  await loadOrCreateSession();
  if (cameraStream) {
    cameraMessage.textContent = "Consent confirmed. The live preview is still on.";
    return;
  }
  await requestCamera();
});

withdrawConsentButton.addEventListener("click", async () => {
  consentGranted = false;
  sessionActive = false;
  window.clearTimeout(saveTimer);
  deletingSavedCopy = true;
  updateConsentStatus();
  updateSessionControls();
  releaseCamera();
  consentDialog.close();
  try {
    await deleteStoredSession();
    deleteSessionButton.hidden = true;
    saveStatus.textContent = "Saved copy deleted · current page data clears when closed";
    updateStorageStatus("Consent withdrawn · saved copy deleted", true);
    cameraMessage.textContent = "Consent withdrawn. The camera is off and the saved session copy has been deleted.";
  } catch (error) {
    console.error("Could not delete the saved session after consent was withdrawn.", error);
    updateStorageStatus("Consent withdrawn · unable to confirm saved-data deletion", false);
    cameraMessage.textContent = "Consent withdrawn and camera is off, but the backend could not confirm deletion. The saved copy will expire after 30 days; restart the local server and delete it.";
  } finally {
    deletingSavedCopy = false;
  }
});

notesInput.addEventListener("input", scheduleSessionSave);

deleteSessionButton.addEventListener("click", async () => {
  if (!window.confirm("Delete the saved copy of this session from this computer? The current page will remain open.")) return;
  deletingSavedCopy = true;
  try {
    await deleteStoredSession();
    deleteSessionButton.hidden = true;
    saveStatus.textContent = "Saved copy deleted · current page data is not saved";
    updateStorageStatus("Saved copy deleted · future edits will be saved", true);
  } catch (error) {
    console.error("Could not delete the saved session.", error);
    saveStatus.textContent = "Could not delete · local backend unavailable";
    updateStorageStatus("Delete failed · restart server.py and try again", false);
  } finally {
    deletingSavedCopy = false;
  }
});

document.querySelector("#add-question").addEventListener("click", () => {
  questionInput.value = "";
  questionDialog.showModal();
  questionInput.focus();
});

questionForm.addEventListener("submit", (event) => {
  if (event.submitter?.value !== "default") return;
  event.preventDefault();
  const text = questionInput.value.trim();
  if (!text) {
    questionInput.focus();
    return;
  }
  const card = document.createElement("article");
  card.className = "prompt-card";
  card.dataset.promptType = "question";
  card.dataset.promptText = text;
  const number = document.createElement("span");
  number.className = "prompt-number";
  number.textContent = String(promptCards().length + 1).padStart(2, "0");
  const body = document.createElement("div");
  body.className = "prompt-body";
  const type = document.createElement("span");
  type.className = "prompt-type";
  const dot = document.createElement("span");
  dot.className = "type-dot question-dot";
  type.append(dot, document.createTextNode(" QUESTION"));
  const question = document.createElement("p");
  question.textContent = text;
  body.append(type, question);
  const menu = document.createElement("button");
  menu.className = "prompt-menu";
  menu.type = "button";
  menu.setAttribute("aria-label", `Options for prompt ${number.textContent}`);
  menu.textContent = "···";
  card.append(number, body, menu);
  promptList.append(card);
  currentPrompt = promptCards().length - 1;
  updatePrompts();
  questionDialog.close();
  scheduleSessionSave();
});

previousButton.addEventListener("click", () => {
  currentPrompt -= 1;
  updatePrompts();
});

nextButton.addEventListener("click", () => {
  currentPrompt += 1;
  updatePrompts();
});

mediaUpload.addEventListener("change", () => {
  const file = mediaUpload.files?.[0];
  if (!file) return;
  if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl);
  mediaObjectUrl = URL.createObjectURL(file);
  const isVideo = file.type.startsWith("video/");
  const preview = document.createElement(isVideo ? "video" : "img");
  preview.src = mediaObjectUrl;
  preview.alt = isVideo ? "Selected video stimulus preview" : "Selected image stimulus preview";
  if (isVideo) {
    preview.muted = true;
    preview.playsInline = true;
    preview.controls = true;
  }
  const activeMediaPreview = document.querySelector("#media-preview");
  const activeMediaLabel = document.querySelector("#media-prompt-label");
  if (!activeMediaPreview || !activeMediaLabel) return;
  activeMediaPreview.replaceChildren(preview);
  activeMediaPreview.classList.add("has-media");
  activeMediaLabel.textContent = file.name;
  updatePrompts();
});

document.querySelector(".dismiss-notice").addEventListener("click", () => {
  document.querySelector(".notice-banner").hidden = true;
});

window.addEventListener("beforeunload", () => {
  if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl);
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
});

updatePrompts();
updateConsentStatus();
updateSessionControls();
