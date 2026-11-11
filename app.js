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
const mediaPreview = document.querySelector("#media-preview");
const mediaPromptLabel = document.querySelector("#media-prompt-label");

let cameraStream = null;
let sessionActive = false;
let consentGranted = false;
let currentPrompt = 0;
let mediaObjectUrl = null;

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
  consentGranted = true;
  updateConsentStatus();
  consentDialog.close();
  if (cameraStream) {
    cameraMessage.textContent = "Consent confirmed. The live preview is still on.";
    return;
  }
  await requestCamera();
});

withdrawConsentButton.addEventListener("click", () => {
  consentGranted = false;
  sessionActive = false;
  updateConsentStatus();
  updateSessionControls();
  releaseCamera();
  cameraMessage.textContent = "Consent withdrawn. The camera is off; no video was recorded or saved.";
  consentDialog.close();
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
  mediaPreview.replaceChildren(preview);
  mediaPreview.classList.add("has-media");
  mediaPromptLabel.textContent = file.name;
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
