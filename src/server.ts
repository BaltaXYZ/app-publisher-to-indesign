import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";

import express from "express";
import multer from "multer";

import { runConversionPipeline } from "./lib/conversion/pipeline.js";

type JobStatus = "uploaded" | "processing" | "completed" | "failed";

interface JobRecord {
  id: string;
  originalName: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  workDir: string;
  inputPath?: string;
  idmlPath?: string;
  reportPath?: string;
  error?: string;
}

const app = express();
const runtimeRoot = path.resolve("runtime");
const jobsRoot = path.join(runtimeRoot, "jobs");
const retentionMs = 1000 * 60 * 60;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const jobs = new Map<string, JobRecord>();

app.use(express.static(path.resolve("web")));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

function serializeJob(job: JobRecord) {
  return {
    id: job.id,
    originalName: job.originalName,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    hasResult: Boolean(job.idmlPath),
    hasReport: Boolean(job.reportPath),
    error: job.error
  };
}

function scheduleCleanup(job: JobRecord): void {
  setTimeout(async () => {
    jobs.delete(job.id);
    await rm(job.workDir, { recursive: true, force: true });
  }, retentionMs).unref();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "pub2indesign", jobs: jobs.size });
});

app.post("/api/jobs", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded." });
    return;
  }

  const jobId = randomUUID();
  const workDir = path.join(jobsRoot, jobId);
  const inputDir = path.join(workDir, "input");
  const safeFileName = path.basename(req.file.originalname);
  const inputPath = path.join(inputDir, safeFileName);
  const now = new Date().toISOString();

  await mkdir(inputDir, { recursive: true });
  await writeFile(inputPath, req.file.buffer);

  const job: JobRecord = {
    id: jobId,
    originalName: safeFileName,
    status: "uploaded",
    createdAt: now,
    updatedAt: now,
    workDir,
    inputPath
  };

  jobs.set(jobId, job);
  scheduleCleanup(job);

  void (async () => {
    try {
      job.status = "processing";
      job.updatedAt = new Date().toISOString();

      const result = await runConversionPipeline(inputPath, workDir);

      job.status = "completed";
      job.updatedAt = new Date().toISOString();
      job.idmlPath = result.idmlPath;
      job.reportPath = result.reportPath;
    } catch (error: unknown) {
      job.status = "failed";
      job.updatedAt = new Date().toISOString();
      job.error = error instanceof Error ? error.message : String(error);
    }
  })();

  res.status(202).json({ job: serializeJob(job) });
});

app.get("/api/jobs/:jobId", async (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }

  let report = null;

  if (job.reportPath) {
    try {
      report = JSON.parse(await readFile(job.reportPath, "utf8"));
    } catch {
      report = null;
    }
  }

  res.json({ job: serializeJob(job), report });
});

app.get("/api/jobs/:jobId/result", async (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job || !job.idmlPath) {
    res.status(404).json({ error: "Result not available." });
    return;
  }

  try {
    await access(job.idmlPath, fsConstants.R_OK);
  } catch {
    res.status(404).json({ error: "Result file missing." });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.download(job.idmlPath, path.basename(job.idmlPath));
});

app.use((_req, res) => {
  res.sendFile(path.resolve("web", "index.html"));
});

async function main(): Promise<void> {
  await mkdir(jobsRoot, { recursive: true });
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  app.listen(port, () => {
    console.log(`Pub2InDesign listening on http://localhost:${port}`);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
