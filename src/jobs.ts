/**
 * Background upload jobs (phase 2).
 *
 * Large video uploads must NOT run inside a single synchronous MCP tool call —
 * a 200 MB+ transfer can outlive the gateway's per-call timeout and get cut off
 * mid-stream (the "transport dropped on big files" symptom). Instead:
 *
 *   youtube_studio_upload_video  → starts the upload in the background, returns a jobId immediately
 *   youtube_studio_job_get(jobId) → poll until status is "done" (has videoId) or "failed"
 *
 * The upload itself still STORES NOTHING on this server — it streams the bytes
 * straight through to YouTube. The only thing kept here is a small in-memory
 * status record. Jobs live in-process; a server restart loses in-flight jobs
 * (documented in the job_get response) and finished jobs are pruned after ~1h.
 */

import { randomUUID } from 'node:crypto';
import type { YouTubeStudioClient } from './api-client.js';

export type UploadJobStatus = 'uploading' | 'done' | 'failed';

export interface UploadJob {
  jobId: string;
  status: UploadJobStatus;
  title: string;
  source: string;
  videoId?: string;
  video?: any;
  error?: string;
  startedAt: string;
  updatedAt: string;
}

export interface UploadJobOptions {
  title: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: string;
  filePath?: string;
  url?: string;
}

const jobs = new Map<string, UploadJob>();
const JOB_TTL_MS = 60 * 60 * 1000; // keep finished jobs ~1h so callers can still poll them

/** Drop finished jobs older than the TTL so the map can't grow unbounded. */
function prune(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.status !== 'uploading' && Date.parse(job.updatedAt) < cutoff) {
      jobs.delete(id);
    }
  }
}

/**
 * Start a video upload in the background and return its job record immediately.
 * The actual transfer runs fire-and-forget; .catch() guarantees no unhandled
 * rejection can escape (which would otherwise be caught by the process guards).
 */
export function startUploadJob(client: YouTubeStudioClient, options: UploadJobOptions): UploadJob {
  prune();
  const jobId = `ytupload_${randomUUID()}`;
  const now = new Date().toISOString();
  const job: UploadJob = {
    jobId,
    status: 'uploading',
    title: options.title,
    source: options.url ? `url:${options.url}` : options.filePath ? `filePath:${options.filePath}` : 'unknown',
    startedAt: now,
    updatedAt: now,
  };
  jobs.set(jobId, job);

  void client
    .uploadVideo(options)
    .then((video: any) => {
      job.status = 'done';
      job.videoId = video?.id;
      job.video = video;
      job.updatedAt = new Date().toISOString();
    })
    .catch((e: unknown) => {
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
      job.updatedAt = new Date().toISOString();
    });

  return job;
}

export function getUploadJob(jobId: string): UploadJob | undefined {
  return jobs.get(jobId);
}
