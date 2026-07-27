import type {
  ExtractRequestOptions,
  OptionExtractor,
  PasteInput,
} from '@odysseus/extraction';
import { buildExtractionSchema, createApiExtractor } from '@odysseus/extraction';
import type { DesktopBridge } from '@odysseus/persistence';
import { findDesktopBridge } from '@odysseus/persistence';
import { useMemo } from 'react';

/**
 * Where a paste gets read.
 *
 * Inside the desktop shell, by the Claude Code already installed on the machine: nothing to set up,
 * no key to paste, no second subscription. In a browser tab that is impossible — a page cannot
 * start a process — so it falls back to the API with a key from Settings.
 *
 * Same shape of decision as `useTripStore` makes about where trips live, and made the same way.
 */

/** Rejects the way the SDK does when a request is aborted, so both backends fail alike. */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => {
      const error = new Error('The operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

/** The desktop backend: hand the paste across the bridge and validate whatever comes back. */
function cliExtractor(bridge: DesktopBridge): OptionExtractor {
  return {
    id: 'cli',
    ready: true,

    async extract(input: PasteInput, options: ExtractRequestOptions) {
      const request =
        input.kind === 'image'
          ? { kind: input.kind, payload: input.base64, mediaType: input.mediaType }
          : { kind: input.kind, payload: input.kind === 'url' ? input.url : input.text };

      const call = bridge.extractOption({
        ...request,
        allowedKinds: [...options.allowedKinds],
      });

      // Cancel stops the waiting, not the work: an IPC call in flight cannot be recalled, so the
      // CLI run finishes and its answer is dropped. Worth it anyway — the alternative is a form
      // frozen until a slow page fetch gives up, with no way out.
      const raw = options.signal
        ? await Promise.race([call, rejectOnAbort(options.signal)])
        : await call;

      // The shell already checked this against the schema it sent the CLI. Checking again here is
      // cheap and means the interface never trusts a shape it did not verify itself.
      return buildExtractionSchema(options.allowedKinds).parse(raw);
    },
  };
}

export function useExtractor(apiKey: string | undefined): OptionExtractor {
  return useMemo(() => {
    const bridge = findDesktopBridge();
    return bridge ? cliExtractor(bridge) : createApiExtractor(apiKey);
  }, [apiKey]);
}
