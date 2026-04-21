const form = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const selectedFile = document.getElementById("selected-file");
const dropzone = document.getElementById("dropzone");
const statusText = document.getElementById("status-text");
const timeline = document.getElementById("timeline");
const jobIdText = document.getElementById("job-id");
const resultPanel = document.getElementById("result-panel");
const downloadLink = document.getElementById("download-link");
const acceptanceList = document.getElementById("acceptance-list");
const qualityList = document.getElementById("quality-list");
const diffList = document.getElementById("diff-list");

let pollTimer = null;
const urlJobId = new URLSearchParams(window.location.search).get("job");
let activeJobId =
  urlJobId ||
  window.sessionStorage.getItem("pub2indesign.activeJobId") ||
  window.sessionStorage.getItem("pub2indesign.latestJobId");
let consecutivePollFailures = 0;

function rememberActiveJob(jobId) {
  activeJobId = jobId;
  window.sessionStorage.setItem("pub2indesign.activeJobId", jobId);
  window.sessionStorage.setItem("pub2indesign.latestJobId", jobId);
}

function forgetActiveJob() {
  activeJobId = null;
  window.sessionStorage.removeItem("pub2indesign.activeJobId");
}

function setSelectedFile() {
  const file = fileInput.files?.[0];
  selectedFile.textContent = file ? file.name : "Ingen fil vald";
}

