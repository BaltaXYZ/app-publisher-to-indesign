const form = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const selectedFile = document.getElementById("selected-file");
const dropzone = document.getElementById("dropzone");
const statusText = document.getElementById("status-text");
const timeline = document.getElementById("timeline");
const jobIdText = document.getElementById("job-id");
const resultPanel = document.getElementById("result-panel");
const downloadLink = document.getElementById("download-link");
const exactList = document.getElementById("exact-list");
const approxList = document.getElementById("approx-list");
const unsupportedList = document.getElementById("unsupported-list");

let pollTimer = null;
let activeJobId = null;

function setSelectedFile() {
  const file = fileInput.files?.[0];
  selectedFile.textContent = file ? file.name : "Ingen fil vald";
}

function setTimeline(state) {
  const states = {
    uploaded: 1,
    processing: 3,
    completed: 4,
    failed: 0
  };

  const activeCount = states[state] ?? 0;
  [...timeline.children].forEach((item, index) => {
    item.dataset.state = index < activeCount ? "done" : "idle";
  });
}

function renderList(target, items) {
  target.innerHTML = "";
  for (const item of items ?? []) {
    const li = document.createElement("li");
    li.textContent = item;
    target.appendChild(li);
  }
}

async function pollJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}?t=${Date.now()}`, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache"
    }
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Kunde inte läsa jobbstatus.");
  }

  const { job, report } = payload;
  jobIdText.textContent = `Jobb: ${job.id}`;
  setTimeline(job.status);

  if (job.status === "uploaded") {
    statusText.textContent = "Filen är uppladdad och väntar på att bearbetas.";
    return false;
  } else if (job.status === "processing") {
    statusText.textContent = "Konverteringen körs. Det här kan ta en stund beroende på dokumentets innehåll.";
    return false;
  } else if (job.status === "failed") {
    statusText.textContent = `Konverteringen misslyckades: ${job.error ?? "okänt fel"}`;
    return true;
  } else if (job.status === "completed") {
    statusText.textContent = "Konverteringen är klar och IDML-filen har verifierats i InDesign.";
    resultPanel.hidden = false;
    downloadLink.hidden = false;
    downloadLink.href = `/api/jobs/${job.id}/result`;
    renderList(exactList, report?.exact);
    renderList(approxList, report?.approximate);
    renderList(unsupportedList, report?.unsupported);
    return true;
  }

  return false;
}

function stopPolling() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function schedulePoll(jobId) {
  stopPolling();

  pollTimer = setTimeout(async () => {
    try {
      const isTerminal = await pollJob(jobId);
      if (isTerminal || activeJobId !== jobId) {
        stopPolling();
        return;
      }

      schedulePoll(jobId);
    } catch (error) {
      statusText.textContent = error.message;
      stopPolling();
    }
  }, 1500);
}

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragover");
  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    return;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  setSelectedFile();
});

fileInput.addEventListener("change", setSelectedFile);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files?.[0];
  if (!file) {
    statusText.textContent = "Välj en `.pub`-fil först.";
    return;
  }

  const data = new FormData();
  data.append("file", file);

  statusText.textContent = "Laddar upp filen och skapar jobb...";
  setTimeline("uploaded");
  resultPanel.hidden = true;
  downloadLink.hidden = true;

  const response = await fetch("/api/jobs", {
    method: "POST",
    body: data
  });

  const payload = await response.json();
  if (!response.ok) {
    statusText.textContent = payload.error || "Kunde inte starta konverteringen.";
    return;
  }

  const jobId = payload.job.id;
  activeJobId = jobId;
  jobIdText.textContent = `Jobb: ${jobId}`;
  stopPolling();
  const isTerminal = await pollJob(jobId);
  if (!isTerminal) {
    schedulePoll(jobId);
  }
});

document.addEventListener("visibilitychange", async () => {
  if (document.hidden || !activeJobId) {
    return;
  }

  try {
    const isTerminal = await pollJob(activeJobId);
    if (!isTerminal) {
      schedulePoll(activeJobId);
    } else {
      stopPolling();
    }
  } catch (error) {
    statusText.textContent = error.message;
  }
});
