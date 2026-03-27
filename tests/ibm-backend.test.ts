import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IBMBackend } from '../src/backends/ibm.js';
import { IBMError } from '../src/shared/errors.js';

const config = {
  token: 'secret',
  instance: 'ibm-q/open/main',
  backend: 'ibm_brisbane',
};

describe('IBMBackend', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('submits, polls, and fetches IBM results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'job-1',
          status: 'Queued',
          backend: 'ibm_brisbane',
          created: 'now',
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'job-1', status: 'Completed' }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              data: {
                counts: { '0x0': 3, '0x3': 1 },
                metadata: { num_qubits: 2, shots: 4 },
              },
            },
          ],
        })
      );

    vi.stubGlobal('fetch', fetchMock);

    const backend = new IBMBackend(config);
    const promise = backend.run('OPENQASM 2.0;', 4);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
    });
    expect(result.counts.get('00')).toBe(3);
    expect(result.counts.get('11')).toBe(1);
    expect(result.probabilities.get('00')).toBe(0.75);
    expect(result.probabilities.get('11')).toBe(0.25);
  });

  it('retries once after a rate limit response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const backend = new IBMBackend(config);
    const promise = (backend as any).fetchWithRetry('https://example.test', {
      method: 'GET',
    });
    await vi.advanceTimersByTimeAsync(60000);
    const response = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('raises the expected IBM errors for status polling failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ id: 'job-1', status: 'Failed', error_message: 'boom' })
        )
    );
    const backend = new IBMBackend(config);
    const failed = (backend as any).pollStatus('job-1');
    const failedExpectation = expect(failed).rejects.toThrow('boom');
    await vi.advanceTimersByTimeAsync(2000);
    await failedExpectation;

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'job-1', status: 'Failed' }))
    );
    const failedDefault = (backend as any).pollStatus('job-1');
    const failedDefaultExpectation =
      expect(failedDefault).rejects.toThrow('IBM Quantum job failed');
    await vi.advanceTimersByTimeAsync(2000);
    await failedDefaultExpectation;

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ id: 'job-1', status: 'Cancelled' }))
    );
    const cancelled = (backend as any).pollStatus('job-1');
    const cancelledExpectation =
      expect(cancelled).rejects.toThrow('Job was cancelled');
    await vi.advanceTimersByTimeAsync(2000);
    await cancelledExpectation;
  });

  it('times out if IBM never completes a job', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse({ id: 'job-1', status: 'Running' }))
        )
    );
    const backend = new IBMBackend(config);
    const promise = (backend as any).pollStatus('job-1');
    const expectation = expect(promise).rejects.toThrow(
      'Job timed out after 5 minutes'
    );
    await vi.advanceTimersByTimeAsync(400000);
    await expectation;
  });

  it('fails when IBM returns no result payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ results: [] }))
    );
    const backend = new IBMBackend(config);
    await expect((backend as any).fetchResults('job-1')).rejects.toThrow(
      'IBM Quantum returned no results'
    );
  });

  it('validates response errors, including authentication and non-json payloads', async () => {
    const backend = new IBMBackend(config);

    await expect(
      (backend as any).ensureResponse(
        jsonResponse({ message: 'bad token' }, 401)
      )
    ).rejects.toThrow(new IBMError('IBM Quantum authentication failed', 401));

    await expect(
      (backend as any).ensureResponse(
        jsonResponse({ message: 'bad request' }, 500)
      )
    ).rejects.toThrow('bad request');

    await expect(
      (backend as any).ensureResponse(
        new Response('not json', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        })
      )
    ).rejects.toThrow('IBM Quantum request failed with status 503');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