function setTimeline(state) {
  const states = {
    uploaded: 1,
    processing: 3,
    completed: 3,
    verification_failed: 3,
    verified: 4,
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
  consecutivePollFailures = 0;
  if (window.location.search !== `?job=${job.id}`) {
    window.history.replaceState({}, "", `?job=${job.id}`);
  }
  jobIdText.textContent = `Jobb: ${job.id}`;
  setTimeline(job.status);

  if (job.status === "uploaded") {
    statusText.textContent = `Filen är uppladdad och väntar på att bearbetas. Senast kontrollerad ${new Date().toLocaleTimeString("sv-SE")}.`;
    return false;
  } else if (job.status === "processing") {
    statusText.textContent = `Konverteringen körs. Senast kontrollerad ${new Date().toLocaleTimeString("sv-SE")}.`;
    return false;
  } else if (job.status === "failed") {
    setTimeline(report ? "verification_failed" : "failed");
    statusText.textContent = report
      ? `Konverteringen kördes klart men underkändes i verifieringen: ${job.error ?? "se rapporten nedan"}`
      : `Konverteringen misslyckades: ${job.error ?? "okänt fel"}`;
    resultPanel.hidden = false;
    renderReport(report);
    forgetActiveJob();
    return true;
  } else if (job.status === "completed") {
    setTimeline(report?.releaseApproved ? "verified" : "verification_failed");
    statusText.textContent = report?.releaseApproved
      ? "Konverteringen är verifierad och passerade release-gaten."
      : "Konverteringen är klar, men rapporten är inte godkänd.";
    resultPanel.hidden = false;
    downloadLink.hidden = false;
    downloadLink.href = `/api/jobs/${job.id}/result`;
    renderReport(report);
    forgetActiveJob();
    return true;
  }

  return false;
}

function renderReport(report) {
  if (!report) {
    renderList(acceptanceList, ["Ingen rapport tillgänglig ännu."]);
    renderList(qualityList, []);
    renderList(diffList, []);
    return;
  }

  renderList(acceptanceList, [
    `Strukturell match: ${report.structuralMatchPassed ? "godkänd" : "underkänd"}`,
    `Kolumnstruktur: ${report.columnStructureMatches ? "godkänd" : "underkänd"}`,
    `Förstasida enkolumnsintro: ${report.firstPageIntroColumnPassed ? "godkänd" : "underkänd"}`,
    `Förstasida titel: ${report.coverTitlePresent ? "godkänd" : "saknas"}`,
    `Förstasida abstract: ${report.coverAbstractPresent ? "godkänd" : "saknas"}`,
    `Artikel efter förstasidesmaterial: ${report.articleStartsAfterCoverPassed ? "godkänd" : "underkänd"}`,
    `Huvudflöde två kolumner: ${report.mainFlowTwoColumnPassed ? "godkänd" : "underkänd"}`,
    `Textflöde: ${report.malformedSingleCharacterParagraphsDetected ? "enbokstavsfel upptäckt" : "godkänt"}`,
    `Kanonisk text i PDF: ${Math.round((report.exportedCanonicalTextCoverage ?? 0) * 100)}%`,
    `Sidfot: ${report.footerPageAndUrlPresent ? "sidnummer och URL finns" : "saknas/inkomplett"}`,
    `Eftermaterial i huvudstory: ${report.misplacedBackMatterDetected ? "upptäckt" : "nej"}`,
    `Figur-textwrap: ${report.textWrapPassed ? "godkänd" : "underkänd"}`,
    `Sidlandmärken: ${(report.pageLandmarkMatches ?? []).every(Boolean) ? "godkända" : "underkända"}`,
    `Sektionssidor: ${report.sectionPageMatches ? "godkända" : "underkända"}`,
    `Figur-/tabellrubriker: ${report.captionPresencePassed ? "godkända" : "saknas"}`,
    `Native tabeller: ${report.tablePresencePassed ? "godkända" : "saknas"}`,
    `Referenser vänsterjusterade: ${report.referenceAlignmentPassed ? "godkända" : "underkända"}`,
    `Baksideszoner: ${report.backMatterZonesPassed ? "godkända" : "underkända"}`,
    `Sidduplicering: ${report.duplicatePageContentDetected ? "upptäckt" : "ingen upptäckt"}`,
    `Native audit: ${report.nativeAuditPassed ? "godkänd" : "underkänd"}`,
    `Release gate: ${report.releaseApproved ? "godkänd" : "underkänd"}`,
    `Fonttolerant visuell diff: ${report.fontTolerantVisualMatchPassed ? "godkänd" : "underkänd"}`,
    `Exakt pixeldiff: ${report.exactVisualMatchPassed ? "godkänd" : "förväntat avvikande vid fontskillnader"}`
  ]);

  renderList(qualityList, [
    `Sidor: ${report.pageCount}`,
    `Textframes: ${report.convertedTextFrames}`,
    `Grafikobjekt: ${report.totalGraphics}`,
    `Förväntade kolumner: ${(report.expectedPageColumns ?? []).join(", ") || "okänt"}`,
    `Faktiska kolumner: ${(report.actualPageColumns ?? []).join(", ") || "okänt"}`,
    `Overset text: ${report.oversetText ? "ja" : "nej"}`,
    `Saknade länkar: ${report.missingLinks.length}`,
    `Fontproblem: ${report.fontIssues.length}`,
    `Bakgrundssurrogat: ${report.backgroundSurrogatesDetected ? "ja" : "nej"}`,
    `Rå pixelavvikelse: ${Math.round((report.rawPixelMismatchRatio ?? 0) * 1000) / 10}%`,
    `Referens-PDF: ${report.referencePdfSource ?? "okänd"}`
  ]);

  const differingPages = (report.pageDiffs ?? [])
    .filter((page) => page.differingPixels > 0)
    .slice(0, 6)
    .map((page) => `Sida ${page.pageNumber}: ${page.differingPixels} avvikande pixlar`);

  renderList(diffList, differingPages.length > 0 ? differingPages : ["Inga visuellt relevanta sidavvikelser hittades."]);
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
      consecutivePollFailures += 1;
      statusText.textContent = `${error.message} Försöker igen (${consecutivePollFailures}).`;
      if (activeJobId === jobId) {
        schedulePoll(jobId);
      } else {
        stopPolling();
      }
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
  renderReport(null);

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
  rememberActiveJob(jobId);
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
    schedulePoll(activeJobId);
  }
});

window.addEventListener("focus", async () => {
  if (!activeJobId) {
    return;
  }

  try {
    const isTerminal = await pollJob(activeJobId);
    if (!isTerminal) {
      schedulePoll(activeJobId);
    }
  } catch (error) {
    statusText.textContent = error.message;
    schedulePoll(activeJobId);
  }
});

if (activeJobId) {
  jobIdText.textContent = `Jobb: ${activeJobId}`;
  statusText.textContent = "Återupptar statuskontroll för senaste jobbet...";
  void pollJob(activeJobId)
    .then((isTerminal) => {
      if (!isTerminal && activeJobId) {
        schedulePoll(activeJobId);
      }
    })
    .catch((error) => {
      statusText.textContent = error.message;
      if (activeJobId) {
        schedulePoll(activeJobId);
      }
    });
}
