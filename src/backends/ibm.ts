import { IBMError } from '../shared/errors.js';
import type { IBMConfig } from '../cli/config.js';
import type { SimulationResult } from '../interpreter/interpreter.js';

interface IBMJobSubmitResponse {
  id: string;
  status: string;
  backend: string;
  created: string;
}

interface IBMJobStatusResponse {
  id: string;
  status: 'Queued' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';
  error_message?: string;
}

interface IBMJobResultResponse {
  results: Array<{
    data: {
      counts: Record<string, number>;
      metadata: {
        num_qubits: number;
        shots: number;
      };
    };
  }>;
}

const IBM_BASE_URL = 'https://api.quantum-computing.ibm.com';

export class IBMBackend {
  public constructor(private readonly config: IBMConfig) {}

  public async run(qasmSource: string, shots = 1024): Promise<SimulationResult> {
    const job = await this.submitJob(qasmSource, shots);
    await this.pollStatus(job.id);
    return this.fetchResults(job.id);
  }

  private async submitJob(qasmSource: string, shots: number): Promise<IBMJobSubmitResponse> {
    const [hub, group, project] = this.config.instance.split('/');
    const response = await this.fetchWithRetry(`${IBM_BASE_URL}/runtime/jobs`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        program_id: 'sampler',
        backend: this.config.backend,
        hub,
        group,
        project,
        params: {
          circuits: [qasmSource],
          shots
        }
      })
    });
    return response.json() as Promise<IBMJobSubmitResponse>;
  }

  private async pollStatus(jobId: string): Promise<void> {
    let interval = 2000;
    let elapsed = 0;
    while (elapsed < 300000) {
      await sleep(interval);
      const response = await fetch(`${IBM_BASE_URL}/runtime/jobs/${jobId}`, {
        headers: this.headers()
      });
      await this.ensureResponse(response);
      const payload = (await response.json()) as IBMJobStatusResponse;
      if (payload.status === 'Completed') {
        return;
      }
      if (payload.status === 'Failed') {
        throw new IBMError(payload.error_message ?? 'IBM Quantum job failed', 0);
      }
      if (payload.status === 'Cancelled') {
        throw new IBMError('Job was cancelled', 0);
      }
      interval = Math.min(Math.floor(interval * 1.5), 10000);
      elapsed += interval;
    }
    throw new IBMError('Job timed out after 5 minutes', 0);
  }

  private async fetchResults(jobId: string): Promise<SimulationResult> {
    const response = await fetch(`${IBM_BASE_URL}/runtime/jobs/${jobId}/results`, {
      headers: this.headers()
    });
    await this.ensureResponse(response);
    const payload = (await response.json()) as IBMJobResultResponse;
    const entry = payload.results[0]?.data;
    if (!entry) {
      throw new IBMError('IBM Quantum returned no results', 0);
    }

    const counts = new Map<string, number>();
    Object.entries(entry.counts).forEach(([hex, count]) => {
      const value = Number.parseInt(hex.replace(/^0x/i, ''), 16)
        .toString(2)
        .padStart(entry.metadata.num_qubits, '0');
      counts.set(value, count);
    });

    const probabilities = new Map<string, number>();
    for (const [bitstring, count] of counts.entries()) {
      probabilities.set(bitstring, count / entry.metadata.shots);
    }

    return { counts, probabilities };
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.config.token}`,
      'Content-Type': 'application/json'
    };
  }

  private async fetchWithRetry(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
    const response = await fetch(input, init);
    if (response.status === 429) {
      await sleep(60000);
      const retry = await fetch(input, init);
      await this.ensureResponse(retry);
      return retry;
    }
    await this.ensureResponse(response);
    return response;
  }

  private async ensureResponse(response: Response): Promise<void> {
    if (response.ok) {
      return;
    }
    let payload: { message?: string } | null = null;
    try {
      payload = (await response.json()) as { message?: string };
    } catch {
      payload = null;
    }
    const message = payload?.message ?? `IBM Quantum request failed with status ${response.status}`;
    if (response.status === 401) {
      throw new IBMError('IBM Quantum authentication failed', 401);
    }
    throw new IBMError(message, response.status);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
